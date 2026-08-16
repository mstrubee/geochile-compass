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

/**
 * Nombre sin el tiempo al final.
 *
 * Las isócronas suelen guardarse como "Fontova - 5min", y el título le agrega
 * el tiempo otra vez: "Fontova - 5min – Isócrona 5min".
 */
const baseName = (name: string) =>
  name.replace(/[\s–—-]*\d+\s*min(utos)?\.?\s*$/i, "").trim() || name;

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
const addTableBand = (
  slide: PptxGenJS.Slide, text: string, x: number, y: number, w: number = COL_W,
) => {
  slide.addShape("rect", {
    x, y, w, h: 0.2, fill: { color: C.crimson }, line: { color: C.crimson },
  });
  slide.addText(text, {
    x: x + 0.06, y, w: w - 0.12, h: 0.2,
    fontFace: FONT, fontSize: 8, bold: true, color: C.white, valign: "middle", margin: 0,
  });
};

const ROW_H = 0.155;

/** Alto disponible desde `y` hasta el pie de la lámina, en filas. */
const rowsThatFit = (y: number) => Math.max(0, Math.floor((BODY_BOTTOM - y) / ROW_H));



// ── Lámina 1: mapas + demografía ─────────────────────────────────────────────
const addTerritorySlide = (
  pptx: PptxGenJS,
  report: IsochroneReport,
  images?: MapCaptureImages | null,
) => {
  const slide = pptx.addSlide();
  const band = report.bands[report.bands.length - 1];
  const name = baseName(report.iso.name ?? "Isócrona");

  addHeader(slide, "Análisis territorial", `${name} – Isócrona ${report.iso.minutes.join("/")}min`);

  // Columna izquierda angosta para los datos; el resto, la grilla de mapas.
  const DATA_W = 3.1;
  const GRID_X = ML + DATA_W + 0.26;
  const GRID_W = W - ML - GRID_X;

  // ── Datos demográficos ─────────────────────────────────────────────────────
  let y = BODY_TOP;
  const resumen: Array<[string, string]> = [
    ["Personas", fmt(band.totals.pop)],
    ["Hogares", fmt(band.totals.hh)],
    ["Ingreso prom./hogar", fmtCLP(band.totals.incomeAvgPerHh)],
    ["Área", `${band.area_km2.toFixed(2)} km²`],
    ["Densidad", `${fmt(band.density.popPerKm2)} hab/km²`],
  ];
  addTableBand(slide, "DEMOGRAFÍA DEL ÁREA", ML, y, DATA_W);
  y += 0.2;
  slide.addTable(
    resumen.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
    { x: ML, y, w: DATA_W, colW: [DATA_W * 0.56, DATA_W * 0.44], rowH: ROW_H,
      border: { type: "solid", color: C.grid, pt: 0.5 } },
  );
  y += resumen.length * ROW_H + 0.2;

  const gseRows = band.nseDistribution.filter((n) => n.pct > 0);
  if (gseRows.length > 0) {
    addTableBand(slide, "COMPOSICIÓN GSE (% HOGARES)", ML, y, DATA_W);
    y += 0.2;
    slide.addTable(
      gseRows.map((n, i) => row([n.label, `${n.pct}%`], { fill: i % 2 ? C.rowAlt : undefined })),
      { x: ML, y, w: DATA_W, colW: [DATA_W * 0.6, DATA_W * 0.4], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
    y += gseRows.length * ROW_H + 0.2;
  }

  // Igual que con los comparables: si alguna comuna no cabe, se dice.
  const comunasTotal = band.communes.length;
  const comunasFit = Math.min(comunasTotal, rowsThatFit(y + 0.2));
  if (comunasFit > 0) {
    addTableBand(slide, "COMUNAS", ML, y, DATA_W);
    y += 0.2;
    slide.addTable(
      band.communes.slice(0, comunasFit).map((c, i) =>
        row([c.name, `${(c.areaShareInIso * 100).toFixed(0)}%`, fmt(c.popInIso)], {
          fill: i % 2 ? C.rowAlt : undefined,
        }),
      ),
      { x: ML, y, w: DATA_W, colW: [DATA_W * 0.46, DATA_W * 0.2, DATA_W * 0.34], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
    y += comunasFit * ROW_H;
    if (comunasFit < comunasTotal) {
      slide.addText(`+${comunasTotal - comunasFit} comuna(s) no listada(s) por espacio`, {
        x: ML, y: y + 0.02, w: DATA_W, h: 0.16,
        fontFace: FONT, fontSize: 6.5, color: C.muted, margin: 0,
      });
    }
  }

  // ── Grilla 2×2 de mapas, cada uno con su título ────────────────────────────
  const mapas: Array<[string, string | null]> = [
    ["Isócrona", images?.isoOnly ?? null],
    ["GSE por manzana", images?.gse ?? null],
    ["Gasto endógeno", images?.gasto ?? null],
    ["Atractores comerciales", images?.atractores ?? null],
  ];
  const CAP_H = 0.17;
  const GAP = 0.12;
  const cellW = (GRID_W - GAP) / 2;
  const cellH = (BODY_BOTTOM - BODY_TOP - GAP) / 2;
  const imgH = cellH - CAP_H;

  mapas.forEach(([titulo, data], i) => {
    const cx = GRID_X + (i % 2) * (cellW + GAP);
    const cy = BODY_TOP + Math.floor(i / 2) * (cellH + GAP);
    slide.addText(titulo, {
      x: cx, y: cy, w: cellW, h: CAP_H,
      fontFace: FONT, fontSize: 7.5, bold: true, color: C.crimson, margin: 0,
    });
    if (data) {
      slide.addImage({
        data, x: cx, y: cy + CAP_H, w: cellW, h: imgH,
        sizing: { type: "cover", w: cellW, h: imgH },
      });
    } else {
      // Sin foto, se deja el marco: así se nota que falta y no queda un hueco.
      slide.addShape("rect", {
        x: cx, y: cy + CAP_H, w: cellW, h: imgH,
        fill: { color: C.rowAlt }, line: { color: C.grid },
      });
      slide.addText("Sin captura", {
        x: cx, y: cy + CAP_H + imgH / 2 - 0.1, w: cellW, h: 0.2,
        fontFace: FONT, fontSize: 7, color: C.muted, align: "center", margin: 0,
      });
    }
  });
};

// ── Lámina 2: proyección de venta ────────────────────────────────────────────
const addProjectionSlide = (
  pptx: PptxGenJS,
  report: IsochroneReport,
  proj: ReportProjection,
) => {
  const slide = pptx.addSlide();
  const name = baseName(report.iso.name ?? "Isócrona");
  addHeader(
    slide,
    "Potencial económico y proyección",
    `${name} – Iso.${report.iso.minutes.join("/")}min → ${proj.folderName}${proj.isExpress ? " EXPRESS" : ""}`,
  );

  // ── Columna izquierda: economía del área ───────────────────────────────────
  let y = BODY_TOP;
  const ge = report.gastoEndogeno;
  if (ge && ge.totalHogaresObjetivo > 0) {
    addTableBand(slide, "GASTO POTENCIAL DEL ÁREA (MERCADO OBJETIVO)", ML, y);
    y += 0.2;
    const resumenGe: Array<[string, string]> = [
      ["Gasto objetivo total / mes", fmtCLP(ge.gastoMensualObjetivo)],
      ["Hogares del mercado objetivo", fmt(ge.totalHogaresObjetivo)],
      ["Gasto promedio por hogar / mes", fmtCLP(ge.gastoPromPorHogar)],
    ];
    slide.addTable(
      resumenGe.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
      { x: ML, y, w: COL_W, colW: [COL_W * 0.58, COL_W * 0.42], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
    y += resumenGe.length * ROW_H + 0.14;

    // Solo el mercado objetivo: E queda fuera por definición (coeficiente 0),
    // y listarlo con $0 dentro de una tabla titulada "mercado objetivo"
    // confunde además de gastar una fila.
    const geRows = ge.rows.filter((r) => r.esObjetivo && r.hogares > 0);
    if (geRows.length > 0) {
      slide.addTable(
        [
          headerRow(["GSE", "Hogares", "Gasto / mes"]),
          ...geRows.map((r, i) =>
            row([r.gse, fmt(r.hogares), fmtCLP(r.gastoMensual)], {
              fill: i % 2 ? C.rowAlt : undefined,
            }),
          ),
        ],
        { x: ML, y, w: COL_W, colW: [COL_W * 0.24, COL_W * 0.3, COL_W * 0.46], rowH: ROW_H,
          border: { type: "solid", color: C.grid, pt: 0.5 } },
      );
      y += (geRows.length + 1) * ROW_H + 0.16;
    }
  }

  const pq = report.parqueStats;
  if (pq && pq.vehiculos > 0 && rowsThatFit(y + 0.2) > 3) {
    addTableBand(slide, "PARQUE VEHICULAR EN EL ÁREA", ML, y);
    y += 0.2;
    const pqRows: Array<[string, string]> = [
      ["Vehículos estimados", fmt(pq.vehiculos)],
      ["Edad media del parque", `${pq.edad_media.toFixed(1)} años`],
      ["Rango intercuartil", `${pq.edad_p25.toFixed(0)}–${pq.edad_p75.toFixed(0)} años`],
    ];
    slide.addTable(
      pqRows.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
      { x: ML, y, w: COL_W, colW: [COL_W * 0.58, COL_W * 0.42], rowH: ROW_H,
        border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
    y += pqRows.length * ROW_H + 0.12;

    // Las marcas dominantes del área son más accionables para una tienda
    // automotriz que la edad media, así que van si queda espacio.
    const marcas = pq.ranking_marcas.slice(0, 5);
    const marcasFit = Math.min(marcas.length, rowsThatFit(y) - 1);
    if (marcasFit > 0) {
      slide.addTable(
        [
          headerRow(["Marca", "Vehículos", "% del parque"]),
          ...marcas.slice(0, marcasFit).map((m, i) =>
            row([m.marca, fmt(m.count), `${m.pct.toFixed(1)}%`], {
              fill: i % 2 ? C.rowAlt : undefined,
            }),
          ),
        ],
        { x: ML, y, w: COL_W, colW: [COL_W * 0.42, COL_W * 0.28, COL_W * 0.3], rowH: ROW_H,
          border: { type: "solid", color: C.grid, pt: 0.5 } },
      );
      y += (marcasFit + 1) * ROW_H + 0.16;
    }
  }

  // ── Columna derecha: proyección ────────────────────────────────────────────
  let ry = BODY_TOP;
  slide.addText("Potencial estimado", {
    x: COL_R_X, y: ry, w: COL_W, h: 0.2,
    fontFace: FONT, fontSize: 11, bold: true, color: C.ink, margin: 0,
  });
  ry += 0.2;
  slide.addText(`${fmt(proj.estimatedUf)} UF/mes`, {
    x: COL_R_X, y: ry, w: COL_W, h: 0.34,
    fontFace: FONT, fontSize: 22, bold: true, color: C.crimson, margin: 0,
  });
  ry += 0.34;
  slide.addText(
    `${fmtCLP(proj.estimatedClp)}/mes · en régimen · rango ${fmt(proj.lowUf)}–${fmt(proj.highUf)} UF`,
    { x: COL_R_X, y: ry, w: COL_W, h: 0.16, fontFace: FONT, fontSize: 7, color: C.muted, margin: 0 },
  );
  ry += 0.2;

  const apertura = proj.years.find((r) => r.isBase);
  const supuestos: Array<[string, string]> = [
    ...(proj.rampEnabled && apertura
      ? ([["Venta al abrir", `${fmt(apertura.uf)} UF/mes (${Math.round(apertura.maturityPct)}% del régimen)`]] as Array<[string, string]>)
      : []),
    ["Maduración", proj.rampEnabled ? "Ubicación nueva, parte en rampa" : "Ubicación ya en régimen"],
    [
      proj.isExpress ? "Ajuste EXPRESS" : "Ajuste manual del analista",
      proj.adjustPct !== 0 ? `${proj.adjustPct > 0 ? "+" : ""}${proj.adjustPct}%` : "Sin ajuste",
    ],
    ["Base de cálculo", `${proj.comparables.length} locales comparables`],
  ];
  addTableBand(slide, "SUPUESTOS", COL_R_X, ry);
  ry += 0.2;
  slide.addTable(
    supuestos.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
    { x: COL_R_X, y: ry, w: COL_W, colW: [COL_W * 0.42, COL_W * 0.58], rowH: ROW_H,
      border: { type: "solid", color: C.grid, pt: 0.5 } },
  );
  ry += supuestos.length * ROW_H + 0.1;

  // Van TODOS: que la tabla muestre menos de los declarados arriba es
  // exactamente la contradicción que hay que evitar.
  if (proj.comparables.length > 0) {
    addTableBand(slide, "LOCALES COMPARABLES", COL_R_X, ry);
    ry += 0.2;
    slide.addTable(
      [
        headerRow(["Local", "UF/mes", "Fuente"]),
        ...proj.comparables.map((c, i) =>
          row([c.name, fmt(c.ufPerMonth), c.isActual ? "Venta real" : "Predicción"], {
            fill: i % 2 ? C.rowAlt : undefined,
          }),
        ),
      ],
      { x: COL_R_X, y: ry, w: COL_W, colW: [COL_W * 0.54, COL_W * 0.22, COL_W * 0.24],
        rowH: ROW_H, border: { type: "solid", color: C.grid, pt: 0.5 } },
    );
    ry += (proj.comparables.length + 1) * ROW_H + 0.1;
  }

  addTableBand(slide, "PROYECCIÓN AÑO A AÑO", COL_R_X, ry);
  ry += 0.2;
  slide.addTable(
    [
      headerRow(["Año", "Crecimiento", "% régimen", "UF/mes", "CLP/mes"]),
      ...proj.years.map((r, i) =>
        row(
          [
            r.label,
            r.isBase ? "—" : `${r.ratePct > 0 ? "+" : ""}${r.ratePct}%`,
            `${Math.round(r.maturityPct)}%`,
            fmt(r.uf),
            fmtCLP(r.clp),
          ],
          r.isBase ? { fill: C.hilite, bold: true } : { fill: i % 2 ? C.rowAlt : undefined },
        ),
      ),
    ],
    { x: COL_R_X, y: ry, w: COL_W,
      colW: [COL_W * 0.2, COL_W * 0.22, COL_W * 0.18, COL_W * 0.18, COL_W * 0.22],
      rowH: ROW_H, border: { type: "solid", color: C.grid, pt: 0.5 } },
  );

  // Notas al pie a lo ancho de la lámina: en una sola columna se comían el
  // espacio que necesita la tabla de comparables.
  const notas = [
    proj.rampEnabled
      ? "El potencial estimado corresponde al nivel en régimen. Un local recién abierto no rinde eso desde el primer día: la curva parte en la fracción medida en la red y sube hasta el 100%."
      : "Se asume la ubicación ya en régimen desde el primer año.",
    proj.adjustPct !== 0 && proj.isExpress
      ? `Incluye el ajuste EXPRESS de ${proj.adjustPct}%: el formato vende menos que un local estándar y la superficie aún no es una variable del modelo.`
      : proj.adjustPct !== 0
        ? `Incluye un ajuste manual de ${proj.adjustPct > 0 ? "+" : ""}${proj.adjustPct}% aplicado por el analista, no derivado del modelo.`
        : "Estimación referencial construida por comparación con locales de la red; no reemplaza un estudio de terreno.",
  ];
  slide.addText(notas.map((n) => ({ text: n, options: { breakLine: true } })), {
    // Bajo el pie de las tablas: la de años llega hasta BODY_BOTTOM.
    x: ML, y: BODY_BOTTOM + 0.02, w: W - ML * 2, h: 0.28,
    fontFace: FONT, fontSize: 6.5, color: C.muted, valign: "top", margin: 0,
    lineSpacingMultiple: 1.15,
  });
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
