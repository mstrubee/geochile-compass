import { toCsv } from "@/utils/csv";
import { safeFilename, triggerDownload, type KmzNode } from "@/utils/kmzExport";

/**
 * Carpeta o capa del árbol → una sola tabla (un punto por fila).
 * Columnas fijas: `layer_name` (ruta de carpetas + capa), `name`, `lat`, `lng`, `geometry_type`,
 * y una columna por cada atributo que aparezca en cualquier punto. Lat/lng solo existen en los puntos.
 */
export const layerTreeToCsvTable = (root: KmzNode): { headers: string[]; rows: Array<Record<string, unknown>> } => {
  const flat: Array<{ layer: string; name: string | null; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> = [];
  const walk = (n: KmzNode, path: string[]) => {
    const here = [...path, n.name];
    for (const f of n.features ?? []) flat.push({ layer: here.join(" / "), name: f.name, geometry: f.geometry, properties: f.properties ?? {} });
    n.children?.forEach((c) => walk(c, here));
  };
  // La carpeta raíz exportada no repite su nombre en cada fila cuando tiene subcarpetas.
  const startPath: string[] = [];
  if (root.features?.length) walk(root, startPath);
  else root.children?.forEach((c) => walk(c, startPath));

  const FIXED = ["layer_name", "name", "lat", "lng", "geometry_type"];
  const props = new Set<string>();
  for (const r of flat) for (const k of Object.keys(r.properties)) if (!FIXED.includes(k)) props.add(k);
  const propHeaders = [...props].sort();

  const rows = flat.map((r) => {
    const point = r.geometry?.type === "Point" ? r.geometry.coordinates : null;
    const row: Record<string, unknown> = {
      layer_name: r.layer,
      name: r.name ?? "",
      lat: point ? point[1] : "",
      lng: point ? point[0] : "",
      geometry_type: r.geometry?.type ?? "",
    };
    for (const k of propHeaders) {
      const v = r.properties[k];
      row[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v;
    }
    return row;
  });
  return { headers: [...FIXED, ...propHeaders], rows };
};

/** Descarga la carpeta o capa como CSV (con BOM para que Excel respete los acentos). */
export const exportLayerTreeAsCsv = (root: KmzNode): number => {
  const { headers, rows } = layerTreeToCsvTable(root);
  if (!rows.length) throw new Error(`“${root.name}” no tiene puntos para exportar`);
  const blob = new Blob(["﻿" + toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${safeFilename(root.name)}.csv`);
  return rows.length;
};
