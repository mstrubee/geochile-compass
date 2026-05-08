// deno-lint-ignore-file no-explicit-any
export interface ScannedFeature {
  external_id: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
  geometry: any;
  properties: Record<string, unknown>;
}
export interface ScannedLayer {
  name: string;
  count: number;
  features: ScannedFeature[];
}

// ---------- Helpers ----------

/**
 * Find the matching closing bracket for the opening bracket at `start`.
 * Respects strings (single, double, backtick), escapes and nested brackets.
 * Returns the index of the matching closer, or -1.
 */
const findMatching = (src: string, start: number): number => {
  const open = src[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : open === "(" ? ")" : "";
  if (!close) return -1;
  let depth = 0;
  let i = start;
  let str: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (str) {
      if (c === "\\") { i += 2; continue; }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; i++; continue; }
    // skip line / block comments
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i); if (nl < 0) return -1; i = nl + 1; continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2); if (end < 0) return -1; i = end + 2; continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
};

/** Best-effort JSON5-ish parse: strip trailing commas, single→double quotes for keys/values when safe. */
const looseJsonParse = (text: string): any | null => {
  // Try strict first
  try { return JSON.parse(text); } catch { /* fall through */ }
  let t = text;
  // Remove JS comments
  t = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // Trailing commas
  t = t.replace(/,(\s*[}\]])/g, "$1");
  // Quote unquoted keys: { key: ... } => { "key": ... }
  t = t.replace(/([{,\s])([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  // Single-quoted strings → double quoted (naive; OK for Folium output)
  t = t.replace(/'((?:\\.|[^'\\])*)'/g, (_m, inner) => {
    return JSON.stringify(inner.replace(/\\'/g, "'"));
  });
  try { return JSON.parse(t); } catch { return null; }
};

/** Parse a Leaflet latLng-like array literal: [lat, lng] or [[lat,lng],...] */
const parseCoordsLiteral = (text: string): number[] | number[][] | null => {
  const v = looseJsonParse(text);
  if (!Array.isArray(v)) return null;
  return v as any;
};

// ---------- KML / Folder parser (legacy) ----------

const parseKmlFolders = (html: string): ScannedLayer[] => {
  const layers = new Map<string, ScannedLayer>();
  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, count: 0, features: [] });
    return layers.get(name)!;
  };
  const folderRe = /<Folder\b[^>]*>([\s\S]*?)<\/Folder>/gi;
  const placemarkRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  const nameRe = /<name>([\s\S]*?)<\/name>/i;
  const coordRe = /<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/i;
  const idRe = /<Placemark\s+id=["']([^"']+)["']/i;
  const matches = [...html.matchAll(folderRe)];
  if (!matches.length) return [];
  for (const m of matches) {
    const inner = m[1];
    const folderName = (inner.match(/^[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1] || "Capa").trim();
    const layer = ensure(folderName);
    const pms = [...inner.matchAll(placemarkRe)];
    for (const pm of pms) {
      const pmHtml = pm[0];
      const body = pm[1];
      const nameMatch = body.match(nameRe);
      const coordMatch = body.match(coordRe);
      const idMatch = pmHtml.match(idRe);
      if (!coordMatch) continue;
      const coordStr = coordMatch[1].trim();
      const tuples = coordStr.split(/\s+/).map((t) => {
        const [lng, lat] = t.split(",").map(Number);
        return [lng, lat];
      }).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      if (!tuples.length) continue;
      const isPoint = tuples.length === 1;
      const geometry = isPoint
        ? { type: "Point", coordinates: tuples[0] }
        : { type: "LineString", coordinates: tuples };
      layer.features.push({
        external_id: idMatch?.[1] ?? null,
        name: nameMatch?.[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? null,
        lat: isPoint ? tuples[0][1] : null,
        lng: isPoint ? tuples[0][0] : null,
        geometry,
        properties: {},
      });
      layer.count++;
    }
  }
  return Array.from(layers.values()).filter((l) => l.count > 0);
};

// ---------- JS-array fallback (legacy) ----------

const parseJsArrays = (html: string): ScannedLayer[] => {
  const layers = new Map<string, ScannedLayer>();
  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, count: 0, features: [] });
    return layers.get(name)!;
  };
  const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[[\s\S]*?\]);/g;
  for (const m of html.matchAll(varRe)) {
    const varName = m[1];
    const arr = looseJsonParse(m[2]);
    if (!Array.isArray(arr)) continue;
    const layer = ensure(varName);
    for (const obj of arr) {
      if (!obj || typeof obj !== "object") continue;
      const lat = Number((obj as any).lat ?? (obj as any).latitude ?? (obj as any).LAT);
      const lng = Number((obj as any).lng ?? (obj as any).lon ?? (obj as any).longitude ?? (obj as any).LON ?? (obj as any).LNG);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      layer.features.push({
        external_id: (obj as any).id != null ? String((obj as any).id) : null,
        name: (obj as any).name ?? (obj as any).Name ?? (obj as any).title ?? null,
        lat, lng,
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: obj as any,
      });
      layer.count++;
    }
  }
  return Array.from(layers.values()).filter((l) => l.count > 0);
};

// ---------- Leaflet / Folium parser (new) ----------

/**
 * Parse a Leaflet HTML (often produced by Folium/branca) by:
 *  1. Building var → displayName map from L.control.layers(base, overlays).
 *  2. Resolving a chain of var → var aliases (var a = b;) so groups added to
 *     intermediate variables still flow to the right overlay.
 *  3. Walking marker / circle / polygon / polyline / geoJson constructors and
 *     attributing them to a group via .addTo(varName).
 */
export const parseLeafletHtml = (html: string): ScannedLayer[] => {
  // 1. Find L.control.layers(...) and extract overlays object (2nd arg).
  const overlayMap = new Map<string, string>(); // varName -> displayName

  const ctrlRe = /L\.control\.layers\s*\(/g;
  for (const m of html.matchAll(ctrlRe)) {
    const open = (m.index ?? 0) + m[0].length - 1; // position of '('
    const close = findMatching(html, open);
    if (close < 0) continue;
    const args = html.slice(open + 1, close);
    // Split top-level into args by walking
    const parts: string[] = [];
    let depth = 0, str: string | null = null, last = 0;
    for (let i = 0; i < args.length; i++) {
      const c = args[i];
      if (str) {
        if (c === "\\") { i++; continue; }
        if (c === str) str = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { str = c; continue; }
      if (c === "{" || c === "[" || c === "(") depth++;
      else if (c === "}" || c === "]" || c === ")") depth--;
      else if (c === "," && depth === 0) { parts.push(args.slice(last, i)); last = i + 1; }
    }
    parts.push(args.slice(last));
    if (parts.length < 2) continue;
    const overlaysSrc = parts[1].trim();
    if (!overlaysSrc.startsWith("{")) continue;
    const closeObj = findMatching(overlaysSrc, 0);
    if (closeObj < 0) continue;
    const objBody = overlaysSrc.slice(1, closeObj);
    // Parse "key" : varName entries
    const entryRe = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*:\s*([A-Za-z_$][\w$]*)/g;
    for (const e of objBody.matchAll(entryRe)) {
      const name = (e[1] ?? e[2] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      overlayMap.set(e[3], name);
    }
  }

  // Folium pattern: layer_control_xxx.overlays = { "Name": var_xx, ... } OR control.addOverlay(group, "Name")
  const overlaysAssignRe = /\.\s*overlays\s*=\s*\{([\s\S]*?)\};/g;
  for (const m of html.matchAll(overlaysAssignRe)) {
    const body = m[1];
    const entryRe = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*:\s*([A-Za-z_$][\w$]*)/g;
    for (const e of body.matchAll(entryRe)) {
      const name = (e[1] ?? e[2] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      overlayMap.set(e[3], name);
    }
  }
  const addOverlayRe = /\.addOverlay\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
  for (const m of html.matchAll(addOverlayRe)) {
    const name = (m[2] ?? m[3] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
    overlayMap.set(m[1], name);
  }

  if (!overlayMap.size) return [];

  // 2. Resolve aliases AND parent links transitively.
  // - alias:  var a = b;
  // - parent (chained): var sub = L.something(...).addTo(parent)
  //                     var sub = L.featureGroup.subGroup(parent, ...);
  // - parent (separate stmt): sub.addTo(parent);
  const parent = new Map<string, string>();

  const aliasRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
  for (const m of html.matchAll(aliasRe)) parent.set(m[1], m[2]);

  // Separate-statement: SUB.addTo(PARENT);  (only when SUB is a simple ident)
  const addToStmtRe = /(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*\.addTo\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const m of html.matchAll(addToStmtRe)) {
    if (!parent.has(m[1])) parent.set(m[1], m[2]);
  }

  // L.featureGroup.subGroup(parent, ...) and L.markerClusterGroup({...}).addTo(parent)
  const subGroupRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*L\.featureGroup\.subGroup\s*\(\s*([A-Za-z_$][\w$]*)/g;
  for (const m of html.matchAll(subGroupRe)) parent.set(m[1], m[2]);

  const resolveGroup = (v: string): string | undefined => {
    let cur = v;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (overlayMap.has(cur)) return overlayMap.get(cur);
      seen.add(cur);
      const next = parent.get(cur);
      if (!next) return undefined;
      cur = next;
    }
    return undefined;
  };

  // 3. Prepare layer accumulator
  const layers = new Map<string, ScannedLayer>();
  const ensure = (display: string) => {
    if (!layers.has(display)) layers.set(display, { name: display, count: 0, features: [] });
    return layers.get(display)!;
  };

  type Constructor =
    | "marker" | "circleMarker" | "circle"
    | "polygon" | "polyline" | "rectangle" | "geoJson";
  const ctorRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*L\.(marker|circleMarker|circle|polygon|polyline|rectangle|geoJson)\s*\(/g;

  // Helper: find the immediate `.addTo(GROUP)` and `.bindPopup/.bindTooltip("...")`
  // occurring in the chained suffix after a constructor's closing ')'.
  // Reads up to the next ';' or newline at depth 0.
  const readChainedSuffix = (src: string, from: number): { group: string | null; popup: string | null } => {
    let i = from;
    let depth = 0, str: string | null = null;
    let end = src.length;
    while (i < src.length) {
      const c = src[i];
      if (str) {
        if (c === "\\") { i += 2; continue; }
        if (c === str) str = null;
        i++; continue;
      }
      if (c === '"' || c === "'" || c === "`") { str = c; i++; continue; }
      if (c === "(" || c === "{" || c === "[") { depth++; i++; continue; }
      if (c === ")" || c === "}" || c === "]") { depth--; i++; continue; }
      if (depth === 0 && (c === ";" || c === "\n")) { end = i; break; }
      i++;
    }
    const suffix = src.slice(from, end);
    let group: string | null = null;
    const gM = suffix.match(/\.addTo\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
    if (gM) group = gM[1];
    let popup: string | null = null;
    const pM = suffix.match(/\.bind(?:Popup|Tooltip)\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/);
    if (pM) {
      const t = (pM[1] ?? pM[2] ?? pM[3] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) popup = t;
    }
    return { group, popup };
  };

  // Fallback popup index for popups bound in a separate statement.
  const popupByVar = new Map<string, string>();
  const popupRe = /([A-Za-z_$][\w$]*)\s*\.bind(?:Popup|Tooltip)\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
  for (const m of html.matchAll(popupRe)) {
    const txt = (m[2] ?? m[3] ?? m[4] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (txt) popupByVar.set(m[1], txt);
  }

  // 4. Walk every L.<ctor> assignment.
  let mm: RegExpExecArray | null;
  ctorRe.lastIndex = 0;
  while ((mm = ctorRe.exec(html))) {
    const varName = mm[1];
    const ctor = mm[2] as Constructor;
    const openIdx = mm.index + mm[0].length - 1;
    const closeIdx = findMatching(html, openIdx);
    if (closeIdx < 0) continue;
    const argsSrc = html.slice(openIdx + 1, closeIdx);

    // Where does this thing get added to?
    const groupVar = addToByVar.get(varName);
    if (!groupVar) continue;
    const display = resolvedOverlay.get(resolveAlias(groupVar));
    if (!display) continue;

    const layer = ensure(display);

    // First arg: a literal (array of coords) or an object (geojson)
    // Find first top-level argument
    const firstArg = (() => {
      let depth = 0, str: string | null = null;
      for (let i = 0; i < argsSrc.length; i++) {
        const c = argsSrc[i];
        if (str) { if (c === "\\") { i++; continue; } if (c === str) str = null; continue; }
        if (c === '"' || c === "'" || c === "`") { str = c; continue; }
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") depth--;
        else if (c === "," && depth === 0) return argsSrc.slice(0, i).trim();
      }
      return argsSrc.trim();
    })();

    const popup = popupByVar.get(varName) ?? null;

    if (ctor === "marker" || ctor === "circleMarker" || ctor === "circle") {
      const coords = parseCoordsLiteral(firstArg);
      if (!coords || coords.length < 2 || typeof coords[0] !== "number") continue;
      const lat = Number((coords as number[])[0]);
      const lng = Number((coords as number[])[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      layer.features.push({
        external_id: null,
        name: popup,
        lat, lng,
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: popup ? { popup } : {},
      });
      layer.count++;
    } else if (ctor === "polyline") {
      const coords = parseCoordsLiteral(firstArg);
      if (!Array.isArray(coords) || !coords.length || !Array.isArray((coords as any)[0])) continue;
      const ring = (coords as number[][]).map(([lat, lng]) => [Number(lng), Number(lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      if (ring.length < 2) continue;
      layer.features.push({
        external_id: null, name: popup, lat: null, lng: null,
        geometry: { type: "LineString", coordinates: ring },
        properties: popup ? { popup } : {},
      });
      layer.count++;
    } else if (ctor === "polygon" || ctor === "rectangle") {
      const coords = parseCoordsLiteral(firstArg);
      if (!Array.isArray(coords) || !coords.length) continue;
      // Could be [[lat,lng],...] or [[[lat,lng],...]] (with holes)
      const toGeoRing = (r: number[][]) =>
        r.map(([lat, lng]) => [Number(lng), Number(lat)])
          .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      let rings: number[][][];
      if (Array.isArray((coords as any)[0]) && Array.isArray((coords as any)[0][0])) {
        rings = (coords as number[][][]).map(toGeoRing);
      } else {
        rings = [toGeoRing(coords as number[][])];
      }
      // Special: rectangle has only 2 corners → expand
      if (ctor === "rectangle" && rings[0].length === 2) {
        const [[x1, y1], [x2, y2]] = rings[0];
        rings = [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]];
      }
      // Close rings if needed
      for (const r of rings) {
        if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) {
          r.push([r[0][0], r[0][1]]);
        }
      }
      if (!rings[0] || rings[0].length < 4) continue;
      layer.features.push({
        external_id: null, name: popup, lat: null, lng: null,
        geometry: { type: "Polygon", coordinates: rings },
        properties: popup ? { popup } : {},
      });
      layer.count++;
    } else if (ctor === "geoJson") {
      const data = looseJsonParse(firstArg);
      if (!data) continue;
      const feats: any[] = data?.type === "FeatureCollection" ? (data.features ?? [])
        : data?.type === "Feature" ? [data]
        : data?.type ? [{ type: "Feature", geometry: data, properties: {} }]
        : Array.isArray(data) ? data : [];
      for (const f of feats) {
        const g = f?.geometry ?? (f?.type ? f : null);
        if (!g?.type) continue;
        const props = (f?.properties && typeof f.properties === "object") ? f.properties : {};
        let lat: number | null = null, lng: number | null = null;
        if (g.type === "Point" && Array.isArray(g.coordinates)) {
          lng = Number(g.coordinates[0]); lat = Number(g.coordinates[1]);
        }
        layer.features.push({
          external_id: f.id != null ? String(f.id) : (props.id != null ? String(props.id) : null),
          name: props.name ?? props.Name ?? props.title ?? popup ?? null,
          lat: Number.isFinite(lat as number) ? lat : null,
          lng: Number.isFinite(lng as number) ? lng : null,
          geometry: g,
          properties: props,
        });
        layer.count++;
      }
    }
  }

  // Ensure every overlay group appears even if empty (filtered later)
  return Array.from(layers.values()).filter((l) => l.count > 0);
};

// ---------- GeoJSON ----------

const pointFromGeometry = (g: any): { lat: number | null; lng: number | null } => {
  if (g?.type === "Point" && Array.isArray(g.coordinates)) {
    const lng = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    return {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  }
  return { lat: null, lng: null };
};

const layerNameFrom = (props: Record<string, unknown>, g: any): string => {
  const raw = props.layer ?? props.layer_name ?? props.folder ?? props.Folder ?? props.category ?? props.group;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  if (g?.type === "Point" || g?.type === "MultiPoint") return "Puntos";
  if (g?.type === "Polygon" || g?.type === "MultiPolygon") return "Polígonos";
  if (g?.type === "LineString" || g?.type === "MultiLineString") return "Líneas";
  return "default";
};

export const parseGeoJson = (text: string): ScannedLayer[] => {
  const layers = new Map<string, ScannedLayer>();
  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, count: 0, features: [] });
    return layers.get(name)!;
  };
  let data: any;
  try { data = JSON.parse(text.replace(/^\uFEFF/, "").trim()); } catch (e) {
    console.warn("GeoJSON parse failed", e);
    return [];
  }
  const feats: any[] = data?.type === "FeatureCollection" ? (data.features ?? [])
    : data?.type === "Feature" ? [data]
    : Array.isArray(data) ? data : [];
  for (const f of feats) {
    const g = f?.geometry;
    if (!g?.type) continue;
    const props = f?.properties && typeof f.properties === "object" ? f.properties : {};
    const layer = ensure(layerNameFrom(props, g));
    const { lat, lng } = pointFromGeometry(g);
    layer.features.push({
      external_id: f.id != null ? String(f.id) : (props.id != null ? String(props.id) : null),
      name: props.name ?? props.Name ?? props.title ?? null,
      lat: Number.isFinite(lat as number) ? lat : null,
      lng: Number.isFinite(lng as number) ? lng : null,
      geometry: g,
      properties: props,
    });
    layer.count++;
  }
  return Array.from(layers.values()).filter((l) => l.count > 0);
};

// ---------- Public entrypoint ----------

export const parseHtml = (html: string): ScannedLayer[] => {
  // 1. Leaflet/Folium pattern (most common for our HTML maps)
  const leaflet = parseLeafletHtml(html);
  if (leaflet.length) return leaflet;
  // 2. KML <Folder>
  const kml = parseKmlFolders(html);
  if (kml.length) return kml;
  // 3. JS array fallback
  return parseJsArrays(html);
};

const parseKmz = async (buffer: ArrayBuffer): Promise<ScannedLayer[]> => {
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = await JSZip.loadAsync(buffer);
  let kmlEntry = zip.file("doc.kml");
  if (!kmlEntry) {
    const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith(".kml"));
    if (names.length) kmlEntry = zip.file(names[0]);
  }
  if (!kmlEntry) return [];
  const xml = await kmlEntry.async("string");
  return parseHtml(xml);
};

export const parseSource = async (
  fileType: string,
  text: string,
  buffer: ArrayBuffer | null,
): Promise<ScannedLayer[]> => {
  if (fileType === "geojson") return parseGeoJson(text);
  if (fileType === "kmz") return buffer ? await parseKmz(buffer) : [];
  return parseHtml(text);
};
