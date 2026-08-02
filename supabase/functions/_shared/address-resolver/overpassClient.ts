/**
 * Cliente para construir el catalogo de calles de una comuna:
 * 1) Nominatim resuelve el nombre de la comuna a una relacion (limite
 *    administrativo) de OpenStreetMap.
 * 2) Overpass API (servicio de bulk-query de OSM, DISTINTO de Nominatim)
 *    devuelve todas las vias con nombre dentro de esa relacion.
 * Overpass es notoriamente mas inestable que Nominatim bajo carga publica
 * (confirmado en pruebas: ~1 de cada 3 consultas devuelve "server busy") -
 * por eso todo pasa por reintentos con backoff. Se cachea el resultado en
 * la tabla street_catalog para no volver a golpear ninguno de los dos
 * servicios por la misma comuna.
 */
const USER_AGENT = "GeoPlanet-Geocoder/1.0 (contacto: matiasstrube@gplanet.cl)";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const withRetry = async <T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 2000): Promise<T> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastError;
};

/** Resuelve una comuna chilena a su relation id de OpenStreetMap. */
const findComunaRelationId = async (comuna: string): Promise<number | null> => {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("city", comuna);
  url.searchParams.set("country", "Chile");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const resp = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (!resp.ok) throw new Error(`Nominatim respondio ${resp.status} buscando relacion de "${comuna}"`);
  const arr = await resp.json();
  const feat = Array.isArray(arr) ? arr[0] : null;
  if (!feat || feat.osm_type !== "relation") return null;
  return Number(feat.osm_id);
};

/** Todas las vias con nombre dentro de una relacion administrativa de OSM. */
const fetchNamedHighways = async (relationId: number): Promise<string[]> => {
  const areaId = 3600000000 + relationId; // convencion de Overpass para areas derivadas de relaciones
  const query = `[out:json][timeout:25];area(${areaId})->.a;way["highway"]["name"](area.a);out tags;`;

  const resp = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) throw new Error(`Overpass respondio ${resp.status}`);

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("Overpass devolvio una respuesta no-JSON (probablemente sobrecargado)");
  }

  const data = (await resp.json()) as { elements: Array<{ tags?: { name?: string } }> };
  const names = new Set<string>();
  for (const el of data.elements) {
    if (el.tags?.name) names.add(el.tags.name);
  }
  return [...names];
};

/**
 * Construye el catalogo de calles de una comuna desde cero (Nominatim +
 * Overpass, con reintentos). No toca la base de datos - eso lo maneja
 * streetCatalogRepository, que llama a esta funcion solo cuando hace falta.
 */
export const buildStreetCatalog = async (comuna: string): Promise<string[]> => {
  const relationId = await withRetry(() => findComunaRelationId(comuna), 2, 1500);
  if (!relationId) return [];
  return withRetry(() => fetchNamedHighways(relationId), 3, 3000);
};
