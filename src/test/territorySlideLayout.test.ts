import { describe, it, expect } from "vitest";
import { drawTerritorySlide } from "@/utils/reportExportPptx";
import type { Cell, SlideSurface, TableOpts, TextOpts, RectOpts, LineOpts, ImageOpts } from "@/utils/slideSurface";
import type { IsochroneReport } from "@/utils/reportData";

/**
 * La lámina 1 mide 10 × 5,625" y su cuerpo termina en 5,305" (el resto es
 * margen inferior). Al agregarle la tabla de locales de la red, la columna de
 * datos quedó con cuatro bloques donde antes había tres: el reparto de alto se
 * mide en vez de suponerse, y se comprueba además que ningún dato se caiga por
 * el camino — recortar la lista de comunas para hacer espacio ya pasó una vez.
 */
const CUERPO = 5.625 - 0.32;

/** Superficie que no dibuja: registra dónde termina cada cosa. */
class Regla implements SlideSurface {
  fondos: Array<{ y: number; alto: number; texto: string }> = [];
  text(content: string | unknown, o: TextOpts) {
    this.fondos.push({
      y: o.y, alto: o.h,
      texto: typeof content === "string" ? content : "(runs)",
    });
  }
  rect(o: RectOpts) { this.fondos.push({ y: o.y, alto: o.h, texto: "(rect)" }); }
  line(o: LineOpts) { this.fondos.push({ y: o.y, alto: 0, texto: "(line)" }); }
  table(rows: Cell[][], o: TableOpts) {
    this.fondos.push({
      y: o.y, alto: rows.length * o.rowH,
      texto: rows.map((r) => r.map((c) => c.text).join("/")).join(" ~ "),
    });
  }
  image(o: ImageOpts) { this.fondos.push({ y: o.y, alto: o.h, texto: "(imagen)" }); }
  /** Lo más abajo que llega algo dibujado. */
  get fondo() { return Math.max(...this.fondos.map((f) => f.y + f.alto)); }
  /** Filas de la tabla cuyo encabezado empieza con `cabecera`. */
  filas(cabecera: string) {
    const t = this.fondos.find((f) => f.texto.startsWith(cabecera));
    return t ? t.texto.split(" ~ ") : [];
  }
  contiene(txt: string) { return this.fondos.some((f) => f.texto.includes(txt)); }
}

const informe = (opts: {
  comunas: number; gse: number; zonas: number; locales: number;
}): IsochroneReport => ({
  iso: { name: "Rancagua America - 5min", minutes: [5] },
  bands: [{
    bandMinutes: 5,
    area_km2: 33.01,
    totals: { pop: 137375, hh: 49868, incomeAvgPerHh: 2589009 },
    density: { popPerKm2: 4162 },
    nseDistribution: Array.from({ length: opts.gse }, (_, i) => ({
      label: ["ABC1", "C1", "C2", "C3", "D", "E"][i] ?? `X${i}`, pct: 10 + i,
    })),
    communes: Array.from({ length: opts.comunas }, (_, i) => ({
      name: `Comuna larga número ${i + 1}`,
      areaShareInIso: 1 / opts.comunas,
      popInIso: 40000, popMeasured: 40000,
    })),
  }],
  zonasAledanas: Array.from({ length: opts.zonas }, (_, i) => ({ name: `Machali ${i + 1}` })),
  nearbyStores: Array.from({ length: opts.locales }, (_, i) => ({
    name: `AP00${i + 10}-Local con nombre largo`,
    from: i === 0 ? "iso" : "aledana", fromName: i === 0 ? null : "Machali",
    km: 3.4 + i, minutes: 9 + i,
  })),
} as unknown as IsochroneReport);

describe("lámina 1 · reparto de alto", () => {
  it("el caso de Rancagua entra completo: las dos comunas y los tres locales", () => {
    const r = new Regla();
    drawTerritorySlide(r, informe({ comunas: 2, gse: 6, zonas: 1, locales: 3 }));

    // encabezado + 2 comunas + total, sin recortes.
    expect(r.filas("Comuna/% área/Personas")).toHaveLength(4);
    expect(r.contiene("Comuna larga número 1")).toBe(true);
    expect(r.contiene("Comuna larga número 2")).toBe(true);
    expect(r.contiene("no listada(s) por espacio")).toBe(false);

    // encabezado + 3 locales.
    expect(r.filas("Local/Dist./Tiempo")).toHaveLength(4);
    expect(r.contiene("no listado(s) por espacio")).toBe(false);

    // Las seis clases GSE siguen estando, ahora de a dos por fila.
    for (const c of ["ABC1", "C1", "C2", "C3", "D", "E"]) expect(r.contiene(c)).toBe(true);

    expect(r.fondo).toBeLessThanOrEqual(CUERPO);
  });

  it("con muchas comunas los locales igual entran y las comunas se recortan", () => {
    const r = new Regla();
    drawTerritorySlide(r, informe({ comunas: 14, gse: 6, zonas: 2, locales: 3 }));
    expect(r.contiene("LOCALES DE LA RED EN EL ENTORNO")).toBe(true);
    expect(r.contiene("no listada(s) por espacio")).toBe(true);
    // Aunque se recorte, el total sigue cubriendo todas las comunas.
    expect(r.contiene("Total")).toBe(true);
    expect(r.fondo).toBeLessThanOrEqual(CUERPO);
  });

  it("sin locales cercanos la lámina sigue cerrando", () => {
    const r = new Regla();
    drawTerritorySlide(r, informe({ comunas: 6, gse: 6, zonas: 0, locales: 0 }));
    expect(r.contiene("LOCALES DE LA RED EN EL ENTORNO")).toBe(false);
    expect(r.filas("Comuna/% área/Personas")).toHaveLength(8);
    expect(r.fondo).toBeLessThanOrEqual(CUERPO);
  });
});
