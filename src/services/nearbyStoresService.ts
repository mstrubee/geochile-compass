import { supabase } from "@/integrations/supabase/client";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { ComunaFC } from "@/hooks/useComunasGeoIndex";
import { normalizeCommuneName } from "@/services/communeDataService";
import type { DriveSpeeds } from "@/services/commercialSettingsService";
import { haversineMeters } from "@/utils/geoDistance";

/**
 * Locales de la red cercanos a una isócrona, con la distancia y el tiempo en
 * auto hasta cada uno.
 *
 * La ruta y los kilómetros los entrega el ruteador (reales por calle); el
 * tiempo se calcula acá con las velocidades que fija el admin, porque el
 * modelo del ruteador supone tránsito libre y para decidir una inversión
 * conviene el supuesto conservador.
 */

/** Radio alrededor de cada zona aledaña, como pidió el negocio. */
export const RADIO_ALEDANA_KM = 10;
/** Corte de tiempo desde la isócrona principal. */
export const MAX_MINUTOS_ISO = 30;
/**
 * Preselección en línea recta antes de rutear: cada ruta consume cuota del
 * servicio, así que no se pregunta por locales que no pueden calificar. A la
 * velocidad de autopista más alta admitida (140 km/h), 30 minutos no alcanzan
 * para 70 km en línea recta.
 */
const MAX_KM_LINEA_RECTA = 70;

export interface NetworkStore {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: string | null;
}

export interface NearbyStore {
  id: string;
  name: string;
  /** Desde dónde se midió: la isócrona analizada o una zona aledaña. */
  from: "iso" | "aledana";
  /** Nombre de la zona aledaña cuando `from` es "aledana". */
  fromName: string | null;
  km: number;
  highwayKm: number;
  minutes: number;
  /** Tiempo del ruteador, para contrastar. No se muestra en el informe. */
  routerMinutes: number | null;
  sameCommune: boolean;
  status: string | null;
  /** Entra en el informe. Las aledañas se eligen en el diálogo. */
  selected: boolean;
}

/** Tiempo con las velocidades del admin sobre los kilómetros reales. */
export const minutesFor = (
  km: number,
  highwayKm: number,
  speeds: DriveSpeeds,
): number => {
  const autopista = Math.min(Math.max(highwayKm, 0), km);
  const urbano = Math.max(km - autopista, 0);
  return Math.round((urbano / speeds.urbanKmh + autopista / speeds.highwayKmh) * 60);
};

/** Locales de la red con coordenadas, sin los cerrados definitivamente. */
export const fetchNetworkStores = async (folderId: string): Promise<NetworkStore[]> => {
  const { data, error } = await supabase
    .from("pois")
    .select("id, name, lat, lng, operational_status")
    .eq("folder_id", folderId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? [])
    .filter((p) => p.lat != null && p.lng != null)
    // Un local cerrado para siempre no es un punto de la red al que se maneje.
    .filter((p) => p.operational_status !== "cerrado_definitivo")
    .map((p) => ({
      id: p.id as string,
      name: (p.name as string) ?? "(sin nombre)",
      lat: Number(p.lat),
      lng: Number(p.lng),
      status: (p.operational_status as string) ?? null,
    }));
};

const kmEntre = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  haversineMeters(a.lat, a.lng, b.lat, b.lng) / 1000;

/** Comuna que contiene un punto, o null si cae fuera del mapa comunal. */
export const communeAt = (
  fc: ComunaFC | null,
  nombresPorCodigo: Record<string, string>,
  lat: number,
  lng: number,
): string | null => {
  if (!fc) return null;
  const pt = point([lng, lat]);
  for (const f of fc.features) {
    try {
      if (!booleanPointInPolygon(pt, f as never)) continue;
    } catch {
      continue;
    }
    const codigo = f.properties?.codigo_comuna ?? f.properties?.cod_comuna ?? "";
    return nombresPorCodigo[codigo] ?? f.properties?.nom_comuna ?? null;
  }
  return null;
};

interface DriveResult {
  id: string;
  km: number | null;
  highwayKm: number | null;
  routerMinutes: number | null;
  error?: string;
}

/** Rutea desde un origen hasta varios destinos (vía edge function). */
const driveDistances = async (
  origin: { lat: number; lng: number },
  destinations: Array<{ id: string; lat: number; lng: number }>,
): Promise<DriveResult[]> => {
  if (destinations.length === 0) return [];
  const { data, error } = await supabase.functions.invoke<{ results: DriveResult[] }>(
    "drive-distance",
    { body: { origin, destinations } },
  );
  if (error) throw error;
  return data?.results ?? [];
};

export interface NearbyParams {
  /** Centro de la isócrona analizada. */
  origin: { lat: number; lng: number };
  /** Centros de las zonas aledañas fusionadas. */
  aledanas: Array<{ name: string; lat: number; lng: number }>;
  stores: NetworkStore[];
  speeds: DriveSpeeds;
  /** Comunas que cubre la isócrona, para la regla de "misma ciudad". */
  isoCommunes: string[];
  comunasFc: ComunaFC | null;
  nombresPorCodigo: Record<string, string>;
}

/**
 * Locales cercanos, ya ruteados.
 *
 * Desde la isócrona analizada entran los que quedan dentro del corte de tiempo
 * o en una de sus comunas. Desde cada zona aledaña entran los que estén en el
 * radio definido, y el usuario elige cuáles conserva.
 */
export const computeNearbyStores = async (
  params: NearbyParams,
): Promise<NearbyStore[]> => {
  const { origin, aledanas, stores, speeds, isoCommunes, comunasFc, nombresPorCodigo } = params;
  const comunasIso = new Set(isoCommunes.map(normalizeCommuneName));

  const comunaDe = (s: NetworkStore) =>
    communeAt(comunasFc, nombresPorCodigo, s.lat, s.lng);

  const salida: NearbyStore[] = [];

  // ── Desde la isócrona analizada ──────────────────────────────────────────
  const candidatos = stores
    .map((s) => ({ s, recta: kmEntre(origin, s) }))
    .filter((c) => c.recta <= MAX_KM_LINEA_RECTA)
    .sort((a, b) => a.recta - b.recta)
    .slice(0, 12);

  const rutas = await driveDistances(origin, candidatos.map((c) => ({
    id: c.s.id, lat: c.s.lat, lng: c.s.lng,
  })));
  const porId = new Map(rutas.map((r) => [r.id, r]));

  for (const { s } of candidatos) {
    const r = porId.get(s.id);
    if (!r || r.km == null) continue;
    const minutes = minutesFor(r.km, r.highwayKm ?? 0, speeds);
    const comuna = comunaDe(s);
    const sameCommune = !!comuna && comunasIso.has(normalizeCommuneName(comuna));
    if (minutes > MAX_MINUTOS_ISO && !sameCommune) continue;
    salida.push({
      id: s.id, name: s.name, from: "iso", fromName: null,
      km: r.km, highwayKm: r.highwayKm ?? 0, minutes,
      routerMinutes: r.routerMinutes, sameCommune, status: s.status,
      selected: true,
    });
  }

  // ── Desde cada zona aledaña ──────────────────────────────────────────────
  for (const z of aledanas) {
    const cerca = stores
      .map((s) => ({ s, recta: kmEntre(z, s) }))
      .filter((c) => c.recta <= RADIO_ALEDANA_KM)
      .sort((a, b) => a.recta - b.recta)
      .slice(0, 12);
    if (cerca.length === 0) continue;

    const rz = await driveDistances({ lat: z.lat, lng: z.lng }, cerca.map((c) => ({
      id: c.s.id, lat: c.s.lat, lng: c.s.lng,
    })));
    const porIdZ = new Map(rz.map((r) => [r.id, r]));

    for (const { s } of cerca) {
      const r = porIdZ.get(s.id);
      if (!r || r.km == null) continue;
      const comuna = comunaDe(s);
      salida.push({
        id: s.id, name: s.name, from: "aledana", fromName: z.name,
        km: r.km, highwayKm: r.highwayKm ?? 0,
        minutes: minutesFor(r.km, r.highwayKm ?? 0, speeds),
        routerMinutes: r.routerMinutes,
        sameCommune: !!comuna && comunasIso.has(normalizeCommuneName(comuna)),
        status: s.status,
        // Las de zonas aledañas se confirman en el diálogo antes de exportar.
        selected: true,
      });
    }
  }

  return salida.sort((a, b) => a.minutes - b.minutes);
};

/** Recalcula los tiempos con otras velocidades, sin volver a rutear. */
export const reapplySpeeds = (
  list: NearbyStore[],
  speeds: DriveSpeeds,
): NearbyStore[] =>
  list.map((s) => ({ ...s, minutes: minutesFor(s.km, s.highwayKm, speeds) }));
