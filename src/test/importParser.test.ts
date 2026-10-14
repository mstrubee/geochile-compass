import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  documentToGeoJson,
  importFormatOf,
  includedCounts,
  isExcluded,
  kmlColorToHex,
  normalizeIconUrl,
  layersOf,
  normalizeGeometry,
  parseImportContent,
  parseImportFile,
  parseKmlCoordinates,
  structureOf,
  type ImportDocument,
  type ImportNode,
} from "@/utils/importParser";

const fixture = (name: string) => readFileSync(join(process.cwd(), "src/test/fixtures/import", name));
const text = (name: string) => fixture(name).toString("utf-8");
const find = (n: ImportNode, key: string): ImportNode | undefined =>
  n.key === key ? n : n.children?.map((c) => find(c, key)).find(Boolean);
const names = (n: ImportNode | undefined) => (n?.children ?? []).map((c) => c.name);
const positionsOf = (g: GeoJSON.Geometry): number[][] => {
  const out: number[][] = [];
  const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === "number" ? out.push(c as number[]) : Array.isArray(c) && c.forEach(walk));
  if ("coordinates" in g) walk(g.coordinates);
  else if (g.type === "GeometryCollection") g.geometries.forEach((x) => out.push(...positionsOf(x)));
  return out;
};

describe("KML estilo Google Earth (locales.kml)", () => {
  const doc = parseImportContent.kml(text("locales.kml"), "locales.kml");

  it("arma el árbol de carpetas en el orden del archivo", () => {
    expect(doc.root).toMatchObject({ key: "0", kind: "folder", name: "Red de locales" });
    expect(names(doc.root)).toEqual(["Norte", "Sur", "Zonas", "Con problemas"]);
    expect(names(find(doc.root, "0.0"))).toEqual(["Antofagasta", "Calama"]);
  });

  it("una carpeta con Placemarks y subcarpetas deja los directos en 'Sin subcarpeta' (primero)", () => {
    const sur = find(doc.root, "0.1")!;
    expect(sur.kind).toBe("folder");
    expect(names(sur)).toEqual(["Sin subcarpeta", "Punta Arenas"]);
    expect(sur.children![0].features!.map((f) => f.name)).toEqual(["Local directo"]);
  });

  it("omite la carpeta vacía y solo las carpetas sin hijos con puntos son capas", () => {
    expect(names(doc.root)).not.toContain("Vacía");
    expect(layersOf(doc.root).map((l) => l.name)).toEqual([
      "Antofagasta", "Calama", "Sin subcarpeta", "Punta Arenas", "Zonas", "Con problemas",
    ]);
  });

  it("las claves son rutas de posición y las de los puntos cuelgan de su capa", () => {
    const anto = find(doc.root, "0.0.0")!;
    expect(anto.name).toBe("Antofagasta");
    expect(anto.features!.map((f) => f.key)).toEqual(["0.0.0#0", "0.0.0#1", "0.0.0#2"]);
    expect(find(doc.root, "0.1.1")!.name).toBe("Punta Arenas");
  });

  it("cuenta carpetas, capas, puntos e inválidos", () => {
    expect(doc.counts).toEqual({ folders: 3, layers: 6, features: 10, invalid: 3 });
  });

  it("reporta lo inválido sin abortar el archivo, con su motivo y su carpeta", () => {
    const invalid = doc.issues.filter((i) => i.kind === "invalid-geometry");
    expect(invalid.map((i) => i.name).sort()).toEqual(["Latitud mala", "Sin ubicar", "Texto roto"]);
    expect(invalid.find((i) => i.name === "Latitud mala")).toMatchObject({ path: ["Red de locales", "Con problemas"], reason: "latitud fuera de rango (95)" });
    expect(invalid.find((i) => i.name === "Sin ubicar")!.reason).toMatch(/0,0/);
    expect(doc.issues.filter((i) => i.kind === "no-geometry").map((i) => i.name)).toEqual(["Sin geometría"]);
    // el que sí está bien, en la misma carpeta, se importa
    expect(find(doc.root, "0.3")!.features!.map((f) => f.name)).toEqual(["Este sí"]);
  });

  it("avisa de lo que no se importa (NetworkLink, gx:Track) una vez por tipo", () => {
    const unsupported = doc.issues.filter((i) => i.kind === "unsupported").map((i) => i.reason).sort();
    expect(unsupported).toHaveLength(2);
    expect(unsupported[0]).toMatch(/NetworkLink/);
    expect(unsupported[1]).toMatch(/Track/);
  });

  it("quita la coordenada Z y tolera espacios dentro de la coordenada", () => {
    const [centro, , sinId] = find(doc.root, "0.0.0")!.features!;
    expect(centro.geometry).toEqual({ type: "Point", coordinates: [-70.4, -23.65] });
    expect(sinId.geometry).toEqual({ type: "Point", coordinates: [-70.39, -23.64] });
    for (const l of layersOf(doc.root)) for (const f of l.features!) {
      expect(positionsOf(f.geometry).every((p) => p.length === 2)).toBe(true);
    }
  });

  it("usa el id del Placemark como external_id y descarta los repetidos con un aviso", () => {
    const feats = find(doc.root, "0.0.0")!.features!;
    expect(feats.map((f) => f.externalId)).toEqual(["loc-001", null, null]);
    expect(doc.issues.some((i) => i.kind === "warning" && /id repetido \(loc-001\)/.test(i.reason))).toBe(true);
  });

  it("lee ExtendedData/Data, SchemaData/SimpleData y la descripción como atributos", () => {
    const [centro, , sinId] = find(doc.root, "0.0.0")!.features!;
    expect(centro.properties).toEqual({ comuna: "Antofagasta", m2: "120" });
    expect(sinId.properties).toEqual({ description: "Frente a la plaza" });
    expect(find(doc.root, "0.0.1")!.features![0].properties).toEqual({ comuna: "Calama" });
  });

  it("resuelve estilos: Style directo y StyleMap (usa el par 'normal' aunque esté segundo)", () => {
    const anto = find(doc.root, "0.0.0")!;
    expect(anto.color).toBe("#0288d1"); // ffd18802 en AABBGGRR
    expect(anto.icon).toBe("https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png");
    const directo = find(doc.root, "0.1.0")!;
    expect(directo.color).toBe("#d62d1c");
    expect(directo.icon).toBe("https://maps.google.com/mapfiles/kml/paddle/red-circle.png"); // el fixture dice http://
  });

  it("MultiGeometry con tipos distintos queda como GeometryCollection", () => {
    const mixto = find(doc.root, "0.1.1")!.features!.find((f) => f.name === "Local mixto")!;
    expect(mixto.geometry.type).toBe("GeometryCollection");
    expect((mixto.geometry as GeoJSON.GeometryCollection).geometries.map((g) => g.type)).toEqual(["Point", "LineString"]);
  });

  it("polígonos: conserva el hueco, cierra el anillo abierto y quita la altura", () => {
    const [a, b] = find(doc.root, "0.2")!.features!;
    expect(a.geometry.type).toBe("Polygon");
    const rings = (a.geometry as GeoJSON.Polygon).coordinates;
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => r[0].join() === r[r.length - 1].join())).toBe(true);
    const abierto = (b.geometry as GeoJSON.Polygon).coordinates[0];
    expect(abierto).toHaveLength(5);
    expect(abierto[0]).toEqual(abierto[4]);
  });

  it("un XML mal formado falla con un mensaje claro", () => {
    expect(() => parseImportContent.kml("<kml><Document>", "x.kml")).toThrow(/KML inválido/);
  });

  it("un archivo sin nada importable falla en vez de crear una capa vacía", () => {
    expect(() => parseImportContent.kml(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>x</name></Document></kml>`, "x.kml")).toThrow(/ningún punto/);
  });

  it("sin nombre de Document usa el del archivo", () => {
    const d = parseImportContent.kml(
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>P</name><Point><coordinates>-70,-33</coordinates></Point></Placemark></Document></kml>`,
      "Mis puntos.kml",
    );
    expect(d.root).toMatchObject({ kind: "layer", name: "Mis puntos" });
  });
});

describe("KMZ con íconos (iconos.kmz)", () => {
  it("resuelve los íconos relativos a data URL y descarta los que pesan demasiado", async () => {
    // El ArrayBuffer de Node y el de jsdom son de realms distintos para JSZip; en el navegador no pasa.
    // Se vuelve a empaquetar con JSZip para obtener un ArrayBuffer de su mismo realm.
    const JSZip = (await import("jszip")).default;
    const loaded = await JSZip.loadAsync(fixture("iconos.kmz").toString("base64"), { base64: true });
    const doc = await parseImportContent.kmz(await loaded.generateAsync({ type: "arraybuffer" }), "iconos.kmz");
    expect(doc.format).toBe("kmz");
    const tiendas = find(doc.root, "0.0")!;
    expect(tiendas.name).toBe("Tiendas");
    expect(tiendas.icon).toMatch(/^data:image\/png;base64,/);
    expect(tiendas.features!.every((f) => f.icon === tiendas.icon)).toBe(true);
    const bodegas = find(doc.root, "0.1")!;
    expect(bodegas.icon).toBeNull();
    expect(bodegas.features![0].icon).toBeNull();
    expect(doc.issues.some((i) => /1 ícono\(s\).*pesan demasiado/.test(i.reason))).toBe(true);
  });

  it("un KMZ sin .kml falla con un mensaje claro", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("nada.txt", "x");
    await expect(parseImportContent.kmz(await zip.generateAsync({ type: "arraybuffer" }), "x.kmz")).rejects.toThrow(/no contiene ningún archivo \.kml/);
  });
});

describe("GeoJSON (estaciones.geojson)", () => {
  const doc = parseImportContent.geojson(text("estaciones.geojson"), "estaciones.geojson");

  it("reconstruye las carpetas desde _folderPath y usa el nombre de la colección", () => {
    expect(doc.root.name).toBe("Estaciones");
    expect(names(doc.root)).toEqual(["Sin subcarpeta", "Norte"]);
    expect(names(find(doc.root, "0.1"))).toEqual(["Sin subcarpeta", "Arica"]);
    expect(doc.counts).toEqual({ folders: 2, layers: 3, features: 4, invalid: 2 });
  });

  it("toma nombre e id de las propiedades habituales y no deja _folderPath en los atributos", () => {
    const copec = find(doc.root, "0.1.0")!.features!.find((f) => f.name === "Copec Centro")!;
    expect(copec).toMatchObject({ externalId: "e-1", color: "#10b981" });
    expect(copec.properties).not.toHaveProperty("_folderPath");
    const shell = find(doc.root, "0.1.1")!.features![0];
    expect(shell).toMatchObject({ name: "Shell Arica", externalId: "e-2" });
  });

  it("quita la Z, cierra el polígono y reporta lo inválido", () => {
    const copec = find(doc.root, "0.1.0")!.features![0];
    expect(copec.geometry).toEqual({ type: "Point", coordinates: [-70.65, -33.45] });
    const terreno = find(doc.root, "0.1.0")!.features![1].geometry as GeoJSON.Polygon;
    expect(terreno.coordinates[0]).toHaveLength(5);
    expect(doc.issues.filter((i) => i.kind === "invalid-geometry").map((i) => i.name).sort()).toEqual(["Latitud imposible", "Línea corta"]);
    expect(doc.issues.filter((i) => i.kind === "no-geometry")).toHaveLength(1);
  });

  it("acepta una geometría suelta, un Feature y rechaza lo que no es GeoJSON", () => {
    const d = parseImportContent.geojson(JSON.stringify({ type: "Point", coordinates: [-70, -33] }), "p.geojson");
    expect(d.root).toMatchObject({ kind: "layer", name: "p" });
    expect(parseImportContent.geojson(JSON.stringify({ type: "Feature", properties: { name: "A" }, geometry: { type: "Point", coordinates: [-70, -33] } }), "f.json").counts.features).toBe(1);
    expect(() => parseImportContent.geojson("no es json", "x.geojson")).toThrow(/GeoJSON inválido/);
    expect(() => parseImportContent.geojson(JSON.stringify({ hola: 1 }), "x.geojson")).toThrow(/Feature, FeatureCollection/);
  });
});

describe("CSV (locales.csv)", () => {
  const doc = parseImportContent.csv(text("locales.csv"), "locales.csv");

  it("detecta ; como separador, BOM y coma decimal, y arma una capa por valor de 'Capa'", () => {
    expect(doc.root).toMatchObject({ kind: "folder", name: "locales" });
    expect(names(doc.root)).toEqual(["Farmacias", "Bencineras"]);
    const uno = find(doc.root, "0.0")!.features![0];
    expect(uno.geometry).toEqual({ type: "Point", coordinates: [-70.6693, -33.4489] });
    expect(uno).toMatchObject({ name: "Farmacia Uno", externalId: "F-1" });
    expect(uno.properties).toMatchObject({ Comuna: "Santiago" });
  });

  it("las filas sin coordenadas o fuera de rango se reportan con su número de fila", () => {
    expect(doc.counts).toMatchObject({ features: 4, invalid: 3 });
    const reasons = doc.issues.map((i) => i.reason).sort();
    expect(reasons[0]).toMatch(/^fila 6:/);
    expect(reasons[1]).toMatch(/^fila 7:/);
    expect(reasons[2]).toMatch(/^fila 8: latitud fuera de rango/);
  });

  it("sin columna de capa, una sola capa con el nombre del archivo", () => {
    const d = parseImportContent.csv("nombre,lat,lng\nA,-33.4,-70.6\nB,-33.5,-70.7\n", "puntos.csv");
    expect(d.root).toMatchObject({ kind: "layer", name: "puntos" });
    expect(d.root.features).toHaveLength(2);
  });

  it("explica qué columnas faltan", () => {
    expect(() => parseImportContent.csv("a,b\n1,2\n", "x.csv")).toThrow(/No se encontraron las columnas de coordenadas/);
    expect(() => parseImportContent.csv("lat,lng\n", "x.csv")).toThrow(/vacío/);
    expect(() => parseImportContent.csv("lat,lng\nx,y\n", "x.csv")).toThrow(/Ninguna fila/);
  });
});

describe("parseImportFile", () => {
  const fileLike = (name: string, content: string, size = content.length) =>
    ({ name, size, text: async () => content, arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as unknown as File;

  it("elige el parser por la extensión", async () => {
    const d = await parseImportFile(fileLike("puntos.csv", "lat,lng\n-33.4,-70.6\n"));
    expect(d.format).toBe("csv");
    expect((await parseImportFile(fileLike("a.json", JSON.stringify({ type: "Point", coordinates: [-70, -33] })))).format).toBe("geojson");
  });

  it("rechaza formatos desconocidos y archivos demasiado grandes", async () => {
    await expect(parseImportFile(fileLike("a.shp", ""))).rejects.toThrow(/Formato no soportado/);
    await expect(parseImportFile(fileLike("a.kml", "<kml/>", 50 * 1024 * 1024))).rejects.toThrow(/máximo es 20 MB/);
  });

  it("reconoce las extensiones", () => {
    expect(importFormatOf("A.KMZ")).toBe("kmz");
    expect(importFormatOf("a.json")).toBe("geojson");
    expect(importFormatOf("mapa.HTML")).toBe("html");
    expect(importFormatOf("mapa.htm")).toBe("html");
    expect(importFormatOf("a.txt")).toBeNull();
  });
});

describe("HTML de mapas", () => {
  it("un HTML con KML incrustado trae sus carpetas como capas y se guarda como geojson", () => {
    const doc = parseImportContent.html(text("mapa-incrustado.html"), "mapa-incrustado.html");
    expect(doc.format).toBe("geojson");
    expect(doc.counts).toMatchObject({ layers: 2, features: 3, invalid: 0 });
    expect(names(doc.root)).toEqual(["Farmacias", "Clínicas"]);
    const farmacias = layersOf(doc.root).find((l) => l.name === "Farmacias");
    expect(farmacias?.features?.map((f) => f.name)).toEqual(["Farmacia Centro", "Farmacia Norte"]);
    expect(farmacias?.features?.map((f) => f.externalId)).toEqual(["f1", "f2"]);
    // la ruta interna de carpetas no se guarda como dato del punto
    expect(farmacias?.features?.[0].properties).not.toHaveProperty("_folderPath");
  });

  it("un Leaflet sin grupos queda en una capa 'Markers'", () => {
    const doc = parseImportContent.html(text("mapa-leaflet.html"), "mapa-leaflet.html");
    expect(doc.counts).toMatchObject({ layers: 1, features: 3 });
    expect(layersOf(doc.root)[0].name).toBe("Markers");
  });

  it("si no hay puntos, el error dice qué se reconoce y qué hacer", () => {
    expect(() => parseImportContent.html(text("mapa-sin-puntos.html"), "x.html")).toThrow(/No se encontraron puntos en el HTML.*KML o GeoJSON/s);
  });

  it("parseImportFile lo lee por la extensión", async () => {
    const content = text("mapa-incrustado.html");
    const file = { name: "mapa.htm", size: content.length, text: async () => content } as unknown as File;
    const doc = await parseImportFile(file);
    expect(doc.counts.features).toBe(3);
  });
});

describe("documentToGeoJson", () => {
  it("aplana el árbol a puntos con su capa y su ruta de carpetas", () => {
    const doc = parseImportContent.kml(text("locales.kml"), "locales.kml");
    const fc = documentToGeoJson(doc);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(doc.counts.features);
    const one = fc.features.find((f) => f.properties.layer === "Antofagasta");
    expect(one?.properties._folderPath).toEqual(["Norte"]);
  });

  it("respeta las capas excluidas", () => {
    const doc = parseImportContent.html(text("mapa-incrustado.html"), "x.html");
    const clinicas = layersOf(doc.root).find((l) => l.name === "Clínicas")!;
    const fc = documentToGeoJson(doc, new Set([clinicas.key]));
    expect(fc.features).toHaveLength(2);
    expect(fc.features.every((f) => f.properties.layer === "Farmacias")).toBe(true);
  });
});

describe("normalizeGeometry", () => {
  it("un punto válido pierde la altura", () => {
    expect(normalizeGeometry({ type: "Point", coordinates: [-70.5, -33.4, 800] }).geometry).toEqual({ type: "Point", coordinates: [-70.5, -33.4] });
  });

  it.each([
    [{ type: "Point", coordinates: [0, 0] }, /0,0/],
    [{ type: "Point", coordinates: [-70, 91] }, /latitud fuera de rango/],
    [{ type: "Point", coordinates: [200, -33] }, /longitud fuera de rango/],
    [{ type: "Point", coordinates: [NaN, -33] }, /no numéricas/],
    [{ type: "Point", coordinates: "x" }, /no numéricas/],
    [{ type: "LineString", coordinates: [[-70, -33]] }, /al menos 2 puntos/],
    [{ type: "Polygon", coordinates: [[[-70, -33], [-70, -34]]] }, /al menos 3 vértices/],
    [{ type: "Polygon", coordinates: [] }, /sin anillos/],
    [{ type: "Circle", coordinates: [] }, /no soportado \(Circle\)/],
    [null, /sin geometría/],
  ])("rechaza %j", (g, reason) => {
    const r = normalizeGeometry(g);
    expect(r.geometry).toBeNull();
    expect(r.problems.join(" ")).toMatch(reason);
  });

  it("un hueco inválido se omite pero el polígono se conserva", () => {
    const r = normalizeGeometry({
      type: "Polygon",
      coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]].map(([x, y]) => [x - 70, y - 33]), [[-70.5, -33.5], [-70.6, -33.5]]],
    });
    expect((r.geometry as GeoJSON.Polygon).coordinates).toHaveLength(1);
    expect(r.problems.join(" ")).toMatch(/hueco/);
  });

  it("un Multi* conserva las partes válidas y una colección también", () => {
    const m = normalizeGeometry({ type: "MultiPoint", coordinates: [[-70, -33], [-70, 95]] });
    expect((m.geometry as GeoJSON.MultiPoint).coordinates).toHaveLength(1);
    const c = normalizeGeometry({ type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [-70, -33] }, { type: "Point", coordinates: [0, 0] }] });
    expect((c.geometry as GeoJSON.GeometryCollection).geometries).toHaveLength(1);
    expect(normalizeGeometry({ type: "MultiPoint", coordinates: [[0, 0]] }).geometry).toBeNull();
  });
});

describe("utilidades", () => {
  it("kmlColorToHex invierte AABBGGRR y rechaza lo que no es un color", () => {
    expect(kmlColorToHex("ff0000ff")).toBe("#ff0000");
    expect(kmlColorToHex("FFD18802")).toBe("#0288d1");
    expect(kmlColorToHex("nope")).toBeNull();
    expect(kmlColorToHex(undefined)).toBeNull();
  });

  it("parseKmlCoordinates entiende varias posiciones y devuelve null si algo no se lee", () => {
    expect(parseKmlCoordinates("-70,-33,5 -71, -34")).toEqual([[-70, -33], [-71, -34]]);
    expect(parseKmlCoordinates("-70,-33 abc")).toBeNull();
    expect(parseKmlCoordinates("")).toEqual([]);
  });

  describe("exclusiones", () => {
    const doc: ImportDocument = parseImportContent.kml(text("locales.kml"), "locales.kml");

    it("excluir una carpeta excluye todo lo que contiene, y solo eso", () => {
      expect(isExcluded("0.0.1", new Set(["0.0"]))).toBe(true);
      expect(isExcluded("0.0", new Set(["0.0"]))).toBe(true);
      expect(isExcluded("0.1.1", new Set(["0.0"]))).toBe(false);
      expect(isExcluded("0.10", new Set(["0.1"]))).toBe(false); // 0.10 no cuelga de 0.1
    });

    it("cuenta lo incluido", () => {
      expect(includedCounts(doc, new Set())).toEqual({ layers: 6, features: 10 });
      expect(includedCounts(doc, new Set(["0.0"]))).toEqual({ layers: 4, features: 6 });
      expect(includedCounts(doc, new Set(["0.0.0", "0.2"]))).toEqual({ layers: 4, features: 5 });
    });

    it("structureOf no lleva los puntos, solo la forma y los conteos", () => {
      const s = structureOf(doc.root) as { children: { name: string; children?: unknown[]; count?: number }[] };
      expect(JSON.stringify(s)).not.toContain("coordinates");
      expect(s.children.map((c) => c.name)).toEqual(["Norte", "Sur", "Zonas", "Con problemas"]);
      expect(s.children[2].count).toBe(2);
    });
  });
});

/**
 * Exportaciones REALES de Google Earth Pro 7.3.7 (un punto cada una): un Document con el nombre del
 * archivo, StyleMap con pares normal/highlight, ícono `http://maps.google.com/...`, `LookAt`,
 * `gx:drawOrder` y `atom:link` dentro del Placemark.
 */
describe("KMZ reales de Google Earth Pro (ge-test-1.kmz, ge-test-2.kmz)", () => {
  const load = async (name: string) => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(fixture(name).toString("base64"), { base64: true });
    return parseImportContent.kmz(await zip.generateAsync({ type: "arraybuffer" }), name);
  };

  it("un Document sin carpetas es una sola capa, sin la extensión del archivo en el nombre", async () => {
    const doc = await load("ge-test-1.kmz");
    expect(doc.root).toMatchObject({ kind: "layer", name: "Test 1", key: "0" });
    expect(doc.counts).toEqual({ folders: 0, layers: 1, features: 1, invalid: 0 });
    expect(doc.format).toBe("kmz");
  });

  it("lee el punto con sus coordenadas exactas e ignora LookAt, drawOrder y atom:link", async () => {
    const [f] = (await load("ge-test-1.kmz")).root.features!;
    expect(f.name).toBe("Test 1");
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-69.25916296027727, -32.15907684812149] });
    expect(f.properties).toEqual({});
    const [g] = (await load("ge-test-2.kmz")).root.features!;
    expect(g.geometry).toEqual({ type: "Point", coordinates: [-69.26578491000906, -33.72223999533109] });
  });

  it("resuelve el StyleMap (par 'normal') y deja el ícono por https", async () => {
    const doc = await load("ge-test-1.kmz");
    expect(doc.root.icon).toBe("https://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png");
    expect(doc.root.features![0].icon).toBe(doc.root.icon);
    expect(doc.root.color).toBeNull(); // el estilo no trae color
  });

  it("no hay avisos: ni geometrías inválidas ni contenido no soportado", async () => {
    expect((await load("ge-test-1.kmz")).issues).toEqual([]);
    expect((await load("ge-test-2.kmz")).issues).toEqual([]);
  });

  it("los dos archivos son del mismo formato pero con puntos distintos (sirven para probar agregar)", async () => {
    const a = (await load("ge-test-1.kmz")).root.features![0];
    const b = (await load("ge-test-2.kmz")).root.features![0];
    expect(a.geometry).not.toEqual(b.geometry);
    expect(a.name).not.toBe(b.name);
  });
});

describe("normalizeIconUrl", () => {
  it("sube a https los íconos de Google y deja el resto", () => {
    expect(normalizeIconUrl("http://maps.google.com/mapfiles/kml/paddle/red-circle.png")).toBe("https://maps.google.com/mapfiles/kml/paddle/red-circle.png");
    expect(normalizeIconUrl("http://www.gstatic.com/mapspro/x.png")).toBe("https://www.gstatic.com/mapspro/x.png");
    expect(normalizeIconUrl("http://example.com/pin.png")).toBe("http://example.com/pin.png");
    expect(normalizeIconUrl("https://maps.google.com/a.png")).toBe("https://maps.google.com/a.png");
    expect(normalizeIconUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });
});
