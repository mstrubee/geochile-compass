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

// ============================================================================
// Bracket / JSON helpers
// ============================================================================

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
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; i++; continue; }
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

const looseJsonParse = (text: string): any | null => {
  try { return JSON.parse(text); } catch { /* fall through */ }
  let t = text;
  t = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  t = t.replace(/,(\s*[}\]])/g, "$1");
  t = t.replace(/([{,\s])([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  t = t.replace(/'((?:\\.|[^'\\])*)'/g, (_m, inner) => {
    return JSON.stringify(inner.replace(/\\'/g, "'"));
  });
  try { return JSON.parse(t); } catch { return null; }
};

const parseCoordsLiteral = (text: string): number[] | number[][] | null => {
  const v = looseJsonParse(text);
  if (!Array.isArray(v)) return null;
  return v as any;
};

const findStmtEnd = (src: string, start: number): number => {
  let i = start, depth = 0, str: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (str) {
      if (c === "\\") { i += 2; continue; }
      if (c === str) str = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); if (nl < 0) return src.length; i = nl + 1; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return src.length; i = end + 2; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; i++; continue; }
    if (c === ";" && depth === 0) return i;
    i++;
  }
  return src.length;
};

const extractFirstArg = (argsSrc: string): string => {
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
};

// ============================================================================
// KML / Folder parser (legacy)
// ============================================================================

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

// ============================================================================
// JS-array fallback (legacy)
// ============================================================================

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

// ============================================================================
// Leaflet / Folium parser — v2 (variable index + transitive resolution)
// ============================================================================

type LfKind = "geometry" | "group" | "alias" | "unknown";
const LF_GEOM_CTORS = new Set([
  "marker", "circleMarker", "circle",
  "polygon", "polyline", "rectangle",
  "geoJson", "geoJSON",
]);
const LF_GROUP_CTORS = new Set([
  "featureGroup", "layerGroup", "markerClusterGroup",
  "featureGroup.subGroup", "FeatureGroup.SubGroup",
]);

interface LfVarInfo {
  name: string;
  kind: LfKind;
  ctor?: string;
  firstArg?: string;
  parentVar?: string;
  aliasOf?: string;
  popup?: string;
}

const buildLfVarIndex = (html: string): Map<string, LfVarInfo> => {
  const vars = new Map<string, LfVarInfo>();

  // Phase 1: scan every `var/let/const NAME = ...;`
  const declRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(html))) {
    const name = m[1];
    const rhsStart = m.index + m[0].length;
    const stmtEnd = findStmtEnd(html, rhsStart);
    const stmt = html.slice(rhsStart, stmtEnd);

    const info: LfVarInfo = { name, kind: "unknown" };

    // Pure alias: var a = b;
    const aliasMatch = stmt.match(/^\s*([A-Za-z_$][\w$]*)\s*$/);
    if (aliasMatch) {
      info.kind = "alias";
      info.aliasOf = aliasMatch[1];
      vars.set(name, info);
      continue;
    }

    // L.<ctor>(...) [.method(...)]*
    const ctorMatch = stmt.match(/^\s*L\.([A-Za-z_$][\w$.]*)\s*\(/);
    if (ctorMatch) {
      const ctorName = ctorMatch[1];
      const openInStmt = ctorMatch[0].length - 1;
      const closeInStmt = findMatching(stmt, openInStmt);
      if (closeInStmt >= 0) {
        const argsSrc = stmt.slice(openInStmt + 1, closeInStmt);
        info.ctor = ctorName;
        info.firstArg = extractFirstArg(argsSrc);

        const isSubGroup = /subGroup/i.test(ctorName);
        if (LF_GROUP_CTORS.has(ctorName) || isSubGroup) {
          info.kind = "group";
          // L.featureGroup.subGroup(parent, ...) — first arg is the parent group
          if (isSubGroup && info.firstArg) {
            const idMatch = info.firstArg.match(/^([A-Za-z_$][\w$]*)$/);
            if (idMatch) info.parentVar = idMatch[1];
          }
        } else if (LF_GEOM_CTORS.has(ctorName)) {
          info.kind = "geometry";
        }

        // Walk chained methods after the constructor close paren.
        // Captures `.bindPopup(...).bindTooltip(...).addTo(parent)` etc.
        let pos = closeInStmt + 1;
        while (pos < stmt.length) {
          const tail = stmt.slice(pos);
          const dotMatch = tail.match(/^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/);
          if (!dotMatch) break;
          const methodName = dotMatch[1];
          const methodOpenOffset = dotMatch[0].length - 1;
          const methodOpenInStmt = pos + methodOpenOffset;
          const methodCloseInStmt = findMatching(stmt, methodOpenInStmt);
          if (methodCloseInStmt < 0) break;
          const methodArgs = stmt.slice(methodOpenInStmt + 1, methodCloseInStmt);
          if (methodName === "addTo") {
            const idMatch = methodArgs.trim().match(/^([A-Za-z_$][\w$]*)$/);
            if (idMatch && !info.parentVar) info.parentVar = idMatch[1];
          } else if (methodName === "bindPopup" || methodName === "bindTooltip") {
            const txtMatch = methodArgs.match(
              /^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/
            );
            if (txtMatch) {
              const txt = (txtMatch[1] ?? txtMatch[2] ?? txtMatch[3] ?? "")
                .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              if (txt && !info.popup) info.popup = txt;
            }
          }
          pos = methodCloseInStmt + 1;
        }
      }
    }

    vars.set(name, info);
  }

  // Phase 2: standalone `name.addTo(parent)` (statement on its own line).
  // The leading [^).\w$] guard avoids matching ").addTo(...)" already handled.
  const stdAddToRe = /(?:^|[^).\w$])([A-Za-z_$][\w$]*)\s*\.addTo\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const am of html.matchAll(stdAddToRe)) {
    const child = am[1], parent = am[2];
    const info = vars.get(child);
    if (info && !info.parentVar) info.parentVar = parent;
  }

  // Standalone .bindPopup / .bindTooltip with string content.
  const stdPopupRe = /(?:^|[^).\w$])([A-Za-z_$][\w$]*)\s*\.bind(?:Popup|Tooltip)\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
  for (const pm of html.matchAll(stdPopupRe)) {
    const child = pm[1];
    const txt = (pm[2] ?? pm[3] ?? pm[4] ?? "")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!txt) continue;
    const info = vars.get(child);
    if (info && !info.popup) info.popup = txt;
  }

  return vars;
};

const buildLfOverlayMap = (html: string): Map<string, string> => {
  const overlayMap = new Map<string, string>();

  // L.control.layers(base, overlays)
  const ctrlRe = /L\.control\.layers\s*\(/g;
  for (const m of html.matchAll(ctrlRe)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = findMatching(html, open);
    if (close < 0) continue;
    const args = html.slice(open + 1, close);
    const parts: string[] = [];
    let depth = 0, str: string | null = null, last = 0;
    for (let i = 0; i < args.length; i++) {
      const c = args[i];
      if (str) { if (c === "\\") { i++; continue; } if (c === str) str = null; continue; }
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
    const entryRe = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*:\s*([A-Za-z_$][\w$]*)/g;
    for (const e of objBody.matchAll(entryRe)) {
      const nm = (e[1] ?? e[2] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      overlayMap.set(e[3], nm);
    }
  }

  // overlays as `=` assignment OR `:` property inside an object literal
  // (Folium emits `var ctrl = { base_layers: {...}, overlays: { "Name": varName, ... }, }`)
  const overlaysKeyRe = /(?:^|[^A-Za-z0-9_$])overlays\s*[:=]\s*\{/g;
  for (const km of html.matchAll(overlaysKeyRe)) {
    const openIdx = (km.index ?? 0) + km[0].length - 1;
    const closeIdx = findMatching(html, openIdx);
    if (closeIdx < 0) continue;
    const objBody = html.slice(openIdx + 1, closeIdx);
    const entryRe = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*:\s*([A-Za-z_$][\w$]*)/g;
    for (const e of objBody.matchAll(entryRe)) {
      const nm = (e[1] ?? e[2] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      overlayMap.set(e[3], nm);
    }
  }
  // ctrl.addOverlay(group, "Name")
  for (const m of html.matchAll(/\.addOverlay\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
    const nm = (m[2] ?? m[3] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
    overlayMap.set(m[1], nm);
  }

  return overlayMap;
};

interface LfResolved {
  display: string | null;
  groupVar: string | null;
  path: string[];
  hasGroup: boolean;
}

const resolveLfGroup = (
  startVar: string,
  vars: Map<string, LfVarInfo>,
  overlayMap: Map<string, string>,
): LfResolved => {
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = startVar;
  let firstGroupVar: string | null = null;
  let hasGroup = false;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    if (overlayMap.has(cur)) {
      return { display: overlayMap.get(cur)!, groupVar: firstGroupVar ?? cur, path, hasGroup: true };
    }
    const info = vars.get(cur);
    if (!info) break;
    if (info.kind === "group") {
      hasGroup = true;
      if (!firstGroupVar) firstGroupVar = cur;
    }
    if (info.kind === "alias" && info.aliasOf) { cur = info.aliasOf; continue; }
    if (info.parentVar) { cur = info.parentVar; continue; }
    break;
  }
  return { display: null, groupVar: firstGroupVar, path, hasGroup };
};

export const parseLeafletHtml = (html: string): ScannedLayer[] => {
  const vars = buildLfVarIndex(html);
  if (!vars.size) return [];
  const overlayMap = buildLfOverlayMap(html);

  const layers = new Map<string, ScannedLayer>();
  const ensure = (display: string) => {
    if (!layers.has(display)) layers.set(display, { name: display, count: 0, features: [] });
    return layers.get(display)!;
  };

  for (const [, info] of vars) {
    if (info.kind !== "geometry") continue;
    if (!info.firstArg || !info.ctor) continue;
    if (!info.parentVar) continue;

    const resolved = resolveLfGroup(info.parentVar, vars, overlayMap);
    if (!resolved.hasGroup) continue;

    const display = resolved.display ?? resolved.groupVar ?? info.parentVar;
    if (!display) continue;

    const layer = ensure(display);
    const popup = info.popup ?? null;
    const ctor = info.ctor;
    const firstArg = info.firstArg;

    const baseProps: Record<string, unknown> = {
      ...(popup ? { popup } : {}),
      group: display,
      groupPath: resolved.path,
    };

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
        properties: baseProps,
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
        properties: baseProps,
      });
      layer.count++;
    } else if (ctor === "polygon" || ctor === "rectangle") {
      const coords = parseCoordsLiteral(firstArg);
      if (!Array.isArray(coords) || !coords.length) continue;
      const toGeoRing = (r: number[][]) =>
        r.map(([lat, lng]) => [Number(lng), Number(lat)])
          .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      let rings: number[][][];
      if (Array.isArray((coords as any)[0]) && Array.isArray((coords as any)[0][0])) {
        rings = (coords as number[][][]).map(toGeoRing);
      } else {
        rings = [toGeoRing(coords as number[][])];
      }
      if (ctor === "rectangle" && rings[0].length === 2) {
        const [[x1, y1], [x2, y2]] = rings[0];
        rings = [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]];
      }
      for (const r of rings) {
        if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) {
          r.push([r[0][0], r[0][1]]);
        }
      }
      if (!rings[0] || rings[0].length < 4) continue;
      layer.features.push({
        external_id: null, name: popup, lat: null, lng: null,
        geometry: { type: "Polygon", coordinates: rings },
        properties: baseProps,
      });
      layer.count++;
    } else if (ctor === "geoJson" || ctor === "geoJSON") {
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
          properties: { ...props, ...baseProps },
        });
        layer.count++;
      }
    }
  }

  return Array.from(layers.values()).filter((l) => l.count > 0);
};

// ============================================================================
// GeoJSON
// ============================================================================

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

// ============================================================================
// CSV
// ============================================================================

// Mismos alias que src/utils/parseGeoFile.ts (csvToGeoJSON) usado en el
// preview client-side, para que "Procesar" nunca produzca 0 capas por una
// lista de alias desalineada con lo que el usuario ya vio en pantalla.
const CSV_LAT_ALIASES = ["lat", "latitude", "latitud", "y", "latitude_deg"];
const CSV_LNG_ALIASES = ["lng", "lon", "long", "longitude", "longitud", "x", "longitude_deg"];

/** Parsea una línea CSV respetando campos entre comillas. */
const parseCsvLine = (line: string, sep: string): string[] => {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
};

// Agrupa por las mismas columnas que layerNameFrom() usa para GeoJSON
// (category/folder/group/layer/layer_name), así el comportamiento es
// idéntico sin importar si el origen fue CSV o GeoJSON/HTML.
export const parseCsv = (text: string): ScannedLayer[] => {
  const layers = new Map<string, ScannedLayer>();
  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, count: 0, features: [] });
    return layers.get(name)!;
  };

  const lines = text
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const sep = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const rawHeaders = parseCsvLine(lines[0], sep);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/^["']|["']$/g, "").trim());
  const latIdx = headers.findIndex((h) => CSV_LAT_ALIASES.includes(h));
  const lngIdx = headers.findIndex((h) => CSV_LNG_ALIASES.includes(h));
  if (latIdx === -1 || lngIdx === -1) return [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i], sep);
    const lat = parseFloat(row[latIdx] ?? "");
    const lng = parseFloat(row[lngIdx] ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const props: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (idx !== latIdx && idx !== lngIdx && h) {
        props[h] = (row[idx] ?? "").replace(/^["']|["']$/g, "");
      }
    });

    const geometry = { type: "Point", coordinates: [lng, lat] };
    const layer = ensure(layerNameFrom(props, geometry));
    layer.features.push({
      external_id: props.id != null ? String(props.id) : null,
      name: (props.name ?? props.nombre ?? props.title ?? null) as string | null,
      lat,
      lng,
      geometry,
      properties: props,
    });
    layer.count++;
  }
  return Array.from(layers.values()).filter((l) => l.count > 0);
};

// ============================================================================
// Public entrypoint
// ============================================================================

export const parseHtml = (html: string): ScannedLayer[] => {
  const leaflet = parseLeafletHtml(html);
  if (leaflet.length) return leaflet;
  const kml = parseKmlFolders(html);
  if (kml.length) return kml;
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
  if (fileType === "csv") return parseCsv(text);
  if (fileType === "kmz") return buffer ? await parseKmz(buffer) : [];
  return parseHtml(text);
};
