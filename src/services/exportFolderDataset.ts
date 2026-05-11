/**
 * Exporta una carpeta de POIs (con subcarpetas) como CSV "wide":
 * una fila por POI con columnas de identidad + atributos estáticos +
 * features territoriales (poi_features_cache.features) +
 * métricas pivoteadas por período (poi_metrics).
 */
import { supabase } from "@/integrations/supabase/client";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import type { PoiFolderSchema } from "@/types/poiMetrics";

const CHUNK = 200;
const PAGE = 1000;

/** Pagina una query filtrada por un set de poi_ids para sobrepasar el límite de 1000 filas de PostgREST. */
const fetchPaginated = async <T,>(
  ids: string[],
  runPage: (chunk: string[], from: number, to: number) => Promise<T[]>,
): Promise<T[]> => {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const to = from + PAGE - 1;
      const rows = await runPage(slice, from, to);
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
};

const collectFolderIds = (rootId: string, allFolders: PoiFolder[]): Set<string> => {
  const out = new Set<string>([rootId]);
  const childrenOf = new Map<string, string[]>();
  for (const f of allFolders) {
    if (f.deleted_at) continue;
    if (!f.parent_id) continue;
    const arr = childrenOf.get(f.parent_id) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parent_id, arr);
  }
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        walk(child);
      }
    }
  };
  walk(rootId);
  return out;
};

const folderPathOf = (id: string | null, byId: Map<string, PoiFolder>): string => {
  if (!id) return "";
  const parts: string[] = [];
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 100) {
    const f = byId.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parent_id;
  }
  return parts.join(" › ");
};

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

const slugify = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "carpeta";

export interface ExportResult {
  rows: number;
  columns: number;
  filename: string;
}

export const exportFolderDataset = async (
  folder: PoiFolder,
  allFolders: PoiFolder[],
  allPois: SavedPoi[],
  schema?: PoiFolderSchema,
): Promise<ExportResult> => {
  const targetFolders = collectFolderIds(folder.id, allFolders);
  const folderById = new Map(allFolders.map((f) => [f.id, f] as const));

  const poisInScope = allPois.filter(
    (p) => !p.deleted_at && p.folder_id && targetFolders.has(p.folder_id),
  );
  if (poisInScope.length === 0) {
    throw new Error("La carpeta no contiene POIs activos");
  }
  const poiIds = poisInScope.map((p) => p.id);

  // 1) Atributos estáticos
  const attrRows = await fetchPaginated(poiIds, async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("poi_attributes")
      .select("poi_id,attr_key,attr_value")
      .in("poi_id", chunk)
      .range(from, to);
    if (error) throw new Error(`poi_attributes: ${error.message}`);
    return (data ?? []) as Array<{ poi_id: string; attr_key: string; attr_value: string | null }>;
  });
  const attrsByPoi = new Map<string, Map<string, string>>();
  const attrKeySet = new Set<string>();
  for (const r of attrRows) {
    attrKeySet.add(r.attr_key);
    let m = attrsByPoi.get(r.poi_id);
    if (!m) {
      m = new Map();
      attrsByPoi.set(r.poi_id, m);
    }
    m.set(r.attr_key, r.attr_value ?? "");
  }

  // 2) Features (poi_features_cache)
  const featRows = await fetchPaginated(poiIds, async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("poi_features_cache")
      .select("poi_id,features,iso_minutes,is_rm,config_version,computed_at")
      .in("poi_id", chunk)
      .range(from, to);
    if (error) throw new Error(`poi_features_cache: ${error.message}`);
    return (data ?? []) as Array<{
      poi_id: string;
      features: Record<string, unknown> | null;
      iso_minutes: number;
      is_rm: boolean;
      config_version: number;
      computed_at: string;
    }>;
  });
  // Si hay varias filas por poi_id (RM/regiones, distintas isócronas), nos quedamos con la más reciente.
  const featByPoi = new Map<string, Record<string, unknown>>();
  const featMeta = new Map<string, { iso_minutes: number; is_rm: boolean; computed_at: string }>();
  for (const r of featRows) {
    const prev = featMeta.get(r.poi_id);
    if (!prev || r.computed_at > prev.computed_at) {
      featByPoi.set(r.poi_id, r.features ?? {});
      featMeta.set(r.poi_id, {
        iso_minutes: r.iso_minutes,
        is_rm: r.is_rm,
        computed_at: r.computed_at,
      });
    }
  }
  const featKeySet = new Set<string>();
  for (const f of featByPoi.values()) {
    for (const k of Object.keys(f)) featKeySet.add(k);
  }

  // 3) Métricas (pivot por metric_key + period)
  const metricRows = await fetchPaginated(poiIds, async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("poi_metrics")
      .select("poi_id,metric_key,period,value")
      .in("poi_id", chunk)
      .range(from, to);
    if (error) throw new Error(`poi_metrics: ${error.message}`);
    return (data ?? []) as Array<{
      poi_id: string;
      metric_key: string;
      period: string;
      value: number;
    }>;
  });
  console.info("[exportFolderDataset]", {
    pois: poiIds.length,
    attrRows: attrRows.length,
    featRows: featRows.length,
    metricRows: metricRows.length,
  });
  const metricByPoi = new Map<string, Map<string, number>>();
  const metricColSet = new Set<string>();
  for (const r of metricRows) {
    const ym = r.period.slice(0, 7); // YYYY-MM
    const col = `${r.metric_key}_${ym}`;
    metricColSet.add(col);
    let m = metricByPoi.get(r.poi_id);
    if (!m) {
      m = new Map();
      metricByPoi.set(r.poi_id, m);
    }
    m.set(col, r.value);
  }

  // ----- Construir columnas en orden estable -----
  const baseCols = ["poi_id", "name", "folder", "lat", "lng", "address"];

  // Estáticos: priorizar el orden definido en schema.static_columns; agregar el resto alfabético.
  const schemaStatic = (schema?.static_columns ?? []).filter((c) => attrKeySet.has(c));
  const remainingStatic = [...attrKeySet]
    .filter((c) => !schemaStatic.includes(c))
    .sort((a, b) => a.localeCompare(b));
  const staticCols = [...schemaStatic, ...remainingStatic];

  // Features: alfabético, prefijo feat_
  const featCols = [...featKeySet].sort((a, b) => a.localeCompare(b));

  // Métricas: cronológico ascendente
  const metricCols = [...metricColSet].sort((a, b) => a.localeCompare(b));

  const headers = [
    ...baseCols,
    ...staticCols,
    ...featCols.map((k) => `feat_${k}`),
    "feat_iso_minutes",
    "feat_is_rm",
    "feat_computed_at",
    ...metricCols,
  ];

  // ----- Construir filas -----
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));

  for (const p of poisInScope) {
    const props = (p.properties ?? {}) as Record<string, unknown>;
    const address =
      (typeof props.address === "string" && props.address) ||
      (typeof props.direccion === "string" && props.direccion) ||
      "";
    const attrs = attrsByPoi.get(p.id);
    const feats = featByPoi.get(p.id) ?? {};
    const meta = featMeta.get(p.id);
    const metrics = metricByPoi.get(p.id);

    const row: unknown[] = [
      p.id,
      p.name,
      folderPathOf(p.folder_id, folderById),
      p.lat,
      p.lng,
      address,
    ];
    for (const c of staticCols) row.push(attrs?.get(c) ?? "");
    for (const k of featCols) {
      const v = (feats as Record<string, unknown>)[k];
      row.push(typeof v === "number" || typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
    }
    row.push(meta?.iso_minutes ?? "");
    row.push(meta == null ? "" : meta.is_rm ? "true" : "false");
    row.push(meta?.computed_at ?? "");
    for (const c of metricCols) row.push(metrics?.get(c) ?? "");

    lines.push(row.map(csvEscape).join(","));
  }

  // BOM UTF-8 para que Excel reconozca acentos
  const csv = "\ufeff" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `dataset_${slugify(folder.name)}_${today}.csv`;
  triggerDownload(blob, filename);

  return { rows: poisInScope.length, columns: headers.length, filename };
};
