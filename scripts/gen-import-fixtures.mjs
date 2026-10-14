// Genera los fixtures del importador en src/test/fixtures/import/.
// Son archivos CHICOS armados a mano con la estructura que exporta Google Earth / My Maps
// (Document > Folder anidadas, Style/StyleMap, ExtendedData, SchemaData, MultiGeometry,
// coordenadas con altura, polígonos con hueco) más casos rotos a propósito. No son
// exportaciones literales de Google Earth. Uso: node scripts/gen-import-fixtures.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const dir = new URL("../src/test/fixtures/import/", import.meta.url);
mkdirSync(dir, { recursive: true });
const write = (name, data) => writeFileSync(new URL(name, dir), data);

const NS = `xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom"`;

// ── locales.kml ────────────────────────────────────────────────────────────────
write("locales.kml", `<?xml version="1.0" encoding="UTF-8"?>
<kml ${NS}>
<Document>
  <name>Red de locales</name>
  <Style id="pin-azul"><IconStyle><color>ffd18802</color><scale>1.1</scale><Icon><href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href></Icon></IconStyle></Style>
  <Style id="pin-rojo-normal"><IconStyle><color>ff1c2dd6</color><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
  <Style id="pin-rojo-hl"><IconStyle><color>ff1c2dd6</color><scale>1.4</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
  <StyleMap id="pin-rojo"><Pair><key>highlight</key><styleUrl>#pin-rojo-hl</styleUrl></Pair><Pair><key>normal</key><styleUrl>#pin-rojo-normal</styleUrl></Pair></StyleMap>
  <Schema name="locales" id="locales"><SimpleField type="string" name="comuna"/></Schema>
  <Folder>
    <name>Norte</name>
    <Folder>
      <name>Antofagasta</name>
      <Placemark id="loc-001"><name>Local Centro</name><styleUrl>#pin-azul</styleUrl>
        <ExtendedData><Data name="comuna"><value>Antofagasta</value></Data><Data name="m2"><value>120</value></Data></ExtendedData>
        <Point><coordinates>-70.4,-23.65,0</coordinates></Point></Placemark>
      <Placemark id="loc-001"><name>Local con id repetido</name><styleUrl>#pin-azul</styleUrl>
        <Point><coordinates>-70.41,-23.66,12.5</coordinates></Point></Placemark>
      <Placemark><name>Local sin id</name><description>Frente a la plaza</description><styleUrl>#pin-azul</styleUrl>
        <Point><coordinates>-70.39, -23.64</coordinates></Point></Placemark>
    </Folder>
    <Folder>
      <name>Calama</name>
      <Placemark id="loc-010"><name>Local Calama</name><styleUrl>#pin-azul</styleUrl>
        <ExtendedData><SchemaData schemaUrl="#locales"><SimpleData name="comuna">Calama</SimpleData></SchemaData></ExtendedData>
        <Point><coordinates>-68.93,-22.46,0</coordinates></Point></Placemark>
    </Folder>
  </Folder>
  <Folder>
    <name>Sur</name>
    <Placemark id="loc-020"><name>Local directo</name><styleUrl>#pin-rojo</styleUrl><Point><coordinates>-72.0,-41.0,0</coordinates></Point></Placemark>
    <Folder>
      <name>Punta Arenas</name>
      <Placemark id="loc-030"><name>Local PA</name><styleUrl>#pin-rojo</styleUrl><Point><coordinates>-70.9,-53.16,0</coordinates></Point></Placemark>
      <Placemark id="loc-031"><name>Local mixto</name>
        <MultiGeometry>
          <Point><coordinates>-70.91,-53.17,0</coordinates></Point>
          <LineString><coordinates>-70.91,-53.17,0 -70.92,-53.18,0</coordinates></LineString>
        </MultiGeometry></Placemark>
    </Folder>
  </Folder>
  <Folder>
    <name>Zonas</name>
    <Placemark id="zona-a"><name>Zona A</name><styleUrl>#pin-rojo</styleUrl>
      <Polygon><tessellate>1</tessellate>
        <outerBoundaryIs><LinearRing><coordinates>-70.0,-33.0,100 -70.0,-33.2,100 -70.2,-33.2,100 -70.2,-33.0,100 -70.0,-33.0,100</coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>-70.05,-33.05,0 -70.05,-33.1,0 -70.1,-33.1,0 -70.05,-33.05,0</coordinates></LinearRing></innerBoundaryIs>
      </Polygon></Placemark>
    <Placemark id="zona-b"><name>Zona con anillo abierto</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>-71.0,-34.0 -71.0,-34.2 -71.2,-34.2 -71.2,-34.0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Folder>
  <Folder>
    <name>Con problemas</name>
    <Placemark><name>Latitud mala</name><Point><coordinates>-70,95,0</coordinates></Point></Placemark>
    <Placemark><name>Sin geometría</name><description>solo texto</description></Placemark>
    <Placemark><name>Texto roto</name><Point><coordinates>abc,def</coordinates></Point></Placemark>
    <Placemark><name>Sin ubicar</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>
    <Placemark id="ok-1"><name>Este sí</name><Point><coordinates>-70.5,-33.4,0</coordinates></Point></Placemark>
    <Placemark><name>Pista GPS</name><gx:Track><when>2024-01-01T00:00:00Z</when><gx:coord>-70.1 -33.1 0</gx:coord></gx:Track></Placemark>
  </Folder>
  <Folder><name>Vacía</name></Folder>
  <NetworkLink><name>Enlace remoto</name><Link><href>http://example.com/otro.kml</href></Link></NetworkLink>
</Document>
</kml>
`);

// ── PNG de prueba ──────────────────────────────────────────────────────────────
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const png = (w, h, pixel) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const [r, g, b] = pixel(x, y); raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
const pin = png(2, 2, () => [220, 30, 30]);
let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 16) & 0xff; };   // ruido determinista (bits altos): no comprime
const grande = png(96, 96, () => [rnd(), rnd(), rnd()]);

// ── iconos.kmz ─────────────────────────────────────────────────────────────────
const zip = new JSZip();
zip.file("doc.kml", `<?xml version="1.0" encoding="UTF-8"?>
<kml ${NS}>
<Document>
  <name>Tiendas con iconos</name>
  <Style id="chico"><IconStyle><Icon><href>files/pin.png</href></Icon></IconStyle></Style>
  <Style id="enorme"><IconStyle><Icon><href>files/grande.png</href></Icon></IconStyle></Style>
  <Folder>
    <name>Tiendas</name>
    <Placemark><name>Con ícono chico</name><styleUrl>#chico</styleUrl><Point><coordinates>-70.6,-33.4,0</coordinates></Point></Placemark>
    <Placemark><name>Otra con ícono chico</name><styleUrl>#chico</styleUrl><Point><coordinates>-70.7,-33.5,0</coordinates></Point></Placemark>
  </Folder>
  <Folder>
    <name>Bodegas</name>
    <Placemark><name>Con ícono enorme</name><styleUrl>#enorme</styleUrl><Point><coordinates>-70.8,-33.6,0</coordinates></Point></Placemark>
  </Folder>
</Document>
</kml>
`);
zip.file("files/pin.png", pin);
zip.file("files/grande.png", grande);
write("iconos.kmz", await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

// ── chile.geojson ──────────────────────────────────────────────────────────────
write("estaciones.geojson", JSON.stringify({
  type: "FeatureCollection",
  name: "Estaciones",
  features: [
    { type: "Feature", id: "e-1", properties: { name: "Copec Centro", _folderPath: ["Norte"], color: "#10B981" }, geometry: { type: "Point", coordinates: [-70.65, -33.45, 540] } },
    { type: "Feature", properties: { Nombre: "Shell Arica", id: "e-2", _folderPath: ["Norte", "Arica"] }, geometry: { type: "Point", coordinates: [-70.3, -18.48] } },
    { type: "Feature", properties: { name: "Sin carpeta" }, geometry: { type: "MultiPoint", coordinates: [[-71, -33], [-71.1, -33.1]] } },
    { type: "Feature", properties: { name: "Terreno", _folderPath: ["Norte"] }, geometry: { type: "Polygon", coordinates: [[[-70, -33, 5], [-70, -33.1, 5], [-70.1, -33.1, 5], [-70.1, -33, 5]]] } },
    { type: "Feature", properties: { name: "Latitud imposible" }, geometry: { type: "Point", coordinates: [-70, 120] } },
    { type: "Feature", properties: { name: "Sin geometría" }, geometry: null },
    { type: "Feature", properties: { name: "Línea corta" }, geometry: { type: "LineString", coordinates: [[-70, -33]] } },
  ],
}, null, 2));

// ── locales.csv ────────────────────────────────────────────────────────────────
write("locales.csv", `﻿Nombre;Latitud;Longitud;Capa;Código;Comuna
Farmacia Uno;-33,4489;-70,6693;Farmacias;F-1;Santiago
Farmacia Dos;-33,4372;-70,6506;Farmacias;F-2;Providencia
Bencinera Norte;-18,4783;-70,3126;Bencineras;B-1;Arica
Bencinera Sur;-53,1638;-70,9171;Bencineras;;Punta Arenas
Fila sin coordenadas;;;Farmacias;F-9;Nunoa
Fila rota;abc;-70,6;Farmacias;F-10;Nunoa
Fila fuera de rango;-133,4;-70,6;Bencineras;B-9;Nunoa
`);
console.log("fixtures escritos en", dir.pathname);
