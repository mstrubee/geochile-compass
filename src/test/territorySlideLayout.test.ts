import { describe, it, expect } from "vitest";
import { drawTerritorySlide } from "@/utils/reportExportPptx";
import type { Cell, SlideSurface, TableOpts, TextOpts, RectOpts, LineOpts, ImageOpts } from "@/utils/slideSurface";
import type { IsochroneReport } from "@/utils/reportData";

/**
 * La lámina 1 mide 10 × 5,625" y nada puede sobrepasar su borde inferior.
 * Al agregarle la tabla de locales de la red, la columna de datos quedó con
 * cuatro bloques donde antes había tres, así que el reparto de alto se
 * verifica en vez de suponerse.
 */
const ALTO = 5.625;

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
      texto: rows[0]?.map((c) => c.text).join("/") ?? "(tabla)",
    });
  }
  image(o: ImageOpts) { this.fondos.push({ y: o.y, alto: o.h, texto: "(imagen)" }); }
  /** Lo más abajo que llega algo dibujado. */
  get fondo() { return Math.max(...this.fondos.map((f) => f.y + f.alto)); }
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
  it("el caso de Rancagua entra completo: comunas y locales", () => {
    const r = new Regla();
    drawTerritorySlide(r, informe({ comunas: 2, gse: 6, zonas: 1, locales: 3 }));
    expect(r.contiene("COMUNAS")).toBe(true);
    expect(r.contiene("LOCALES DE LA RED EN EL ENTORNO")).toBe(true);
    expect(r.contiene("Comuna/% área/Personas")).toBe(true);
    expect(r.contiene("Local/Dist./Tiempo")).toBe(true);
    expect(r.fondo).toBeLessThanOrEqual(ALTO);
  });

  it("con muchas comunas los locales igual entran y las comunas se recortan", () => {
    const r = new Regla();
    drawTerritorySlide(r, informe({ comunas: 14, gse: 6, zonas: 2, locales: 3 }));
    expect(r.contiene("LOCALES DE LA RED EN EL ENTORNO")).toBe(true);
    expect(r.contiene("no listada(s) por espacio")).toBe(true);
    expect(r.fondo).toBeLessThanOrEqual(ALTO);
  });

  it("sin locales cercanos la lámina sigue cerrando", () => {
    const r = new Regla();
    drawTerritorySlide(r, informe({ comunas: 6, gse: 6, zonas: 0, locales: 0 }));
    expect(r.contiene("LOCALES DE LA RED EN EL ENTORNO")).toBe(false);
    expect(r.fondo).toBeLessThanOrEqual(ALTO);
  });
});
