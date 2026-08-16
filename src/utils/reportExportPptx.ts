import type PptxGenJS from "pptxgenjs";
import type { IsochroneReport, ReportProjection } from "./reportData";
import type { MapCaptureImages } from "./mapCapture";

/**
 * Exporta el informe como 2 láminas para directorio, siguiendo el formato de
 * las presentaciones existentes: Arial, acento carmesí, tablas densas de dos
 * columnas y todo dentro de una sola lámina sin desbordes.
 */

// ── Sistema de diseño, tomado de la lámina de referencia ─────────────────────
const C = {
  crimson: "C0003F",
  ink:     "1A1A1A",
  grid:    "CCCCCC",
  rowAlt:  "F2F2F2",
  muted:   "666666",
  hilite:  "FBE4EA",
  white:   "FFFFFF",
};

const FONT = "Arial";

// Lámina 10 × 5.625" (16:9). Todo se posiciona dentro de estos límites.
const W = 10;
const H = 5.625;
const ML = 0.5;              // margen izquierdo/derecho
const COL_GAP = 0.28;
const COL_W = (W - ML * 2 - COL_GAP) / 2;
const COL_R_X = ML + COL_W + COL_GAP;
const BODY_TOP = 1.12;       // bajo el encabezado
const BODY_BOTTOM = H - 0.32;

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtCLP = (n: number) => `$${fmt(n)}`;

/** Tipografía compartida de las tablas: densa pero legible al proyectar. */
const cellBase = {
  fontFace: FONT,
  fontSize: 7.5,
  color: C.ink,
  valign: "middle" as const,
  // Sin achicar el relleno, la fila rinde ~0,22" en vez de ROW_H y las
  // bandas siguientes se superponen.
  margin: [1, 3, 1, 3] as [number, number, number, number],
};

const headerRow = (labels: string[]) =>
  labels.map((text, i) => ({
    text,
    options: {
      ...cellBase,
      bold: true,
      color: C.white,
      fill: { color: C.crimson },
      align: (i === 0 ? "left" : "right") as "left" | "right",
    },
  }));

interface RowOpts {
  bold?: boolean;
  fill?: string;
  /** Fila destacada en carmesí con texto blanco (totales). */
  accent?: boolean;
}

const row = (cells: Array<string | number>, opts: RowOpts = {}) =>
  cells.map((c, i) => ({
    text: String(c),
    options: {
      ...cellBase,
      bold: opts.bold || opts.accent,
      color: opts.accent ? C.white : C.ink,
      fill: opts.accent ? { color: C.crimson } : opts.fill ? { color: opts.fill } : undefined,
      align: (i === 0 ? "left" : "right") as "left" | "right",
    },
  }));

/** Encabezado común: cintillo de sección, título y línea divisoria. */
const addHeader = (slide: PptxGenJS.Slide, eyebrow: string, title: string) => {
  slide.addText(eyebrow.toUpperCase(), {
    x: ML, y: 0.22, w: W - ML * 2, h: 0.28,
    fontFace: FONT, fontSize: 14, bold: true, color: C.crimson, margin: 0,
  });
  slide.addText(title, {
    x: ML, y: 0.52, w: W - ML * 2, h: 0.38,
    fontFace: FONT, fontSize: 16, bold: true, color: C.ink, margin: 0,
  });
  slide.addShape("line", {
    x: ML, y: 1.0, w: W - ML * 2, h: 0,
    line: { color: C.grid, width: 1 },
  });
};

const addColTitle = (slide: PptxGenJS.Slide, text: string, x: number, y: number) => {
  slide.addText(text, {
    x, y, w: COL_W, h: 0.24,
    fontFace: FONT, fontSize: 11, bold: true, color: C.ink, margin: 0,
  });
};

/** Banda carmesí que titula una tabla, como el "Resumen Ejecutivo" del modelo. */
const addTableBand = (slide: PptxGenJS.Slide, text: string, x: number, y: number) => {
  slide.addShape("rect", {
    x, y, w: COL_W, h: 0.2, fill: { color: C.crimson }, line: { color: C.crimson },
  });
  slide.addText(text, {
    x: x + 0.06, y, w: COL_W - 0.12, h: 0.2,
    fontFace: FONT, fontSize: 8, bold: true, color: C.white, valign: "middle", margin: 0,
  });
};

const ROW_H = 0.163;

/** Alto disponible desde `y` hasta el pie de la lámina, en filas. */
const rowsThatFit = (y: number) => Math.max(0, Math.floor((BODY_BOTTOM - y) / ROW_H));



// ── Lámina 1: perfil territorial ─────────────────────────────────────────────
const addTerritorySlide = (
  pptx: PptxGenJS,
  report: IsochroneReport,
  images?: MapCaptureImages | null,
) => {
  const slide = pptx.addSlide();
  const band = report.bands[report.bands.length - 1];
  const name = report.iso.name ?? "Isócrona";

  addHeader(
    slide,
    "Análisis territorial",
    `${name} → ${report.iso.modeLabel} ${report.iso.minutes.join("/")} min`,
  );

  // ── Columna izquierda: cifras clave + comunas ──────────────────────────────
  let y = BODY_TOP;
  addColTitle(slide, "Aspectos clave", ML, y);
  y += 0.3;

  const resumen: Array<[string, string]> = [
    ["Personas", fmt(band.totals.pop)],
    ["Hogares", fmt(band.totals.hh)],
    ["Ingreso promedio por hogar", fmtCLP(band.totals.incomeAvgPerHh)],
    ["Ingreso total del área / mes", fmtCLP(band.totals.incomeTotal)],
    ["Área", `${band.area_km2.toFixed(2)} km²`],
    ["Densidad", `${fmt(band.density.popPerKm2)} hab/km²`],
    ["Punto de análisis", `${report.iso.centerLat.toFixed(4)}, ${report.iso.centerLng.toFixed(4)}`],
  ];
  addTableBand(slide, "RESUMEN EJECUTIVO DEL ÁREA", ML, y);
  y += 0.2;
  slide.addTable(
    resumen.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
    { x: ML, y, w: COL_W, colW: [COL_W * 0.62, COL_W * 0.38], rowH: ROW_H,
      border: { type: "solid", color: C.grid, pt: 0.5 } },
  );
  y += resumen.length * ROW_H + 0.22;

  // Comunas: se recortan a lo que cabe, nunca desbordan la lámina.
  const comunasFit = Math.min(band.communes.length, rowsThatFit(y + 0.2) - 1);
  if (comunasFit > 0) {
    addTableBand(slide, "COMUNAS EN EL ÁREA", ML, y);
    y += 0.2;
    const filas = band.communes.slice(0, comunasFit);
    slide.addTable(
      [
        headerRow(["Comuna", "% del área", "Personas"]),
        ...filas.map((c, i) =>
          row(
            [c.name, `${(c.areaShareInIso * 100).toFixed(0)}%`, fmt(c.popInIso)],
            { fill: i % 2 ? C.rowAlt : undefined },
          ),
        ),
      ],
      { x: ML, y, w: COL_W, colW: [COL_W * 0.5, COL_W * 0.24, COL_W * 0.26], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
  }

  // ── Columna derecha: mezcla socioeconómica + mapa ──────────────────────────
  let ry = BODY_TOP;
  const gseRows = band.nseDistribution.filter((n) => n.pct > 0);
  if (gseRows.length > 0) {
    addTableBand(slide, "COMPOSICIÓN SOCIOECONÓMICA (% DE HOGARES)", COL_R_X, ry);
    ry += 0.2;
    slide.addTable(
      [
        headerRow(["Grupo", "% hogares"]),
        ...gseRows.map((n, i) =>
          row([n.label, `${n.pct}%`], { fill: i % 2 ? C.rowAlt : undefined }),
        ),
      ],
      { x: COL_R_X, y: ry, w: COL_W, colW: [COL_W * 0.6, COL_W * 0.4], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
    ry += (gseRows.length + 1) * ROW_H + 0.2;
  }

  // El mapa ocupa el espacio que quede, respetando el pie.
  const mapImg = images?.gse ?? images?.isoOnly ?? images?.atractores ?? null;
  const mapH = BODY_BOTTOM - ry - 0.16;
  if (mapImg && mapH > 0.9) {
    slide.addImage({ data: mapImg, x: COL_R_X, y: ry, w: COL_W, h: mapH, sizing: { type: "cover", w: COL_W, h: mapH } });
    slide.addText("Área analizada · composición socioeconómica por manzana", {
      x: COL_R_X, y: ry + mapH + 0.01, w: COL_W, h: 0.16,
      fontFace: FONT, fontSize: 6.5, color: C.muted, margin: 0,
    });
  }
};

// ── Lámina 2: proyección de venta ────────────────────────────────────────────
const addProjectionSlide = (
  pptx: PptxGenJS,
  report: IsochroneReport,
  proj: ReportProjection,
) => {
  const slide = pptx.addSlide();
  const name = report.iso.name ?? "Isócrona";
  addHeader(slide, "Proyección de potencial de venta", `${name} → ${proj.folderName}`);

  // ── Columna izquierda: cifra central y supuestos ───────────────────────────
  let y = BODY_TOP;
  addColTitle(slide, "Potencial estimado", ML, y);
  y += 0.32;

  slide.addText(`${fmt(proj.estimatedUf)} UF/mes`, {
    x: ML, y, w: COL_W, h: 0.42,
    fontFace: FONT, fontSize: 26, bold: true, color: C.crimson, margin: 0,
  });
  y += 0.44;
  slide.addText(
    `${fmtCLP(proj.estimatedClp)}/mes · en régimen · rango ${fmt(proj.lowUf)}–${fmt(proj.highUf)} UF`,
    { x: ML, y, w: COL_W, h: 0.2, fontFace: FONT, fontSize: 8, color: C.muted, margin: 0 },
  );
  y += 0.3;

  const apertura = proj.years.find((r) => r.isBase);
  const supuestos: Array<[string, string]> = [
    ...(proj.rampEnabled && apertura
      ? ([["Venta al abrir", `${fmt(apertura.uf)} UF/mes (${Math.round(apertura.maturityPct)}% del régimen)`]] as Array<[string, string]>)
      : []),
    ["Maduración", proj.rampEnabled ? "Ubicación nueva, parte en rampa" : "Ubicación ya en régimen"],
    ["Ajuste manual del analista", proj.adjustPct !== 0 ? `${proj.adjustPct > 0 ? "+" : ""}${proj.adjustPct}%` : "Sin ajuste"],
    ["Base de cálculo", `${proj.comparables.length} locales comparables`],
  ];
  addTableBand(slide, "SUPUESTOS", ML, y);
  y += 0.2;
  slide.addTable(
    supuestos.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
    { x: ML, y, w: COL_W, colW: [COL_W * 0.42, COL_W * 0.58], rowH: ROW_H,
      border: { type: "solid", color: C.grid, pt: 0.5 } },
  );
  y += supuestos.length * ROW_H + 0.22;

  const compFit = Math.min(proj.comparables.length, rowsThatFit(y + 0.2) - 1);
  if (compFit > 0) {
    addTableBand(slide, "LOCALES COMPARABLES", ML, y);
    y += 0.2;
    slide.addTable(
      [
        headerRow(["Local", "UF/mes", "Fuente"]),
        ...proj.comparables.slice(0, compFit).map((c, i) =>
          row([c.name, fmt(c.ufPerMonth), c.isActual ? "Venta real" : "Predicción"], {
            fill: i % 2 ? C.rowAlt : undefined,
          }),
        ),
      ],
      { x: ML, y, w: COL_W, colW: [COL_W * 0.5, COL_W * 0.22, COL_W * 0.28], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
  }

  // ── Columna derecha: curva año a año ───────────────────────────────────────
  let ry = BODY_TOP;
  addTableBand(slide, "PROYECCIÓN AÑO A AÑO", COL_R_X, ry);
  ry += 0.2;
  const years = proj.years.slice(0, Math.max(0, rowsThatFit(ry) - 1));
  slide.addTable(
    [
      headerRow(["Año", "Crecimiento", "% régimen", "UF/mes", "CLP/mes"]),
      ...years.map((r, i) =>
        row(
          [
            r.label,
            r.isBase ? "—" : `${r.ratePct > 0 ? "+" : ""}${r.ratePct}%`,
            `${Math.round(r.maturityPct)}%`,
            fmt(r.uf),
            fmtCLP(r.clp),
          ],
          // La primera fila es la apertura y el cierre es el régimen: se marcan.
          r.isBase ? { fill: C.hilite, bold: true } : { fill: i % 2 ? C.rowAlt : undefined },
        ),
      ),
    ],
    { x: COL_R_X, y: ry, w: COL_W,
      colW: [COL_W * 0.2, COL_W * 0.22, COL_W * 0.18, COL_W * 0.18, COL_W * 0.22],
      rowH: ROW_H, border: { type: "solid", color: C.grid, pt: 0.5 } },
  );
  ry += (years.length + 1) * ROW_H + 0.22;

  const notas = [
    proj.rampEnabled
      ? "El potencial estimado corresponde al nivel en régimen. Un local recién abierto no rinde eso desde el primer día: la curva parte en la fracción medida en la red y sube hasta el 100%."
      : "Se asume la ubicación ya en régimen desde el primer año.",
    proj.adjustPct !== 0
      ? `Incluye un ajuste manual de ${proj.adjustPct > 0 ? "+" : ""}${proj.adjustPct}% aplicado por el analista, no derivado del modelo.`
      : null,
    "Estimación referencial construida por comparación con locales de la red; no reemplaza un estudio de terreno.",
  ].filter(Boolean) as string[];

  if (BODY_BOTTOM - ry > 0.4) {
    slide.addText(notas.map((t) => ({ text: t, options: { breakLine: true } })), {
      x: COL_R_X, y: ry, w: COL_W, h: BODY_BOTTOM - ry,
      fontFace: FONT, fontSize: 6.5, color: C.muted, valign: "top", margin: 0, lineSpacingMultiple: 1.15,
    });
  }
};

/** Genera y descarga el informe en 2 láminas. */
export const exportReportToPptx = async (
  report: IsochroneReport,
  projection: ReportProjection | null,
  images?: MapCaptureImages | null,
): Promise<void> => {
  const { default: PptxGen } = await import("pptxgenjs");
  const pptx = new PptxGen();
  // Debe fijarse ANTES de agregar láminas o las coordenadas quedan fuera.
  pptx.layout = "LAYOUT_16x9";
  pptx.defineSlideMaster({
    title: "GEOPLANET",
    background: { color: C.white },
  });

  addTerritorySlide(pptx, report, images);
  if (projection) addProjectionSlide(pptx, report, projection);

  const fecha = new Date(report.generatedAt).toISOString().slice(0, 10).replace(/-/g, "");
  const base = (report.iso.name ?? "isocrona").replace(/[^\w-]+/g, "_");
  await pptx.writeFile({ fileName: `informe-${base}-${fecha}.pptx` });
};
