// Convierte HTML (Leaflet / Google My Maps / KML embebido) a GeoJSON FeatureCollection.
// Mismo enfoque que la edge function scan-territorial-html, ejecutado en el browser.
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

// ---------- Leaflet/Folium grouped parser (replica del edge function) ----------

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

const parseLeafletGrouped = (html: string): Feature[] => {
  const overlayMap = new Map<string, string>();

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
      const name = (e[1] ?? e[2] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      overlayMap.set(e[3], name);
    }
  }

  for (const m of html.matchAll(/\.\s*overlays\s*=\s*\{([\s\S]*?)\};/g)) {
    const entryRe = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*:\s*([A-Za-z_$][\w$]*)/g;
    for (const e of m[1].matchAll(entryRe)) {
      const name = (e[1] ?? e[2] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
      overlayMap.set(e[3], name);
    }
  }
  for (const m of html.matchAll(/\.addOverlay\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
    const name = (m[2] ?? m[3] ?? "").replace(/\\"/g, '"').replace(/\\'/g, "'");
    overlayMap.set(m[1], name);
  }

  if (!overlayMap.size) return [];

  // Parents: alias (var a = b;), separate-statement .addTo, and L.featureGroup.subGroup(parent,...)
  const parent = new Map<string, string>();
  for (const m of html.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) {
    parent.set(m[1], m[2]);
  }
  for (const m of html.matchAll(/(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*\.addTo\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    if (!parent.has(m[1])) parent.set(m[1], m[2]);
  }
  for (const m of html.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*L\.featureGroup\.subGroup\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
    parent.set(m[1], m[2]);
  }
  const resolveGroup = (v: string): string | undefined => {
    let cur = v; const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (overlayMap.has(cur)) return overlayMap.get(cur);
      seen.add(cur);
      const next = parent.get(cur);
      if (!next) return undefined;
      cur = next;
    }
    return undefined;
  };

  const popupByVar = new Map<string, string>();
  const popupRe = /([A-Za-z_$][\w$]*)\s*\.bind(?:Popup|Tooltip)\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
  for (const m of html.matchAll(popupRe)) {
    const txt = (m[2] ?? m[3] ?? m[4] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (txt) popupByVar.set(m[1], txt);
  }

  // Read chained suffix `.addTo(group)` / `.bindPopup("...")` after a constructor's closing ')'
  const readChainedSuffix = (src: string, from: number): { group: string | null; popup: string | null } => {
    let i = from, depth = 0, str: string | null = null, end = src.length;
    while (i < src.length) {
      const c = src[i];
      if (str) { if (c === "\\") { i += 2; continue; } if (c === str) str = null; i++; continue; }
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

  const out: Feature[] = [];
  const ctorRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*L\.(marker|circleMarker|circle|polygon|polyline|rectangle|geoJson)\s*\(/g;
  let mm: RegExpExecArray | null;
  while ((mm = ctorRe.exec(html))) {
    const varName = mm[1];
    const ctor = mm[2];
    const openIdx = mm.index + mm[0].length - 1;
    const closeIdx = findMatching(html, openIdx);
    if (closeIdx < 0) continue;
    const argsSrc = html.slice(openIdx + 1, closeIdx);
    const chained = readChainedSuffix(html, closeIdx + 1);
    const groupVar = chained.group ?? parent.get(varName) ?? null;
    if (!groupVar) continue;
    const folder = resolveGroup(groupVar);
    if (!folder) continue;
    let firstArg = argsSrc.trim();
    {
      let depth = 0, str: string | null = null;
      for (let i = 0; i < argsSrc.length; i++) {
        const c = argsSrc[i];
        if (str) { if (c === "\\") { i++; continue; } if (c === str) str = null; continue; }
        if (c === '"' || c === "'" || c === "`") { str = c; continue; }
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") depth--;
        else if (c === "," && depth === 0) { firstArg = argsSrc.slice(0, i).trim(); break; }
      }
    }
    const popup = chained.popup ?? popupByVar.get(varName) ?? null;

    if (ctor === "marker" || ctor === "circleMarker" || ctor === "circle") {
      const coords = looseJsonParse(firstArg);
      if (!Array.isArray(coords) || coords.length < 2 || typeof coords[0] !== "number") continue;
      const lat = Number(coords[0]), lng = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { folder, name: popup, ...(popup ? { popup } : {}) },
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
        properties: { folder, name: popup },
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
        properties: { folder, name: popup },
      });
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
        const props = f?.properties && typeof f.properties === "object" ? f.properties : {};
        out.push({
          type: "Feature",
          geometry: g,
          properties: { ...props, folder },
        });
      }
    }
  }
  return out;
};

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

  // Placemarks fuera de cualquier folder
  const looseMatches = [...html.matchAll(placemarkRe)];
  for (const pm of looseMatches) {
    if (seen.has(pm[0])) continue;
    pushPlacemark(pm[0], pm[1], "Sin carpeta");
  }

  // 2. Si no hay nada, intentar arrays JS de objetos {lat,lng,...}
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

  // 3. GeoJSON embebido en cualquier <script> (Google My Maps, uMap, exports varios)
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

  // 4a. Leaflet/Folium con grupos del control de capas (overlays)
  if (!features.length) {
    const leafletGrouped = parseLeafletGrouped(html);
    features.push(...leafletGrouped);
  }

  // 4b. Fallback genérico Leaflet sin grupos
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

  // 5. <script type="application/json"> con FeatureCollection o array de Features
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
