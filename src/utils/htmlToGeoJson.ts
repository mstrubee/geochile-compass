// Convierte HTML (Leaflet/Folium / Google My Maps / KML embebido) a GeoJSON.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: any;
}

export interface GeoJsonFC {
  type: "FeatureCollection";
  features: Feature[];
}

const parseCoordinates = (str: string): number[][] => {
  return str
    .trim()
    .split(/\s+/)
    .map((t) => {
      const [lng, lat] = t.split(",").map(Number);
      return [lng, lat];
    })
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
};

// ============================================================================
// Bracket / JSON helpers
// ============================================================================

const findMatching = (src: string, start: number): number => {
  const open = src[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : open === "(" ? ")" : "";
  if (!close) return -1;
  let depth = 0, i = start;
  let str: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (str) {
      if (c === "\\") { i += 2; continue; }
      if (c === str) str = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); if (nl < 0) return -1; i = nl + 1; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return -1; i = end + 2; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
};

const looseJsonParse = (text: string): any => {
  try { return JSON.parse(text); } catch { /* */ }
  let t = text;
  t = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  t = t.replace(/,(\s*[}\]])/g, "$1");
  t = t.replace(/([{,\s])([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  t = t.replace(/'((?:\\.|[^'\\])*)'/g, (_m, inner) => JSON.stringify(inner.replace(/\\'/g, "'")));
  try { return JSON.parse(t); } catch { return null; }
};

// Walk forward from `start` until ; at depth 0, respecting strings/comments.
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
// Leaflet/Folium grouped parser — v2 (variable index + transitive resolution)
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

    // L.<ctor>(...) — possibly with a chain of methods after the close paren.
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
          // L.featureGroup.subGroup(parent, ...) — first arg is the parent
          if (isSubGroup && info.firstArg) {
            const idMatch = info.firstArg.match(/^([A-Za-z_$][\w$]*)$/);
            if (idMatch) info.parentVar = idMatch[1];
          }
        } else if (LF_GEOM_CTORS.has(ctorName)) {
          info.kind = "geometry";
        }

        // Walk chained methods: .bindPopup(...).bindTooltip(...).addTo(parent)...
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

  // Standalone `name.addTo(parent)` (not chained off a call).
  // Guard [^).\w$] prevents matching ").addTo(...)" already handled above.
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

  // ctrl.overlays = {"Name": var, ...};
  // overlays as `=` assignment OR `:` property inside an object literal
  // (Folium emits `var ctrl = { base_layers: {...}, overlays: { "Name": varName, ... } }`)
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

const parseLeafletGrouped = (html: string): Feature[] => {
  const vars = buildLfVarIndex(html);
  if (!vars.size) return [];
  const overlayMap = buildLfOverlayMap(html);

  const out: Feature[] = [];

  for (const [, info] of vars) {
    if (info.kind !== "geometry") continue;
    if (!info.firstArg || !info.ctor) continue;
    if (!info.parentVar) continue;

    const resolved = resolveLfGroup(info.parentVar, vars, overlayMap);
    if (!resolved.hasGroup) continue;

    const folder = resolved.display ?? resolved.groupVar ?? info.parentVar;
    if (!folder) continue;

    const popup = info.popup ?? null;
    const ctor = info.ctor;
    const firstArg = info.firstArg;

    const baseProps: Record<string, unknown> = {
      folder,
      group: folder,
      groupPath: resolved.path,
      name: popup,
      ...(popup ? { popup } : {}),
    };

    if (ctor === "marker" || ctor === "circleMarker" || ctor === "circle") {
      const coords = looseJsonParse(firstArg);
      if (!Array.isArray(coords) || coords.length < 2 || typeof coords[0] !== "number") continue;
      const lat = Number(coords[0]), lng = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: baseProps,
      });
    } else if (ctor === "polyline") {
      const coords = looseJsonParse(firstArg);
      if (!Array.isArray(coords) || !Array.isArray(coords[0])) continue;
      const ring = (coords as number[][]).map(([lat, lng]) => [Number(lng), Number(lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      if (ring.length < 2) continue;
      out.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: baseProps,
      });
    } else if (ctor === "polygon" || ctor === "rectangle") {
      const coords = looseJsonParse(firstArg);
      if (!Array.isArray(coords) || !coords.length) continue;
      const toRing = (r: number[][]) => r.map(([lat, lng]) => [Number(lng), Number(lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      let rings: number[][][];
      if (Array.isArray(coords[0]) && Array.isArray((coords[0] as any)[0])) {
        rings = (coords as number[][][]).map(toRing);
      } else {
        rings = [toRing(coords as number[][])];
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
      out.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: rings },
        properties: baseProps,
      });
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
        const props = f?.properties && typeof f.properties === "object" ? f.properties : {};
        out.push({
          type: "Feature",
          geometry: g,
          properties: { ...props, ...baseProps },
        });
      }
    }
  }

  return out;
};

// ============================================================================
// Top-level htmlToGeoJson — same fallback chain as before
// ============================================================================

export const htmlToGeoJson = (html: string): GeoJsonFC => {
  const features: Feature[] = [];

  // 1. KML Folders + Placemarks
  const folderRe = /<Folder\b[^>]*>([\s\S]*?)<\/Folder>/gi;
  const placemarkRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  const nameRe = /<name>([\s\S]*?)<\/name>/i;
  const coordRe = /<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/i;
  const idRe = /<Placemark\s+id=["']([^"']+)["']/i;

  const folders = [...html.matchAll(folderRe)];
  const seen = new Set<string>();

  const pushPlacemark = (pmHtml: string, body: string, folder: string) => {
    const nameMatch = body.match(nameRe);
    const coordMatch = body.match(coordRe);
    const idMatch = pmHtml.match(idRe);
    if (!coordMatch) return;
    const tuples = parseCoordinates(coordMatch[1]);
    if (!tuples.length) return;
    const isPoint = tuples.length === 1;
    const geometry = isPoint
      ? { type: "Point", coordinates: tuples[0] }
      : { type: "LineString", coordinates: tuples };
    features.push({
      type: "Feature",
      geometry,
      properties: {
        id: idMatch?.[1] ?? null,
        name: nameMatch?.[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? null,
        folder,
      },
    });
  };

  if (folders.length) {
    for (const m of folders) {
      const inner = m[1];
      const folderName = (inner.match(/^[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1] || "Capa").trim();
      const pms = [...inner.matchAll(placemarkRe)];
      for (const pm of pms) {
        seen.add(pm[0]);
        pushPlacemark(pm[0], pm[1], folderName);
      }
    }
  }

  const looseMatches = [...html.matchAll(placemarkRe)];
  for (const pm of looseMatches) {
    if (seen.has(pm[0])) continue;
    pushPlacemark(pm[0], pm[1], "Sin carpeta");
  }

  // 2. JS arrays of lat/lng objects
  if (!features.length) {
    const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[[\s\S]*?\]);/g;
    for (const m of html.matchAll(varRe)) {
      const varName = m[1];
      let arr: any;
      try {
        const cleaned = m[2].replace(/,(\s*[}\]])/g, "$1");
        arr = JSON.parse(cleaned);
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const obj of arr) {
        if (!obj || typeof obj !== "object") continue;
        const lat = Number(obj.lat ?? obj.latitude ?? obj.LAT);
        const lng = Number(obj.lng ?? obj.lon ?? obj.longitude ?? obj.LON ?? obj.LNG);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: { ...obj, folder: varName },
        });
      }
    }
  }

  // 3. Embedded GeoJSON FeatureCollection inside any <script>
  if (!features.length) {
    const fcRe = /\{[^{}]*"type"\s*:\s*"FeatureCollection"[\s\S]*?"features"\s*:\s*\[[\s\S]*?\]\s*\}/g;
    for (const m of html.matchAll(fcRe)) {
      try {
        const fc = JSON.parse(m[0]);
        if (fc?.type === "FeatureCollection" && Array.isArray(fc.features)) {
          for (const f of fc.features) {
            if (f?.geometry) {
              features.push({
                type: "Feature",
                geometry: f.geometry,
                properties: f.properties ?? {},
              });
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // 4a. Leaflet/Folium grouped (now: var index + transitive resolution)
  if (!features.length) {
    features.push(...parseLeafletGrouped(html));
  }

  // 4b. Generic Leaflet without groups (last-resort regex)
  if (!features.length) {
    const markerRe = /L\.(?:marker|circleMarker|circle)\s*\(\s*\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/g;
    for (const m of html.matchAll(markerRe)) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { folder: "Markers" },
      });
    }

    const polyRe = /L\.(polygon|polyline)\s*\(\s*(\[\s*\[[\s\S]*?\]\s*\])/g;
    for (const m of html.matchAll(polyRe)) {
      const kind = m[1];
      try {
        const arr = JSON.parse(m[2].replace(/,(\s*[}\]])/g, "$1"));
        if (!Array.isArray(arr)) continue;
        const coords = arr
          .map((p: any) => Array.isArray(p) && p.length >= 2 ? [Number(p[1]), Number(p[0])] : null)
          .filter((p): p is number[] => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (coords.length < 2) continue;
        const last = coords[coords.length - 1];
        const ring = kind === "polygon" && (coords[0][0] !== last[0] || coords[0][1] !== last[1])
          ? [...coords, coords[0]] : coords;
        features.push({
          type: "Feature",
          geometry: kind === "polygon"
            ? { type: "Polygon", coordinates: [ring] }
            : { type: "LineString", coordinates: coords },
          properties: { folder: kind === "polygon" ? "Polygons" : "Lines" },
        });
      } catch { /* skip */ }
    }
  }

  // 5. <script type="application/json">
  if (!features.length) {
    const scriptRe = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const m of html.matchAll(scriptRe)) {
      try {
        const data = JSON.parse(m[1].trim());
        const list = data?.type === "FeatureCollection" ? data.features
          : Array.isArray(data) ? data : data?.type === "Feature" ? [data] : [];
        for (const f of list) {
          if (f?.geometry) {
            features.push({
              type: "Feature",
              geometry: f.geometry,
              properties: f.properties ?? {},
            });
          }
        }
      } catch { /* skip */ }
    }
  }

  return { type: "FeatureCollection", features };
};

export const downloadGeoJson = (fc: GeoJsonFC, filename: string) => {
  const blob = new Blob([JSON.stringify(fc, null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
