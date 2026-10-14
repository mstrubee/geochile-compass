import JSZip from "jszip";
import type { Geometry, Position } from "geojson";
import { parseCsvRows } from "@/utils/csv";
import { MAX_FILE_SIZE } from "@/utils/fileParsers";
import { htmlToGeoJson } from "@/utils/htmlToGeoJson";

/**
 * Parser único del importador de capas (KMZ, KML, GeoJSON, CSV y HTML de mapas).
 *
 * Devuelve SIEMPRE el mismo modelo: un árbol de carpetas y capas con los puntos
 * ya validados (geometría 2D, coordenadas finitas, anillos cerrados). Lo que no se
 * puede importar no aborta el archivo: queda en `issues` con el motivo.
 *
 * Regla carpetas/capas: una carpeta KML con solo Placemarks es una CAPA; una con
 * solo subcarpetas es una CARPETA; si mezcla las dos cosas es una carpeta y sus
 * Placemarks directos van a una capa "Sin subcarpeta".
 */

/** Formatos con los que se guarda un lote (los que acepta la base). */
export type ImportFormat = "kmz" | "kml" | "geojson" | "csv";
/** Lo que se puede soltar: el HTML de un mapa se convierte a GeoJSON al leerlo, así que el lote queda como `geojson`. */
export type ImportSourceFormat = ImportFormat | "html";

export interface ImportFeature {
  /** Único dentro del archivo: `<clave de la capa>#<n>`. */
  key: string;
  /** `id` del Placemark / feature, o la columna `external_id` si existe. */
  externalId: string | null;
  name: string | null;
  geometry: Geometry;
  properties: Record<string, unknown>;
  /** URL o data URL del ícono (KML). */
  icon: string | null;
  /** `#rrggbb` del estilo (KML) si lo hay. */
  color: string | null;
}

export interface ImportNode {
  /** Ruta de posiciones desde la raíz ("0", "0.2", "0.2.1"): identifica el nodo aunque haya nombres repetidos. */
  key: string;
  kind: "folder" | "layer";
  name: string;
  color: string | null;
  icon: string | null;
  children?: ImportNode[];
  features?: ImportFeature[];
}

export type ImportIssueKind = "invalid-geometry" | "no-geometry" | "unsupported" | "warning";

export interface ImportIssue {
  kind: ImportIssueKind;
  /** Nombres de las carpetas por las que pasa (para ubicarlo en el archivo). */
  path: string[];
  name: string | null;
  reason: string;
}

export interface ImportDocument {
  filename: string;
  format: ImportFormat;
  root: ImportNode;
  issues: ImportIssue[];
  counts: { folders: number; layers: number; features: number; invalid: number };
}

export const SUPPORTED_IMPORT_EXTENSIONS = ["kmz", "kml", "geojson", "json", "csv", "html", "htm"] as const;
/** Valor del atributo `accept` de los selectores de archivo del importador. */
export const IMPORT_ACCEPT = SUPPORTED_IMPORT_EXTENSIONS.map((e) => `.${e}`).join(",");

export const importFormatOf = (filename: string): ImportSourceFormat | null => {
  const m = filename.toLowerCase().match(/\.(kmz|kml|geojson|json|csv|html|htm)$/);
  if (!m) return null;
  if (m[1] === "json") return "geojson";
  if (m[1] === "htm") return "html";
  return m[1] as ImportSourceFormat;
};

/** Íconos más grandes que esto (data URL) no se guardan en la capa: inflarían cada lectura del árbol. */
export const MAX_ICON_CHARS = 6000;

const stripExt = (name: string) => name.replace(/\.[^./\\]+$/, "");

/** Google Earth nombra el Document como el archivo, con extensión ("Test 1.kmz"): se quita. */
const cleanDocName = (name: string) => name.replace(/\.(kmz|kml)$/i, "").trim();

/**
 * Los íconos de Google (`http://maps.google.com/mapfiles/...`) vienen por http y la app va por https:
 * el navegador los bloquea o avisa de contenido mixto. Esos hosts sirven los mismos archivos por https.
 */
export const normalizeIconUrl = (href: string): string =>
  href.replace(/^http:\/\/((?:maps|www|earth|mt\d?)\.google\.com|(?:[a-z0-9-]+\.)*gstatic\.com)\//i, "https://$1/");

// ── Geometría ────────────────────────────────────────────────────────────────

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

const validPosition = (p: Position): string | null => {
  if (!Array.isArray(p) || p.length < 2 || !isNum(p[0]) || !isNum(p[1])) return "coordenadas no numéricas";
  if (Math.abs(p[1]) > 90) return `latitud fuera de rango (${p[1]})`;
  if (Math.abs(p[0]) > 180) return `longitud fuera de rango (${p[0]})`;
  return null;
};

/** `lng,lat[,alt]` separados por espacios → posiciones 2D. Devuelve `null` si alguna no se puede leer. */
export const parseKmlCoordinates = (raw: string): Position[] | null => {
  const tokens = raw.trim().replace(/\s*,\s*/g, ",").split(/\s+/).filter(Boolean);
  const out: Position[] = [];
  for (const t of tokens) {
    const [lng, lat] = t.split(",").map(Number);
    if (!isNum(lng) || !isNum(lat)) return null;
    out.push([lng, lat]);
  }
  return out;
};

const closeRing = (ring: Position[]): Position[] => {
  const a = ring[0];
  const b = ring[ring.length - 1];
  return a && b && (a[0] !== b[0] || a[1] !== b[1]) ? [...ring, [a[0], a[1]]] : ring;
};

type GeomResult = { geometry: Geometry | null; problems: string[] };

/** Valida y normaliza una geometría GeoJSON (2D, anillos cerrados, rangos). Nunca lanza. */
export const normalizeGeometry = (g: unknown): GeomResult => {
  const problems: string[] = [];
  const geom = g as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
  if (!geom || typeof geom !== "object" || !geom.type) return { geometry: null, problems: ["sin geometría"] };

  const strip = (p: Position): Position => [p[0], p[1]];
  const point = (p: unknown): Position | null => {
    if (!Array.isArray(p)) {
      problems.push("coordenadas no numéricas");
      return null;
    }
    const bad = validPosition(p as Position);
    if (bad) {
      problems.push(bad);
      return null;
    }
    return strip(p as Position);
  };
  const line = (c: unknown): Position[] | null => {
    if (!Array.isArray(c)) return null;
    const pts = c.map(point);
    if (pts.some((p) => !p)) return null;
    if (pts.length < 2) {
      problems.push("una línea necesita al menos 2 puntos");
      return null;
    }
    return pts as Position[];
  };
  const ring = (c: unknown, isOuter: boolean): Position[] | null => {
    if (!Array.isArray(c)) return null;
    const pts = c.map(point);
    if (pts.some((p) => !p)) return null;
    const closed = closeRing(pts as Position[]);
    if (closed.length < 4) {
      if (isOuter) problems.push("un polígono necesita al menos 3 vértices distintos");
      else problems.push("un hueco del polígono tiene menos de 3 vértices (se omitió)");
      return null;
    }
    return closed;
  };
  const polygon = (c: unknown): Position[][] | null => {
    if (!Array.isArray(c) || !c.length) {
      problems.push("polígono sin anillos");
      return null;
    }
    const outer = ring(c[0], true);
    if (!outer) return null;
    const holes = (c as unknown[]).slice(1).map((r) => ring(r, false)).filter((r): r is Position[] => !!r);
    return [outer, ...holes];
  };

  switch (geom.type) {
    case "Point": {
      const p = point(geom.coordinates);
      if (!p) return { geometry: null, problems };
      if (p[0] === 0 && p[1] === 0) return { geometry: null, problems: ["coordenadas 0,0 (sin ubicación)"] };
      return { geometry: { type: "Point", coordinates: p }, problems };
    }
    case "LineString": {
      const l = line(geom.coordinates);
      return { geometry: l ? { type: "LineString", coordinates: l } : null, problems };
    }
    case "Polygon": {
      const p = polygon(geom.coordinates);
      return { geometry: p ? { type: "Polygon", coordinates: p } : null, problems };
    }
    case "MultiPoint": {
      const all = (Array.isArray(geom.coordinates) ? geom.coordinates : []).map(point).filter((p): p is Position => !!p);
      // Igual que un Point suelto: 0,0 es "sin ubicación", no un lugar.
      const pts = all.filter((p) => p[0] !== 0 || p[1] !== 0);
      if (pts.length < all.length) problems.push("coordenadas 0,0 (sin ubicación)");
      return { geometry: pts.length ? { type: "MultiPoint", coordinates: pts } : null, problems };
    }
    case "MultiLineString": {
      const ls = (Array.isArray(geom.coordinates) ? geom.coordinates : []).map(line).filter((l): l is Position[] => !!l);
      return { geometry: ls.length ? { type: "MultiLineString", coordinates: ls } : null, problems };
    }
    case "MultiPolygon": {
      const ps = (Array.isArray(geom.coordinates) ? geom.coordinates : []).map(polygon).filter((p): p is Position[][] => !!p);
      return { geometry: ps.length ? { type: "MultiPolygon", coordinates: ps } : null, problems };
    }
    case "GeometryCollection": {
      const parts = (geom.geometries ?? []).map((x) => normalizeGeometry(x));
      const ok = parts.map((p) => p.geometry).filter((x): x is Geometry => !!x);
      parts.forEach((p) => problems.push(...p.problems));
      return { geometry: ok.length ? { type: "GeometryCollection", geometries: ok } : null, problems };
    }
    default:
      return { geometry: null, problems: [`tipo de geometría no soportado (${geom.type})`] };
  }
};

/** Junta partes válidas de un MultiGeometry en un solo GeoJSON (Multi* si son del mismo tipo). */
const mergeParts = (parts: Geometry[]): Geometry | null => {
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const types = new Set(parts.map((p) => p.type));
  if (types.size === 1) {
    const t = parts[0].type;
    if (t === "Point") return { type: "MultiPoint", coordinates: parts.map((p) => (p as GeoJSON.Point).coordinates) };
    if (t === "LineString") return { type: "MultiLineString", coordinates: parts.map((p) => (p as GeoJSON.LineString).coordinates) };
    if (t === "Polygon") return { type: "MultiPolygon", coordinates: parts.map((p) => (p as GeoJSON.Polygon).coordinates) };
  }
  return { type: "GeometryCollection", geometries: parts };
};

// ── KML ──────────────────────────────────────────────────────────────────────

const kids = (el: Element): Element[] => Array.from(el.children);
const named = (el: Element, local: string): Element[] => kids(el).filter((c) => c.localName === local);
const first = (el: Element, local: string): Element | undefined => named(el, local)[0];
const text = (el: Element | undefined | null): string => (el?.textContent ?? "").trim();

/** KML usa AABBGGRR; se devuelve `#rrggbb` (la transparencia se ignora). */
export const kmlColorToHex = (v: string | null | undefined): string | null => {
  const m = (v ?? "").trim().match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `#${m[4]}${m[3]}${m[2]}`.toLowerCase() : null;
};

interface StyleInfo {
  icon: string | null;
  color: string | null;
}

const styleInfoOf = (style: Element): StyleInfo => {
  const iconStyle = first(style, "IconStyle");
  const href = iconStyle ? text(Array.from(iconStyle.getElementsByTagNameNS("*", "href"))[0]) : "";
  const color =
    kmlColorToHex(text(iconStyle && first(iconStyle, "color"))) ??
    kmlColorToHex(text(first(style, "LineStyle") && first(first(style, "LineStyle")!, "color"))) ??
    kmlColorToHex(text(first(style, "PolyStyle") && first(first(style, "PolyStyle")!, "color")));
  return { icon: href ? normalizeIconUrl(href) : null, color };
};

const collectStyles = (root: Element) => {
  const styles = new Map<string, StyleInfo>();
  const maps = new Map<string, string>();
  for (const s of Array.from(root.getElementsByTagNameNS("*", "Style"))) {
    const id = s.getAttribute("id");
    if (id) styles.set(`#${id}`, styleInfoOf(s));
  }
  for (const sm of Array.from(root.getElementsByTagNameNS("*", "StyleMap"))) {
    const id = sm.getAttribute("id");
    if (!id) continue;
    const pairs = named(sm, "Pair");
    const normal = pairs.find((p) => text(first(p, "key")) === "normal") ?? pairs[0];
    const url = text(normal && first(normal, "styleUrl"));
    if (url) maps.set(`#${id}`, url.startsWith("#") ? url : `#${url}`);
  }
  const resolve = (url: string): StyleInfo | null => {
    const seen = new Set<string>();
    let cur = url.startsWith("#") ? url : `#${url}`;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const s = styles.get(cur);
      if (s) return s;
      const next = maps.get(cur);
      if (!next) return null;
      cur = next;
    }
    return null;
  };
  return { resolve };
};

/** Atributos de un Placemark: `description`, `ExtendedData/Data` y `SchemaData/SimpleData`. */
const placemarkProperties = (pm: Element): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  const desc = text(first(pm, "description"));
  if (desc) props.description = desc;
  const ext = first(pm, "ExtendedData");
  if (ext) {
    for (const d of named(ext, "Data")) {
      const key = d.getAttribute("name");
      if (!key) continue;
      props[key] = text(first(d, "value")) || text(d);
    }
    for (const sd of named(ext, "SchemaData")) {
      for (const s of named(sd, "SimpleData")) {
        const key = s.getAttribute("name");
        if (key) props[key] = text(s);
      }
    }
  }
  return props;
};

const UNSUPPORTED_GEOMS = new Set(["Model", "Track", "MultiTrack"]);

/** Convierte los elementos de geometría de un Placemark. `parts` = geometrías válidas. */
const kmlGeometry = (container: Element, problems: string[], unsupported: Set<string>): Geometry[] => {
  const parts: Geometry[] = [];
  for (const el of kids(container)) {
    switch (el.localName) {
      case "Point": {
        const pos = parseKmlCoordinates(text(first(el, "coordinates")));
        if (!pos || pos.length !== 1) {
          problems.push("punto con coordenadas ilegibles");
          break;
        }
        const r = normalizeGeometry({ type: "Point", coordinates: pos[0] });
        if (r.geometry) parts.push(r.geometry);
        problems.push(...r.problems);
        break;
      }
      case "LineString":
      case "LinearRing": {
        const pos = parseKmlCoordinates(text(first(el, "coordinates")));
        if (!pos) {
          problems.push("línea con coordenadas ilegibles");
          break;
        }
        const r = normalizeGeometry({ type: "LineString", coordinates: pos });
        if (r.geometry) parts.push(r.geometry);
        problems.push(...r.problems);
        break;
      }
      case "Polygon": {
        const ringsOf = (tag: string) =>
          named(el, tag).map((b) => parseKmlCoordinates(text(first(first(b, "LinearRing") ?? b, "coordinates"))));
        const outer = ringsOf("outerBoundaryIs")[0];
        if (!outer) {
          problems.push("polígono sin borde exterior");
          break;
        }
        const rings = [outer, ...ringsOf("innerBoundaryIs")];
        if (rings.some((r) => !r)) {
          problems.push("polígono con coordenadas ilegibles");
          break;
        }
        const r = normalizeGeometry({ type: "Polygon", coordinates: rings });
        if (r.geometry) parts.push(r.geometry);
        problems.push(...r.problems);
        break;
      }
      case "MultiGeometry":
        parts.push(...kmlGeometry(el, problems, unsupported));
        break;
      default:
        if (UNSUPPORTED_GEOMS.has(el.localName)) unsupported.add(el.localName);
    }
  }
  return parts;
};

interface Container {
  name: string;
  subs: Container[];
  placemarks: { pm: Element; path: string[] }[];
  path: string[];
}

const UNSUPPORTED_ELEMENTS = new Set(["NetworkLink", "GroundOverlay", "ScreenOverlay", "PhotoOverlay"]);

const dominant = <T,>(values: (T | null)[]): T | null => {
  const counts = new Map<T, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
};

class Builder {
  issues: ImportIssue[] = [];
  invalid = 0;
  unsupportedSeen = new Map<string, number>();

  add(kind: ImportIssueKind, path: string[], name: string | null, reason: string) {
    this.issues.push({ kind, path, name, reason });
  }

  /** Hace una capa a partir de Placemarks (o ninguna si todos eran inválidos). */
  layer(key: string, name: string, items: { feature: Omit<ImportFeature, "key"> }[]): ImportNode | null {
    if (!items.length) return null;
    const seen = new Set<string>();
    const features: ImportFeature[] = items.map(({ feature }, i) => {
      let externalId = feature.externalId;
      if (externalId) {
        if (seen.has(externalId)) {
          this.add("warning", [name], feature.name, `id repetido (${externalId}): se importa sin id`);
          externalId = null;
        } else seen.add(externalId);
      }
      return { ...feature, externalId, key: `${key}#${i}` };
    });
    return {
      key,
      kind: "layer",
      name,
      color: dominant(features.map((f) => f.color)),
      icon: dominant(features.map((f) => f.icon)),
      features,
    };
  }
}

const buildKml = (xml: string, filename: string): ImportDocument => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("KML inválido (no es un XML bien formado)");
  const kmlRoot = doc.documentElement;
  if (!kmlRoot) throw new Error("KML vacío");
  const { resolve: resolveStyle } = collectStyles(kmlRoot);
  const b = new Builder();

  // 1) Recorrer el XML armando contenedores (carpetas) en orden de archivo.
  const container = (el: Element, parentPath: string[]): Container => {
    const name = text(first(el, "name")) || "Sin nombre";
    const path = [...parentPath, name];
    const c: Container = { name, subs: [], placemarks: [], path };
    for (const child of kids(el)) {
      if (child.localName === "Folder" || child.localName === "Document") c.subs.push(container(child, path));
      else if (child.localName === "Placemark") c.placemarks.push({ pm: child, path });
      else if (UNSUPPORTED_ELEMENTS.has(child.localName)) {
        b.unsupportedSeen.set(child.localName, (b.unsupportedSeen.get(child.localName) ?? 0) + 1);
      }
    }
    return c;
  };
  const top = kmlRoot.localName === "kml" ? first(kmlRoot, "Document") ?? first(kmlRoot, "Folder") ?? kmlRoot : kmlRoot;
  const rootContainer = container(top, []);
  rootContainer.name = cleanDocName(rootContainer.name);
  if (!rootContainer.name || rootContainer.name === "Sin nombre") rootContainer.name = stripExt(filename);

  // 2) Placemark → feature validado.
  const toFeature = (pm: Element, path: string[]): Omit<ImportFeature, "key"> | null => {
    const name = text(first(pm, "name")) || null;
    const problems: string[] = [];
    const unsupported = new Set<string>();
    const parts = kmlGeometry(pm, problems, unsupported);
    if (!parts.length) {
      if (unsupported.size) {
        for (const u of unsupported) b.unsupportedSeen.set(u, (b.unsupportedSeen.get(u) ?? 0) + 1);
        return null;
      }
      const hasGeom = kids(pm).some((c) => ["Point", "LineString", "LinearRing", "Polygon", "MultiGeometry"].includes(c.localName));
      if (hasGeom) {
        b.invalid++;
        b.add("invalid-geometry", path, name, problems[0] ?? "geometría inválida");
      } else {
        b.add("no-geometry", path, name, "el Placemark no tiene geometría");
      }
      return null;
    }
    if (problems.length) b.add("warning", path, name, `se importó parcialmente: ${problems[0]}`);

    const props = placemarkProperties(pm);
    const styleUrl = text(first(pm, "styleUrl"));
    const inline = first(pm, "Style");
    const style = (inline && styleInfoOf(inline)) ?? (styleUrl ? resolveStyle(styleUrl) : null);
    const id = pm.getAttribute("id");
    const ext = typeof props.external_id === "string" && props.external_id ? props.external_id : null;
    return {
      externalId: id || ext,
      name,
      geometry: mergeParts(parts)!,
      properties: props,
      icon: style?.icon ?? null,
      color: style?.color ?? null,
    };
  };

  // 3) Contenedores → nodos (carpeta / capa).
  const toNode = (c: Container, key: string): ImportNode | null => {
    const feats = c.placemarks
      .map(({ pm, path }) => toFeature(pm, path))
      .filter((f): f is Omit<ImportFeature, "key"> => !!f)
      .map((feature) => ({ feature }));

    if (!c.subs.length) {
      const layer = b.layer(key, c.name, feats);
      if (!layer && c.placemarks.length === 0) b.add("warning", c.path, null, "carpeta vacía (se omitió)");
      return layer;
    }

    const children: ImportNode[] = [];
    const direct = b.layer(`${key}.0`, "Sin subcarpeta", feats);
    if (direct) children.push(direct);
    c.subs.forEach((s) => {
      const node = toNode(s, `${key}.${children.length}`);
      if (node) children.push(node);
    });
    if (!children.length) return null;
    // Las claves deben seguir la posición final (por si se omitió alguna).
    const rekey = (n: ImportNode, k: string): ImportNode => {
      const out: ImportNode = { ...n, key: k };
      if (n.children) out.children = n.children.map((ch, i) => rekey(ch, `${k}.${i}`));
      if (n.features) out.features = n.features.map((f, i) => ({ ...f, key: `${k}#${i}` }));
      return out;
    };
    return { key, kind: "folder", name: c.name, color: null, icon: null, children: children.map((ch, i) => rekey(ch, `${key}.${i}`)) };
  };

  const root = toNode(rootContainer, "0");
  if (!root) throw new Error("El archivo no contiene ningún punto, línea o polígono importable");

  for (const [kind, n] of b.unsupportedSeen) {
    b.add("unsupported", [], null, `${n} elemento(s) ${kind} no se importan (solo puntos, líneas y polígonos)`);
  }
  return finish(filename, "kml", root, b);
};

// ── Documento terminado ──────────────────────────────────────────────────────

const countNodes = (n: ImportNode, acc = { folders: 0, layers: 0, features: 0 }) => {
  if (n.kind === "folder") {
    acc.folders++;
    n.children?.forEach((c) => countNodes(c, acc));
  } else {
    acc.layers++;
    acc.features += n.features?.length ?? 0;
  }
  return acc;
};

const finish = (filename: string, format: ImportFormat, root: ImportNode, b: Builder): ImportDocument => ({
  filename,
  format,
  root,
  issues: b.issues,
  counts: { ...countNodes(root), invalid: b.invalid },
});

// ── KMZ ──────────────────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(bin);
};

/** Íconos relativos del KMZ (p. ej. `files/pin.png`) → data URL; los demasiado grandes se descartan. */
const resolveKmzIcons = async (doc: ImportDocument, zip: JSZip) => {
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const byLower = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const byBase = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const base = e.name.toLowerCase().split("/").pop() ?? "";
    if (!byBase.has(base)) byBase.set(base, e);
  }
  const cache = new Map<string, string | null>();
  let dropped = 0;
  const resolve = async (href: string): Promise<string | null> => {
    if (/^(https?:|data:)/i.test(href)) return href;
    if (cache.has(href)) return cache.get(href)!;
    let clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
    try {
      clean = decodeURIComponent(clean);
    } catch {
      /* se deja como vino */
    }
    const entry = byLower.get(clean.toLowerCase()) ?? byBase.get(clean.toLowerCase().split("/").pop() ?? "");
    let out: string | null = null;
    if (entry) {
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      const url = `data:${MIME_BY_EXT[ext] ?? "application/octet-stream"};base64,${toBase64(await entry.async("uint8array"))}`;
      if (url.length <= MAX_ICON_CHARS) out = url;
      else dropped++;
    }
    cache.set(href, out);
    return out;
  };
  const visit = async (n: ImportNode) => {
    if (n.kind === "folder") {
      for (const c of n.children ?? []) await visit(c);
      return;
    }
    for (const f of n.features ?? []) if (f.icon) f.icon = await resolve(f.icon);
    n.icon = dominant((n.features ?? []).map((f) => f.icon));
  };
  await visit(doc.root);
  if (dropped) {
    doc.issues.push({ kind: "warning", path: [], name: null, reason: `${dropped} ícono(s) del KMZ pesan demasiado y no se guardarán (se conserva el color)` });
  }
};

const parseKmz = async (buffer: ArrayBuffer, filename: string): Promise<ImportDocument> => {
  const zip = await JSZip.loadAsync(buffer);
  const kmls = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith(".kml"));
  if (!kmls.length) throw new Error("El KMZ no contiene ningún archivo .kml");
  // doc.kml es el estándar; si no, el .kml más cercano a la raíz.
  const entry = kmls.find((k) => k.name.toLowerCase() === "doc.kml") ?? kmls.sort((a, b) => a.name.split("/").length - b.name.split("/").length)[0];
  const doc = buildKml(await entry.async("string"), filename);
  doc.format = "kmz";
  await resolveKmzIcons(doc, zip);
  return doc;
};

// ── GeoJSON ──────────────────────────────────────────────────────────────────

const NAME_KEYS = ["name", "Name", "NAME", "nombre", "Nombre", "title", "titulo"];
const ID_KEYS = ["external_id", "id", "codigo", "código", "cod"];

const pickString = (props: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = props[k];
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  }
  return null;
};

type GeoJsonLike = { type?: string; features?: unknown[]; geometry?: unknown; name?: string; id?: unknown; properties?: unknown };

const buildGeoJson = (textContent: string, filename: string): ImportDocument => {
  let obj: GeoJsonLike;
  try {
    obj = JSON.parse(textContent);
  } catch {
    throw new Error("GeoJSON inválido (no es JSON)");
  }
  return buildGeoJsonObject(obj, filename);
};

const buildGeoJsonObject = (obj: GeoJsonLike, filename: string): ImportDocument => {
  let features: { type?: string; geometry?: unknown; properties?: unknown; id?: unknown }[];
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) features = obj.features as typeof features;
  else if (obj.type === "Feature") features = [obj as (typeof features)[number]];
  else if (obj.type) features = [{ type: "Feature", geometry: obj, properties: {} }];
  else throw new Error("GeoJSON debe ser Feature, FeatureCollection o una geometría");

  const b = new Builder();
  const byPath = new Map<string, { path: string[]; items: { feature: Omit<ImportFeature, "key"> }[] }>();
  features.forEach((f, i) => {
    const props = (f?.properties && typeof f.properties === "object" ? { ...(f.properties as Record<string, unknown>) } : {}) as Record<string, unknown>;
    const folderPath = Array.isArray(props._folderPath) ? (props._folderPath as unknown[]).filter((x): x is string => typeof x === "string" && !!x) : [];
    delete props._folderPath;
    const name = pickString(props, NAME_KEYS);
    const r = normalizeGeometry(f?.geometry);
    if (!r.geometry) {
      const reason = r.problems[0] ?? "geometría inválida";
      if (reason === "sin geometría") b.add("no-geometry", folderPath, name, `el feature ${i + 1} no tiene geometría`);
      else {
        b.invalid++;
        b.add("invalid-geometry", folderPath, name, reason);
      }
      return;
    }
    if (r.problems.length) b.add("warning", folderPath, name, `se importó parcialmente: ${r.problems[0]}`);
    const hex = typeof props.color === "string" && /^#[0-9a-f]{6}$/i.test(props.color) ? props.color.toLowerCase() : null;
    const icon = typeof props.icon === "string" && /^(https?:|data:)/i.test(props.icon) ? normalizeIconUrl(props.icon) : null;
    const feature = {
      externalId: f.id != null ? String(f.id) : pickString(props, ID_KEYS),
      name,
      geometry: r.geometry,
      properties: props,
      icon,
      color: hex,
    };
    const k = folderPath.join("\u0000");
    const bucket = byPath.get(k) ?? { path: folderPath, items: [] };
    bucket.items.push({ feature });
    byPath.set(k, bucket);
  });
  return finish(filename, "geojson", foldersFromBuckets([...byPath.values()], obj.name?.trim() || stripExt(filename), b), b);
};

/** Cubetas por carpeta (ruta de nombres) → árbol; sin carpetas es una sola capa. */
const foldersFromBuckets = (
  buckets: { path: string[]; items: { feature: Omit<ImportFeature, "key"> }[] }[],
  docName: string,
  b: Builder,
): ImportNode => {
  if (!buckets.length) throw new Error("El archivo no contiene ningún elemento importable");
  if (buckets.length === 1 && buckets[0].path.length === 0) return b.layer("0", docName, buckets[0].items)!;

  type Tmp = { name: string; subs: Map<string, Tmp>; items: { feature: Omit<ImportFeature, "key"> }[] };
  const rootTmp: Tmp = { name: docName, subs: new Map(), items: [] };
  for (const bucket of buckets) {
    let cur = rootTmp;
    for (const seg of bucket.path) {
      let nxt = cur.subs.get(seg);
      if (!nxt) {
        nxt = { name: seg, subs: new Map(), items: [] };
        cur.subs.set(seg, nxt);
      }
      cur = nxt;
    }
    cur.items.push(...bucket.items);
  }
  const toNode = (t: Tmp, key: string): ImportNode | null => {
    if (!t.subs.size) return b.layer(key, t.name, t.items);
    const children: ImportNode[] = [];
    const direct = b.layer(`${key}.0`, "Sin subcarpeta", t.items);
    if (direct) children.push(direct);
    for (const s of t.subs.values()) {
      const n = toNode(s, `${key}.${children.length}`);
      if (n) children.push(n);
    }
    const fixed = (n: ImportNode, k: string): ImportNode => ({
      ...n,
      key: k,
      children: n.children?.map((c, i) => fixed(c, `${k}.${i}`)),
      features: n.features?.map((f, i) => ({ ...f, key: `${k}#${i}` })),
    });
    return { key, kind: "folder", name: t.name, color: null, icon: null, children: children.map((c, i) => fixed(c, `${key}.${i}`)) };
  };
  return toNode(rootTmp, "0")!;
};

// ── CSV ──────────────────────────────────────────────────────────────────────

const LAT_KEYS = ["lat", "latitude", "latitud", "y"];
const LNG_KEYS = ["lng", "lon", "long", "longitude", "longitud", "x"];
const LAYER_KEYS = ["layer", "layer_name", "capa", "folder", "carpeta", "category", "categoria", "categoría", "group", "grupo"];

const toCoord = (raw: string | undefined): number => {
  const s = (raw ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  // "-33,45" (coma decimal) o "-33.45"; con miles ("1.234,5") no aplica a coordenadas.
  return Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s);
};

const buildCsv = (textContent: string, filename: string): ImportDocument => {
  const { headers, rows } = parseCsvRows(textContent);
  if (!rows.length) throw new Error("El CSV está vacío o no tiene filas de datos");
  const lower = headers.map((h) => h.toLowerCase().trim());
  const idx = (keys: string[]) => lower.findIndex((h) => keys.includes(h));
  const latI = idx(LAT_KEYS);
  const lngI = idx(LNG_KEYS);
  if (latI === -1 || lngI === -1) {
    throw new Error(`No se encontraron las columnas de coordenadas. Se esperaba una de ${LAT_KEYS.join("/")} y una de ${LNG_KEYS.join("/")}; el archivo trae: ${headers.join(", ")}`);
  }
  const nameI = idx(NAME_KEYS.map((k) => k.toLowerCase()));
  const idI = idx(ID_KEYS);
  const layerI = idx(LAYER_KEYS);

  const b = new Builder();
  const byLayer = new Map<string, { feature: Omit<ImportFeature, "key"> }[]>();
  rows.forEach((row, n) => {
    const lat = toCoord(row[latI]);
    const lng = toCoord(row[lngI]);
    const name = nameI >= 0 ? (row[nameI] ?? "").trim() || null : null;
    const r = normalizeGeometry({ type: "Point", coordinates: [lng, lat] });
    const layerName = layerI >= 0 && (row[layerI] ?? "").trim() ? row[layerI].trim() : stripExt(filename);
    if (!r.geometry) {
      b.invalid++;
      b.add("invalid-geometry", [layerName], name, `fila ${n + 2}: ${r.problems[0] ?? "coordenadas inválidas"}`);
      return;
    }
    const props: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (i !== latI && i !== lngI && h && (row[i] ?? "") !== "") props[h] = row[i];
    });
    const list = byLayer.get(layerName) ?? [];
    list.push({
      feature: { externalId: idI >= 0 ? (row[idI] ?? "").trim() || null : null, name, geometry: r.geometry, properties: props, icon: null, color: null },
    });
    byLayer.set(layerName, list);
  });
  if (!byLayer.size) throw new Error("Ninguna fila del CSV tiene coordenadas válidas");

  const entries = [...byLayer.entries()];
  const rootName = stripExt(filename);
  if (entries.length === 1) return finish(filename, "csv", b.layer("0", entries[0][0], entries[0][1])!, b);
  const children = entries.map(([name, items], i) => b.layer(`0.${i}`, name, items)!);
  const root: ImportNode = { key: "0", kind: "folder", name: rootName, color: null, icon: null, children };
  return finish(filename, "csv", root, b);
};

// ── HTML de mapas (Leaflet/Folium, Google My Maps, KML embebido) ─────────────

/**
 * El HTML se convierte a GeoJSON en el navegador (misma lógica que ya usaba la carga antigua) y de
 * ahí sigue el camino del GeoJSON: el `folder` que trae cada punto pasa a ser su carpeta.
 */
const buildHtml = (html: string, filename: string): ImportDocument => {
  const fc = htmlToGeoJson(html);
  if (!fc.features.length) {
    throw new Error(
      "No se encontraron puntos en el HTML. Se reconocen mapas exportados con Leaflet/Folium, Google My Maps o con un KML incrustado; " +
        "si el mapa viene de otra herramienta, expórtalo como KML o GeoJSON desde su origen.",
    );
  }
  const features = fc.features.map((f) => {
    const folder = typeof f.properties?.folder === "string" ? f.properties.folder.trim() : "";
    return folder ? { ...f, properties: { ...f.properties, _folderPath: [folder] } } : f;
  });
  return buildGeoJsonObject({ type: "FeatureCollection", features }, filename);
};

// ── Punto de entrada ─────────────────────────────────────────────────────────

/** Lee un archivo (KMZ, KML, GeoJSON, CSV o HTML de un mapa) y devuelve el árbol de capas listo para previsualizar. */
export const parseImportFile = async (file: File): Promise<ImportDocument> => {
  const format = importFormatOf(file.name);
  if (!format) throw new Error("Formato no soportado. Usa KMZ, KML, GeoJSON, CSV o HTML.");
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`El archivo pesa ${(file.size / 1048576).toFixed(1)} MB y el máximo es ${MAX_FILE_SIZE / 1048576} MB`);
  }
  if (format === "kmz") return parseKmz(await file.arrayBuffer(), file.name);
  const content = await file.text();
  if (format === "kml") return buildKml(content, file.name);
  if (format === "geojson") return buildGeoJson(content, file.name);
  if (format === "html") return buildHtml(content, file.name);
  return buildCsv(content, file.name);
};

/** Variantes para pruebas y para quien ya tiene el contenido en memoria. */
export const parseImportContent = {
  kml: buildKml,
  geojson: buildGeoJson,
  csv: buildCsv,
  html: buildHtml,
  kmz: parseKmz,
};

// ── Utilidades sobre el documento ────────────────────────────────────────────

export const layersOf = (root: ImportNode): ImportNode[] => {
  const out: ImportNode[] = [];
  const walk = (n: ImportNode) => (n.kind === "layer" ? out.push(n) : n.children?.forEach(walk));
  walk(root);
  return out;
};

/** ¿La clave `key` queda dentro de alguna de las excluidas (ella misma o una carpeta ancestra)? */
export const isExcluded = (key: string, excluded: ReadonlySet<string>): boolean => {
  if (excluded.has(key)) return true;
  for (let k = key; k.includes("."); ) {
    k = k.slice(0, k.lastIndexOf("."));
    if (excluded.has(k)) return true;
  }
  return false;
};

export const includedCounts = (doc: ImportDocument, excluded: ReadonlySet<string>) => {
  const layers = layersOf(doc.root).filter((l) => !isExcluded(l.key, excluded));
  return { layers: layers.length, features: layers.reduce((s, l) => s + (l.features?.length ?? 0), 0) };
};

/** Estructura sin puntos, para guardar en el lote de importación. */
export const structureOf = (n: ImportNode): Record<string, unknown> => ({
  key: n.key,
  kind: n.kind,
  name: n.name,
  color: n.color,
  icon: n.icon,
  ...(n.kind === "folder" ? { children: (n.children ?? []).map(structureOf) } : { count: n.features?.length ?? 0 }),
});

/**
 * El documento como FeatureCollection plano (lo que se descarga o se da a otras herramientas):
 * cada punto lleva el nombre de su capa y la ruta de carpetas.
 */
export const documentToGeoJson = (doc: ImportDocument, excluded: ReadonlySet<string> = new Set()) => {
  const features: { type: "Feature"; geometry: Geometry; properties: Record<string, unknown> }[] = [];
  const walk = (n: ImportNode, path: string[]) => {
    if (isExcluded(n.key, excluded)) return;
    if (n.kind === "folder") {
      const next = n.key === doc.root.key ? path : [...path, n.name];
      n.children?.forEach((c) => walk(c, next));
      return;
    }
    for (const f of n.features ?? []) {
      features.push({
        type: "Feature",
        geometry: f.geometry,
        properties: { ...f.properties, ...(f.name ? { name: f.name } : {}), layer: n.name, _folderPath: path },
      });
    }
  };
  walk(doc.root, []);
  return { type: "FeatureCollection" as const, features };
};
