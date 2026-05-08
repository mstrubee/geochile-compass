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
