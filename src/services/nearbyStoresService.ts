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

export interface RecentSales {
  /** Promedio mensual en CLP de los meses considerados. */
  avgClp: number;
  /** El mismo promedio en UF, que no se mueve con la inflación. */
  avgUf: number;
  /** Cuántos meses entraron en el promedio (hasta 12). */
  months: number;
  /** Último mes con venta, "YYYY-MM". */
  lastPeriod: string;
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
  /** Venta promedio de los últimos meses registrados. null si no hay serie. */
  sales: RecentSales | null;
  /** Entra en el informe. Las aledañas se eligen en el diálogo. */
  selected: boolean;
}

/** Meses con venta que entran en el promedio. */
export const MESES_VENTA = 12;

/**
 * Venta promedio reciente de cada local.
 *
 * Se toman los últimos {@link MESES_VENTA} meses CON VENTA, no los últimos 12
 * del calendario: un local cerrado temporalmente registra ceros, y promediarlos
 * haría parecer flojo a un local que simplemente no estuvo abierto — el mismo
 * criterio con el que la red trata los cierres en el resto del análisis.
 */
export const fetchRecentSales = async (
  poiIds: string[],
): Promise<Map<string, RecentSales>> => {
  const ids = [...new Set(poiIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const filas: Array<{ poi_id: string; period: string; value: number }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("poi_metrics")
      .select("poi_id, period, value")
      .eq("metric_key", "ventas")
      .in("poi_id", ids)
      .order("period", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    filas.push(...(data as typeof filas));
    if (data.length < PAGE) break;
  }
  if (filas.length === 0) return new Map();

  const { data: ufRows } = await supabase.from("uf_values").select("period, value");
  const uf = new Map<string, number>();
  for (const r of ufRows ?? []) {
    if (r.value) uf.set(String(r.period).slice(0, 10), Number(r.value));
  }

  const porPoi = new Map<string, Array<{ period: string; clp: number }>>();
  for (const f of filas) {
    const clp = Number(f.value ?? 0);
    if (clp <= 0) continue;
    const arr = porPoi.get(f.poi_id) ?? [];
    arr.push({ period: String(f.period).slice(0, 10), clp });
    porPoi.set(f.poi_id, arr);
  }

  const out = new Map<string, RecentSales>();
  for (const [poiId, serie] of porPoi) {
    const ultimos = serie
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, MESES_VENTA);
    if (ultimos.length === 0) continue;
    const sumaClp = ultimos.reduce((s, m) => s + m.clp, 0);
    // En UF solo los meses con UF conocida; si no hay ninguna, queda en 0 y la
    // columna muestra el peso, que es preferible a inventar una conversión.
    const enUf = ultimos
      .map((m) => (uf.get(m.period) ? m.clp / uf.get(m.period)! : null))
      .filter((v): v is number => v != null);
    out.set(poiId, {
      avgClp: Math.round(sumaClp / ultimos.length),
      avgUf: enUf.length > 0 ? Math.round(enUf.reduce((s, v) => s + v, 0) / enUf.length) : 0,
      months: ultimos.length,
      lastPeriod: ultimos[0].period.slice(0, 7),
    });
  }
  return out;
};

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
  // Una sola consulta para toda la red candidata: el mismo local puede salir
  // dos veces (desde la isócrona y desde una zona aledaña).
  const ventas = await fetchRecentSales(stores.map((s) => s.id));

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
      sales: ventas.get(s.id) ?? null,
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
        sales: ventas.get(s.id) ?? null,
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
