import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { PoiFolder, SavedPoi } from "@/types/pois";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  attrs: [] as Row[],
  attrKeyFilter: [] as string[][],
  geo: {} as Record<string, { name: string; codigo: string; region_codigo: string } | null>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      let ids: string[] = [];
      let keys: string[] | null = null;
      const q = {
        select: () => q,
        in: (col: string, v: string[]) => {
          if (col === "attr_key") {
            keys = v;
            h.attrKeyFilter.push(v);
          } else ids = v;
          return q;
        },
        range: async (from: number, to: number) => ({
          data: h.attrs
            .filter((r) => ids.includes(r.poi_id as string) && (!keys || keys.includes(r.attr_key as string)))
            .slice(from, to + 1),
          error: null,
        }),
      };
      return q;
    },
  },
}));

vi.mock("@/utils/communeReverseGeocode", () => ({
  reverseGeocodeCommune: async (lat: number, lng: number) => h.geo[`${lat},${lng}`] ?? null,
}));

import {
  buildLocalesRows,
  exportFolderLocales,
  localesToCsv,
  normalizeName,
  REGION_NAMES,
  regionNameFromCode,
  santiagoStamp,
} from "@/services/exportFolderLocales";

const folder = (id: string, name: string, parent_id: string | null = null, deleted_at: string | null = null): PoiFolder => ({
  id,
  name,
  parent_id,
  color: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at,
});

const poi = (id: string, name: string, folder_id: string, extra: Partial<SavedPoi> = {}): SavedPoi => ({
  id,
  name,
  description: null,
  category: null,
  color: null,
  icon: null,
  lat: -33.45,
  lng: -70.65,
  properties: {},
  source_layer: null,
  folder_id,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

const attrMap = (o: Record<string, string>) => new Map(Object.entries(o));
const byId = (fs: PoiFolder[]) => new Map(fs.map((f) => [f.id, f] as const));

const SCL = { name: "Santiago", codigo: "13101", region_codigo: "13" };
const BUIN = { name: "Buin", codigo: "13402", region_codigo: "13" };

beforeEach(() => {
  h.attrs = [];
  h.attrKeyFilter = [];
  h.geo = { "-33.45,-70.65": SCL };
});

describe("regionNameFromCode", () => {
  it("devuelve los 16 nombres oficiales con tildes", () => {
    expect(Object.keys(REGION_NAMES)).toHaveLength(16);
    expect(regionNameFromCode("08")).toBe("Biobío");
    expect(regionNameFromCode("05")).toBe("Valparaíso");
    expect(regionNameFromCode("01")).toBe("Tarapacá");
    expect(regionNameFromCode("09")).toBe("La Araucanía");
    expect(regionNameFromCode("14")).toBe("Los Ríos");
    expect(regionNameFromCode("16")).toBe("Ñuble");
    expect(regionNameFromCode("11")).toBe("Aysén del General Carlos Ibáñez del Campo");
    expect(regionNameFromCode("12")).toBe("Magallanes y de la Antártica Chilena");
    expect(regionNameFromCode("13")).toBe("Región Metropolitana de Santiago");
    expect(regionNameFromCode("06")).toBe("Libertador General Bernardo O'Higgins");
  });

  it("usa los 2 primeros dígitos si llega el código de comuna; vacío si no hay o no existe", () => {
    expect(regionNameFromCode("08101")).toBe("Biobío");
    expect(regionNameFromCode(undefined)).toBe("");
    expect(regionNameFromCode("99")).toBe("");
  });
});

describe("buildLocalesRows · mapeo de columnas", () => {
  const fs = [folder("R", "Raíz")];

  it("con atributos: usa la planilla importada", async () => {
    const p = poi("p1", "Nombre POI", "R", {
      operational_status: "cerrado_temporal",
      lat: -33.45,
      lng: -70.65,
      properties: { address: "Props 1" },
    });
    const [r] = await buildLocalesRows(
      [p],
      new Map([
        [
          "p1",
          attrMap({ Local: "123", "Centro Sap": "999", "Nombre Local": "Mall Plaza", Dirección: "Av. 1", Comuna: "Santiago" }),
        ],
      ]),
      byId(fs),
      false,
    );
    expect(r).toMatchObject({
      numLocal: "123",
      nombre: "Mall Plaza",
      direccion: "Av. 1",
      comuna: "Santiago",
      region: "Región Metropolitana de Santiago",
      lat: -33.45,
      lng: -70.65,
      estado: "Cerrado temporalmente",
      discrepancia: false,
    });
    expect(r.source).toEqual({ numLocal: "Local", nombre: "atributo", direccion: "atributo", comuna: "planilla" });
  });

  it("sin atributos: Centro Sap, nombre del POI, dirección de properties y comuna por coordenadas", async () => {
    const withSap = poi("p1", "Solo SAP", "R", { properties: { direccion: "Calle 2" } });
    const bare = poi("p2", "Sin nada", "R");
    const rows = await buildLocalesRows(
      [withSap, bare],
      new Map([["p1", attrMap({ "Centro Sap": "C-77", Local: "  " })]]),
      byId(fs),
      false,
    );
    const a = rows.find((r) => r.nombre === "Solo SAP")!;
    expect(a).toMatchObject({ numLocal: "C-77", direccion: "Calle 2", comuna: "Santiago", estado: "Operativo" });
    expect(a.source).toMatchObject({ numLocal: "Centro Sap", direccion: "direccion", comuna: "coordenadas" });

    // Nada inventado: sin Local ni Centro Sap ni dirección queda vacío.
    const b = rows.find((r) => r.nombre === "Sin nada")!;
    expect(b).toMatchObject({ numLocal: "", direccion: "" });
    expect(b.source).toMatchObject({ numLocal: null, direccion: null });
  });

  it("dirección: atributo > properties.address > properties.direccion", async () => {
    const mk = (id: string, props: Record<string, unknown>) => poi(id, id, "R", { properties: props });
    const rows = await buildLocalesRows(
      [mk("a", { address: "A", direccion: "D" }), mk("b", { direccion: "D" }), mk("c", {})],
      new Map([["c", attrMap({ Dirección: "Del atributo" })]]),
      byId(fs),
      false,
    );
    expect(Object.fromEntries(rows.map((r) => [r.nombre, r.direccion]))).toEqual({
      a: "A",
      b: "D",
      c: "Del atributo",
    });
  });

  it("fallback de comuna: si el punto cae fuera de Chile, comuna y región quedan vacías", async () => {
    const [r] = await buildLocalesRows([poi("p1", "Mar", "R", { lat: 0, lng: 0 })], new Map(), byId(fs), false);
    expect(r).toMatchObject({ comuna: "", region: "", comunaCoordenadas: null, discrepancia: false });
  });

  it("si la comuna de la planilla no coincide con la de coordenadas la conserva y marca discrepancia", async () => {
    const rows = await buildLocalesRows(
      [poi("a", "Igual", "R"), poi("b", "Distinta", "R")],
      new Map([
        ["a", attrMap({ Comuna: "  SANTIAGO " })],
        ["b", attrMap({ Comuna: "Providencia" })],
      ]),
      byId(fs),
      false,
    );
    const igual = rows.find((r) => r.nombre === "Igual")!;
    const distinta = rows.find((r) => r.nombre === "Distinta")!;
    expect(igual.discrepancia).toBe(false);
    expect(distinta).toMatchObject({ comuna: "Providencia", comunaCoordenadas: "Santiago", discrepancia: true });
    // La región sí sale de las coordenadas.
    expect(distinta.region).toBe("Región Metropolitana de Santiago");
  });

  it("latitud y longitud a 6 decimales", async () => {
    h.geo["-33.12345678,-70.98765432"] = BUIN;
    const [r] = await buildLocalesRows(
      [poi("a", "x", "R", { lat: -33.12345678, lng: -70.98765432 })],
      new Map(),
      byId(fs),
      false,
    );
    expect([r.lat, r.lng]).toEqual([-33.123457, -70.987654]);
  });
});

describe("buildLocalesRows · orden y carpeta", () => {
  const fs = [folder("R", "Raíz"), folder("A", "Norte", "R"), folder("B", "Hoja", "A")];

  it("orden natural por N° local y luego Nombre; los sin N° local van al final", async () => {
    const pois = [
      poi("1", "Zeta", "R"),
      poi("2", "Beta", "R"),
      poi("3", "Alfa", "R"),
      poi("4", "Gamma", "R"),
      poi("5", "Sin número B", "R"),
      poi("6", "Sin número A", "R"),
    ];
    const attrs = new Map([
      ["1", attrMap({ Local: "10" })],
      ["2", attrMap({ Local: "2" })],
      ["3", attrMap({ Local: "2" })],
      ["4", attrMap({ Local: "1" })],
    ]);
    const rows = await buildLocalesRows(pois, attrs, byId(fs), false);
    expect(rows.map((r) => r.nombre)).toEqual(["Gamma", "Alfa", "Beta", "Zeta", "Sin número A", "Sin número B"]);
  });

  it("la columna Carpeta lleva la ruta «A › B» solo si se pide", async () => {
    const p = poi("1", "x", "B");
    expect((await buildLocalesRows([p], new Map(), byId(fs), true))[0].carpeta).toBe("Raíz › Norte › Hoja");
    expect((await buildLocalesRows([p], new Map(), byId(fs), false))[0].carpeta).toBe("");
  });
});

describe("localesToCsv", () => {
  const fs = [folder("R", "Raíz")];

  it("BOM, separador ';', encabezados en orden y decimales con punto", async () => {
    const rows = await buildLocalesRows(
      [poi("1", "Local Uno", "R", { lat: -33.45, lng: -70.65 })],
      new Map([["1", attrMap({ Local: "5" })]]),
      byId(fs),
      false,
    );
    const csv = localesToCsv(rows, false);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "N° local;Nombre;Dirección;Comuna;Región;Latitud;Longitud;Estado",
      "5;Local Uno;;Santiago;Región Metropolitana de Santiago;-33.450000;-70.650000;Operativo",
    ]);
  });

  it("agrega la columna Carpeta al final cuando corresponde", async () => {
    const rows = await buildLocalesRows([poi("1", "x", "R")], new Map(), byId(fs), true);
    const [head, line] = localesToCsv(rows, true).slice(1).split("\r\n");
    expect(head.endsWith(";Estado;Carpeta")).toBe(true);
    expect(line.endsWith(";Operativo;Raíz")).toBe(true);
  });

  it("escapa comas, comillas, punto y coma y saltos de línea; lat/lng vacías si no hay coordenadas", async () => {
    const rows = await buildLocalesRows(
      [
        poi("1", 'Tienda "Sur", Local; 2', "R", { properties: { address: "Av. 1\nPiso 2\r\nOficina 3" } }),
        poi("2", "Sin coords", "R", { lat: NaN, lng: NaN }),
      ],
      new Map(),
      byId(fs),
      false,
    );
    const csv = localesToCsv(rows, false);
    expect(csv).toContain('"Tienda ""Sur"", Local; 2"');
    expect(csv).toContain('"Av. 1\nPiso 2\r\nOficina 3"');
    const sinCoords = csv.split("\r\n").find((l) => l.includes("Sin coords"))!;
    expect(sinCoords).toBe(";Sin coords;;;;;;Operativo");
  });
});

describe("santiagoStamp", () => {
  it("usa la fecha de Santiago, no la UTC (verano UTC-3)", () => {
    expect(santiagoStamp(new Date("2026-01-15T02:30:00Z"))).toEqual({
      date: "20260114",
      dateTime: "2026-01-14 23:30:00",
    });
  });

  it("invierno UTC-4 y medianoche como 00", () => {
    expect(santiagoStamp(new Date("2026-07-01T04:00:05Z"))).toEqual({
      date: "20260701",
      dateTime: "2026-07-01 00:00:05",
    });
  });
});

describe("normalizeName", () => {
  it("ignora tildes, mayúsculas y espacios repetidos", () => {
    expect(normalizeName("  ÑUÑOA  ")).toBe(normalizeName("Nunoa"));
    expect(normalizeName("San  Bernardo")).toBe("san bernardo");
  });
});

describe("exportFolderLocales", () => {
  const folders = [
    folder("R", "Retail Norte"),
    folder("C", "Sub", "R"),
    folder("X", "Otra"),
    folder("D", "Borrada", "R", "2026-02-01T00:00:00Z"),
    folder("L", "Hoja suelta"),
  ];
  const pois = [
    poi("p1", "Uno", "R", { operational_status: "cerrado_definitivo" }),
    poi("p2", "Dos", "C", { lat: -33.6, lng: -70.7 }),
    poi("p3", "Fuera", "X"),
    poi("p4", "Borrado", "R", { deleted_at: "2026-03-01T00:00:00Z" }),
    poi("p5", "En carpeta borrada", "D"),
    poi("p6", "Suelto", "L"),
  ];

  let blobs: Blob[];
  let names: string[];
  /** Filas de Metadatos como texto "a | b | c", sin las celdas vacías de relleno al final. */
  const metaLines = (wb: XLSX.WorkBook) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Metadatos"], { header: 1, defval: null }).map((r) => {
      const cells = [...r];
      while (cells.length && cells[cells.length - 1] === null) cells.pop();
      return cells.join(" | ");
    });
  const readBytes = (blob: Blob) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(blob);
    });

  beforeEach(() => {
    blobs = [];
    names = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    h.geo["-33.6,-70.7"] = BUIN;
    h.attrs = [
      { poi_id: "p1", attr_key: "Local", attr_value: "10" },
      { poi_id: "p1", attr_key: "Comuna", attr_value: "Providencia" }, // discrepa con Santiago
      { poi_id: "p1", attr_key: "Otro", attr_value: "no se pide" },
      { poi_id: "p2", attr_key: "Local", attr_value: "007" },
      { poi_id: "p6", attr_key: "Local", attr_value: "3" },
      { poi_id: "p3", attr_key: "Local", attr_value: "99" },
    ];
  });

  afterEach(() => vi.restoreAllMocks());

  it("Excel: hojas Locales y Metadatos, celdas numéricas, autofiltro, anchos y alcance con subcarpetas", async () => {
    const res = await exportFolderLocales(folders[0], folders, pois, "xlsx");
    expect(res.rows).toBe(2);
    expect(res.columns).toBe(9);
    expect(res.filename).toMatch(/^locales_retail_norte_\d{8}\.xlsx$/);
    expect(names).toEqual([res.filename]);
    // Solo se piden las claves necesarias a la BD.
    expect(h.attrKeyFilter[0].sort()).toEqual(["Centro Sap", "Comuna", "Dirección", "Local", "Nombre Local"].sort());

    const wb = XLSX.read(await readBytes(blobs[0]), { type: "array", cellNF: true, cellStyles: true });
    expect(wb.SheetNames).toEqual(["Locales", "Metadatos"]);

    const ws = wb.Sheets["Locales"];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    expect(aoa[0]).toEqual(["N° local", "Nombre", "Dirección", "Comuna", "Región", "Latitud", "Longitud", "Estado", "Carpeta"]);
    // Orden natural: "007" (texto, conserva ceros) < 10
    expect(aoa[1]).toEqual(["007", "Dos", null, "Buin", "Región Metropolitana de Santiago", -33.6, -70.7, "Operativo", "Retail Norte › Sub"]);
    expect(aoa[2]).toEqual([10, "Uno", null, "Providencia", "Región Metropolitana de Santiago", -33.45, -70.65, "Cerrado definitivamente", "Retail Norte"]);

    expect(ws["A3"].t).toBe("n"); // N° local numérico
    expect(ws["A2"].t).toBe("s"); // "007" no pierde los ceros
    expect(ws["F2"].t).toBe("n");
    expect(ws["F2"].z).toBe("0.000000");
    expect(ws["!autofilter"]?.ref).toBe("A1:I3");
    expect(ws["!cols"]).toHaveLength(9);
    expect(ws["!cols"]!.every((c) => (c.wch ?? 0) >= 8)).toBe(true);

    const flat = metaLines(wb);
    expect(flat).toContain("Carpeta exportada | Retail Norte");
    expect(flat).toContain("N° de locales | 2");
    expect(flat.find((l) => l.startsWith("Fecha y hora de exportación (America/Santiago)"))).toMatch(
      /\| \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(flat.some((l) => l.startsWith("Comuna | Planilla: 1 · calculada: 1 · vacío: 0 | Planilla importada"))).toBe(true);
    expect(flat).toContain("Discrepancias de comuna (planilla vs. coordenadas): 1");
    // Fila 3 de «Locales» = el local 10 (Providencia en planilla, Santiago por coordenadas)
    expect(flat).toContain("3 | 10 | Uno | Providencia | Santiago | Región Metropolitana de Santiago");
  });

  it("Excel sin subcarpetas: omite la columna Carpeta y dice que no hay discrepancias", async () => {
    const res = await exportFolderLocales(folders[4], folders, pois, "xlsx");
    expect(res.columns).toBe(8);
    const wb = XLSX.read(await readBytes(blobs[0]), { type: "array" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Locales"], { header: 1, defval: null });
    expect(aoa[0]).toHaveLength(8);
    expect(aoa[0]).not.toContain("Carpeta");
    expect(metaLines(wb)).toContain("Sin discrepancias.");
  });

  it("CSV: bytes con BOM, tipo y nombre de archivo", async () => {
    const res = await exportFolderLocales(folders[0], folders, pois, "csv");
    expect(res.filename).toMatch(/^locales_retail_norte_\d{8}\.csv$/);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await readBytes(blobs[0]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text.split("\r\n")).toEqual([
      "N° local;Nombre;Dirección;Comuna;Región;Latitud;Longitud;Estado;Carpeta",
      "007;Dos;;Buin;Región Metropolitana de Santiago;-33.600000;-70.700000;Operativo;Retail Norte › Sub",
      "10;Uno;;Providencia;Región Metropolitana de Santiago;-33.450000;-70.650000;Cerrado definitivamente;Retail Norte",
    ]);
  });

  it("falla si la carpeta no tiene POIs activos", async () => {
    await expect(exportFolderLocales(folders[2], folders, [], "csv")).rejects.toThrow(
      "La carpeta no contiene POIs activos",
    );
  });
});
