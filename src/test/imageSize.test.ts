import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { pngSize, fitContain } from "@/utils/imageSize";
import { drawTerritorySlide } from "@/utils/reportExportPptx";
import type { Cell, SlideSurface, TableOpts, TextOpts, RectOpts, LineOpts, ImageOpts } from "@/utils/slideSurface";
import type { IsochroneReport } from "@/utils/reportData";

/** PNG real extraído del informe de Rancagua América (2102 × 1488). */
const FOTO = fs.existsSync("src/test/fixtures/mapa.png.b64")
  ? fs.readFileSync("src/test/fixtures/mapa.png.b64", "utf8").trim()
  : null;

/** PNG mínimo con el ancho y alto que se pidan, solo cabecera IHDR. */
const pngDe = (w: number, h: number) => {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return `data:image/png;base64,${b.toString("base64")}`;
};

describe("proporción de las fotos del mapa", () => {
  it("lee el tamaño del PNG sin decodificarlo", () => {
    expect(pngSize(pngDe(2102, 1488))).toEqual({ w: 2102, h: 1488 });
    expect(pngSize(pngDe(800, 1200))).toEqual({ w: 800, h: 1200 });
    expect(pngSize("data:image/png;base64,QQ==")).toBeNull();
    expect(pngSize(null)).toBeNull();
  });

  if (FOTO) {
    it("lee el tamaño de una foto real del informe", () => {
      expect(pngSize(FOTO)).toEqual({ w: 2102, h: 1488 });
    });
  }

  it("centra dentro del recuadro sin deformar", () => {
    const caja = { x: 1, y: 2, w: 2.76, h: 1.862 };
    const r = fitContain(caja, { w: 2102, h: 1488 });
    expect(r.w / r.h).toBeCloseTo(2102 / 1488, 3);
    expect(r.w).toBeLessThanOrEqual(caja.w + 1e-9);
    expect(r.h).toBeLessThanOrEqual(caja.h + 1e-9);
    // Centrado: el aire sobrante se reparte a ambos lados.
    expect(r.x - caja.x).toBeCloseTo(caja.x + caja.w - (r.x + r.w), 6);
  });
});

class Regla implements SlideSurface {
  imagenes: ImageOpts[] = [];
  text(_c: string | unknown, _o: TextOpts) {}
  rect(_o: RectOpts) {}
  line(_o: LineOpts) {}
  table(_rows: Cell[][], _o: TableOpts) {}
  image(o: ImageOpts) { this.imagenes.push(o); }
}

const informeCon = (foto: string): IsochroneReport => ({
  iso: { name: "Iso", minutes: [5] },
  bands: [{
    bandMinutes: 5, area_km2: 10,
    totals: { pop: 1000, hh: 400, incomeAvgPerHh: 1000000 },
    density: { popPerKm2: 100 },
    nseDistribution: [{ label: "ABC1", pct: 100 }],
    communes: [{ name: "A", areaShareInIso: 1, popInIso: 1000, popMeasured: 1000 }],
  }],
} as unknown as IsochroneReport);

describe("lámina 1 · fotos", () => {
  it.each([
    [2102, 1488], // panel abierto
    [1600, 1400], // panel angosto: contenedor casi cuadrado
    [2400, 1000], // ventana ancha y baja
    [1488, 1488], // foto cuadrada, que es como salen desde el recorte
  ])("dibuja la foto de %ix%i con su propia proporción", (w, h) => {
    const r = new Regla();
    const foto = pngDe(w, h);
    drawTerritorySlide(r, informeCon(foto), {
      isoOnly: foto, gse: foto, gasto: foto, atractores: foto,
    } as never);
    expect(r.imagenes).toHaveLength(4);
    for (const img of r.imagenes) expect(img.w / img.h).toBeCloseTo(w / h, 3);

    // Las cuatro miden lo mismo y ninguna se sale del cuerpo de la lámina.
    const [a] = r.imagenes;
    for (const img of r.imagenes) {
      expect(img.w).toBeCloseTo(a.w, 6);
      expect(img.h).toBeCloseTo(a.h, 6);
      expect(img.y + img.h).toBeLessThanOrEqual(5.625 - 0.32 + 1e-9);
      expect(img.x + img.w).toBeLessThanOrEqual(10 - 0.5 + 1e-9);
    }
    // La grilla queda centrada verticalmente en el cuerpo de la lámina.
    const arriba = Math.min(...r.imagenes.map((i) => i.y));
    const abajo = Math.max(...r.imagenes.map((i) => i.y + i.h));
    // El título de cada foto ocupa 0,17" sobre ella, también dentro del cuerpo.
    expect(arriba - 0.17 - 1.12).toBeCloseTo(5.625 - 0.32 - abajo, 6);
  });
});
