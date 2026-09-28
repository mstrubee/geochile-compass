import { formatAdjustmentLabel, type IsochroneReport, type ReportProjection } from "./reportData";
import type { MapCaptureImages } from "./mapCapture";
import { fitContain, pngSize } from "./imageSize";
import { ventaMM, VENTA_MM_LABEL } from "./formatVenta";
import type { Cell, SlideSurface } from "./slideSurface";
import { PptxSlideSurface } from "./slideSurfacePptx";

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
export const SLIDE_W = 10;
export const SLIDE_H = 5.625;
const W = SLIDE_W;
const H = SLIDE_H;
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
/** Millones de pesos, que es la unidad en que se lee la plata en el informe. */
const fmtMM = (n: number) => `$${(n / 1_000_000).toFixed(1)}MM`;

/** Tipografía compartida de las tablas: densa pero legible al proyectar. */
const cellBase = {
  fontSize: 7.5,
  color: C.ink,
  valign: "middle" as const,
  // Sin achicar el relleno, la fila rinde ~0,22" en vez de ROW_H y las
  // bandas siguientes se superponen.
  margin: [1, 3, 1, 3] as [number, number, number, number],
};

const headerRow = (labels: string[]): Cell[] =>
  labels.map((text, i) => ({
    text,
    options: {
      ...cellBase,
      bold: true,
      color: C.white,
      fill: C.crimson,
      align: (i === 0 ? "left" : "right") as "left" | "right",
    },
  }));

interface RowOpts {
  bold?: boolean;
  fill?: string;
  /** Fila destacada en carmesí con texto blanco (totales). */
  accent?: boolean;
}

const row = (cells: Array<string | number>, opts: RowOpts = {}): Cell[] =>
  cells.map((c, i) => ({
    text: String(c),
    options: {
      ...cellBase,
      bold: opts.bold || opts.accent,
      color: opts.accent ? C.white : C.ink,
      fill: opts.accent ? C.crimson : opts.fill,
      align: (i === 0 ? "left" : "right") as "left" | "right",
    },
  }));

/** Encabezado común: cintillo de sección, título y línea divisoria. */
const addHeader = (s: SlideSurface, eyebrow: string, title: string) => {
  s.text(eyebrow.toUpperCase(), {
    x: ML, y: 0.22, w: W - ML * 2, h: 0.28,
    fontSize: 14, bold: true, color: C.crimson,
  });
  s.text(title, {
    x: ML, y: 0.52, w: W - ML * 2, h: 0.38,
    fontSize: 16, bold: true, color: C.ink,
  });
  s.line({ x: ML, y: 1.0, w: W - ML * 2, color: C.grid, width: 1 });
};

const addColTitle = (s: SlideSurface, text: string, x: number, y: number) => {
  s.text(text, { x, y, w: COL_W, h: 0.24, fontSize: 11, bold: true, color: C.ink });
};

/** Banda carmesí que titula una tabla, como el "Resumen Ejecutivo" del modelo. */
const addTableBand = (
  s: SlideSurface, text: string, x: number, y: number, w: number = COL_W,
) => {
  s.rect({ x, y, w, h: 0.2, fill: C.crimson, line: { color: C.crimson } });
  s.text(text, {
    x: x + 0.06, y, w: w - 0.12, h: 0.2,
    fontSize: 8, bold: true, color: C.white, valign: "middle",
  });
};

const ROW_H = 0.155;

/** Alto disponible desde `y` hasta el pie de la lámina, en filas. */
const rowsThatFit = (y: number) => Math.max(0, Math.floor((BODY_BOTTOM - y) / ROW_H));



// ── Lámina 1: mapas + demografía ─────────────────────────────────────────────
export const drawTerritorySlide = (
  slide: SlideSurface,
  report: IsochroneReport,
  images?: MapCaptureImages | null,
) => {
  const band = report.bands[report.bands.length - 1];
  const name = baseName(report.iso.name ?? "Isócrona");
  const zonas = report.zonasAledanas ?? [];

  addHeader(
    slide,
    "Análisis territorial",
    `${name} – Isócrona ${report.iso.minutes.join("/")}min` +
      (zonas.length > 0 ? ` + ${zonas.length} zona${zonas.length === 1 ? "" : "s"} aledaña${zonas.length === 1 ? "" : "s"}` : ""),
  );

  // Columna izquierda para los datos; el resto, la grilla de mapas. Con fotos
  // cuadradas la grilla ocupa menos ancho que cuando eran apaisadas, así que
  // ese ancho se le da a las tablas en vez de dejarlo en blanco.
  const DATA_W = 4.2;
  /** Aire entre tablas de la columna de datos. */
  const GAP_TABLA = 0.14;
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
  slide.table(
    resumen.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
    { x: ML, y, w: DATA_W, colW: [DATA_W * 0.56, DATA_W * 0.44], rowH: ROW_H,
      border: { color: C.grid, pt: 0.5 } },
  );
  y += resumen.length * ROW_H + GAP_TABLA;

  // Zonas aledañas: isócronas fusionadas como hijas. La demografía de arriba
  // YA las incluye (se analizó la unión) — esto solo identifica cuáles son.
  // Va en una línea y no en una tabla: el alto de la columna lo necesitan los
  // locales de la red, y el nombre de la zona se lee igual.
  if (zonas.length > 0) {
    slide.text(`Zonas aledañas sumadas: ${zonas.map((z) => z.name).join(" · ")}`, {
      x: ML, y, w: DATA_W, h: 0.16, fontSize: 7, color: C.muted,
    });
    y += 0.2;
  }

  const gseRows = band.nseDistribution.filter((n) => n.pct > 0);
  if (gseRows.length > 0) {
    addTableBand(slide, "COMPOSICIÓN GSE (% HOGARES)", ML, y, DATA_W);
    y += 0.2;
    // Dos clases por fila: las seis en una lista vertical se comían el alto
    // que necesitan las comunas y los locales de la red. Se leen igual.
    const pares: Cell[][] = [];
    for (let i = 0; i < gseRows.length; i += 2) {
      const izq = gseRows[i];
      const der = gseRows[i + 1];
      const celda = (text: string, align: "left" | "right", fill?: string): Cell => ({
        text,
        options: { ...cellBase, align, fill },
      });
      const fondo = (i / 2) % 2 ? C.rowAlt : undefined;
      pares.push([
        celda(izq.label, "left", fondo),
        celda(`${izq.pct}%`, "right", fondo),
        celda(der?.label ?? "", "left", fondo),
        celda(der ? `${der.pct}%` : "", "right", fondo),
      ]);
    }
    slide.table(pares, {
      x: ML, y, w: DATA_W,
      colW: [DATA_W * 0.3, DATA_W * 0.2, DATA_W * 0.3, DATA_W * 0.2],
      rowH: ROW_H,
      border: { color: C.grid, pt: 0.5 },
    });
    y += pares.length * ROW_H + GAP_TABLA;
  }

  // Comunas del ÁREA TOTAL analizada: con zonas aledañas fusionadas, lo que
  // se midió es la unión, así que cada fila reparte esa área y no la de una
  // isócrona suelta. Encabezado y fila de total para que el lector no tenga
  // que deducir qué significa cada columna.
  const comunasTotal = band.communes.length;
  // Los locales de la red se reservan primero: son el dato que decide si la
  // ubicación canibaliza la red propia, y sin reserva la tabla de comunas se
  // queda con todo el alto y ya no caben.
  const cercanos = report.nearbyStores ?? [];
  const localesFilas = Math.min(cercanos.length, 3);
  // banda + encabezado + filas + la nota al pie (unidad de venta / recortes).
  const localesReserva = localesFilas > 0
    ? Math.ceil((GAP_TABLA + 0.2) / ROW_H) + 1 + localesFilas + 1
    : 0;
  // Dos filas del presupuesto se van en el encabezado y el total. Si solo
  // alcanza para esas dos, la tabla igual se imprime: el total es justamente
  // lo que no puede faltar.
  const presupuesto = rowsThatFit(y + 0.2) - localesReserva;
  // Si se recorta, la nota de "+N no listadas" también ocupa su línea: sin
  // contarla, el aviso terminaba por debajo del borde del cuerpo.
  const cabeComplet = comunasTotal <= presupuesto - 2;
  const comunasFit = Math.min(
    comunasTotal,
    Math.max(0, presupuesto - (cabeComplet ? 2 : 3)),
  );
  if (comunasTotal > 0 && presupuesto >= 2) {
    const popComuna = (c: (typeof band.communes)[number]) => c.popMeasured ?? c.popInIso;
    const visibles = band.communes.slice(0, comunasFit);
    const sumaShare = band.communes.reduce((s, c) => s + c.areaShareInIso, 0);
    const sumaPop = band.communes.reduce((s, c) => s + popComuna(c), 0);

    addTableBand(
      slide,
      zonas.length > 0 ? "COMUNAS (ÁREA TOTAL FUSIONADA)" : "COMUNAS",
      ML, y, DATA_W,
    );
    y += 0.2;
    slide.table(
      [
        headerRow(["Comuna", "% área", "Personas"]),
        ...visibles.map((c, i) =>
          row([c.name, `${(c.areaShareInIso * 100).toFixed(0)}%`, fmt(popComuna(c))], {
            fill: i % 2 ? C.rowAlt : undefined,
          }),
        ),
        // El total es el de TODAS las comunas, también las que no caben.
        row(["Total", `${(sumaShare * 100).toFixed(0)}%`, fmt(sumaPop)], { accent: true }),
      ],
      { x: ML, y, w: DATA_W, colW: [DATA_W * 0.46, DATA_W * 0.2, DATA_W * 0.34], rowH: ROW_H,
        border: { color: C.grid, pt: 0.5 } },
    );
    y += (visibles.length + 2) * ROW_H;
    if (comunasFit < comunasTotal) {
      slide.text(
        `+${comunasTotal - comunasFit} comuna(s) no listada(s) por espacio, incluidas en el total`,
        { x: ML, y: y + 0.02, w: DATA_W, h: 0.16, fontSize: 6.5, color: C.muted },
      );
      y += 0.16;
    }
    y += GAP_TABLA;
  }

  // ── Locales de la red en el entorno ────────────────────────────────────────
  // A pocos minutos, un local propio deja de ser contexto y pasa a ser
  // canibalización sobre la venta que se proyecta en la lámina siguiente.
  if (cercanos.length > 0) {
    const disponibles = rowsThatFit(y + 0.2);
    // encabezado + nota al pie, siempre; una fila más si hay que avisar recorte.
    const cabenTodos = cercanos.length <= disponibles - 2;
    const caben = Math.min(
      cercanos.length,
      Math.max(0, disponibles - (cabenTodos ? 2 : 3)),
    );
    if (caben > 0) {
      addTableBand(slide, "LOCALES DE LA RED EN EL ENTORNO", ML, y, DATA_W);
      y += 0.2;
      slide.table(
        [
          headerRow(["Local", "Dist.", "Tiempo", VENTA_MM_LABEL]),
          ...cercanos.slice(0, caben).map((s, i) =>
            row(
              [
                s.name,
                `${s.km.toFixed(1)} km`,
                `${s.minutes} min`,
                ventaMM(s.sales?.avgClp),
              ],
              { fill: i % 2 ? C.rowAlt : undefined },
            ),
          ),
        ],
        { x: ML, y, w: DATA_W,
          colW: [DATA_W * 0.4, DATA_W * 0.2, DATA_W * 0.2, DATA_W * 0.2], rowH: ROW_H,
          border: { color: C.grid, pt: 0.5 } },
      );
      y += (caben + 1) * ROW_H;
      const conVenta = cercanos.slice(0, caben).filter((s) => s.sales?.avgClp);
      const notas: string[] = [];
      if (conVenta.length > 0) {
        const meses = Math.max(...conVenta.map((s) => s.sales!.months));
        const hasta = conVenta
          .map((s) => s.sales!.lastPeriod)
          .sort()
          .at(-1);
        notas.push(
          `${VENTA_MM_LABEL}: millones de pesos, promedio de los últimos ${meses} meses con venta (hasta ${hasta})`,
        );
      }
      if (caben < cercanos.length) {
        notas.push(`+${cercanos.length - caben} local(es) no listado(s) por espacio`);
      }
      if (notas.length > 0) {
        slide.text(notas.join(" · "), {
          x: ML, y: y + 0.02, w: DATA_W, h: 0.16, fontSize: 6.5, color: C.muted,
        });
      }
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
  const maxW = (GRID_W - GAP) / 2;
  const maxH = (BODY_BOTTOM - BODY_TOP - GAP) / 2 - CAP_H;

  // La celda se ajusta a la proporción de las fotos en vez de al revés. El
  // contenedor del mapa cambia de forma con el ancho del panel y de la
  // ventana, así que un recuadro fijo o deformaba el mapa o dejaba franjas
  // vacías. Con esto la grilla queda pareja y centrada, sin estirar nada.
  const medida = mapas.map(([, d]) => pngSize(d)).find((s) => s) ?? null;
  const proporcion = medida ? medida.w / medida.h : maxW / maxH;
  const imgW = Math.min(maxW, maxH * proporcion);
  const imgH = imgW / proporcion;
  const cellW = imgW;
  const cellH = imgH + CAP_H;
  const gridX = GRID_X + (GRID_W - (2 * cellW + GAP)) / 2;
  const gridY = BODY_TOP + (BODY_BOTTOM - BODY_TOP - (2 * cellH + GAP)) / 2;

  mapas.forEach(([titulo, data], i) => {
    const cx = gridX + (i % 2) * (cellW + GAP);
    const cy = gridY + Math.floor(i / 2) * (cellH + GAP);
    slide.text(titulo, {
      x: cx, y: cy, w: cellW, h: CAP_H,
      fontSize: 7.5, bold: true, color: C.crimson,
    });
    if (data) {
      // La foto conserva su proporción: el recuadro de la grilla no tiene la
      // misma que el contenedor del mapa —que además cambia con el ancho del
      // panel— y estirarla para llenarlo deformaba el mapa.
      slide.image({
        data,
        ...fitContain({ x: cx, y: cy + CAP_H, w: cellW, h: imgH }, pngSize(data)),
      });
    } else {
      // Sin foto, se deja el marco: así se nota que falta y no queda un hueco.
      slide.rect({
        x: cx, y: cy + CAP_H, w: cellW, h: imgH,
        fill: C.rowAlt, line: { color: C.grid },
      });
      slide.text("Sin captura", {
        x: cx, y: cy + CAP_H + imgH / 2 - 0.1, w: cellW, h: 0.2,
        fontSize: 7, color: C.muted, align: "center",
      });
    }
  });
};

// ── Lámina 2: proyección de venta ────────────────────────────────────────────
export const drawProjectionSlide = (
  slide: SlideSurface,
  report: IsochroneReport,
  proj: ReportProjection,
) => {
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
    slide.table(
      resumenGe.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
      { x: ML, y, w: COL_W, colW: [COL_W * 0.58, COL_W * 0.42], rowH: ROW_H,
        border: { color: C.grid, pt: 0.5 } },
    );
    y += resumenGe.length * ROW_H + 0.14;

    // Solo el mercado objetivo: E queda fuera por definición (coeficiente 0),
    // y listarlo con $0 dentro de una tabla titulada "mercado objetivo"
    // confunde además de gastar una fila.
    const geRows = ge.rows.filter((r) => r.esObjetivo && r.hogares > 0);
    if (geRows.length > 0) {
      slide.table(
        [
          headerRow(["GSE", "Hogares", "Gasto / mes"]),
          ...geRows.map((r, i) =>
            row([r.gse, fmt(r.hogares), fmtCLP(r.gastoMensual)], {
              fill: i % 2 ? C.rowAlt : undefined,
            }),
          ),
        ],
        { x: ML, y, w: COL_W, colW: [COL_W * 0.24, COL_W * 0.3, COL_W * 0.46], rowH: ROW_H,
          border: { color: C.grid, pt: 0.5 } },
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
    slide.table(
      pqRows.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
      { x: ML, y, w: COL_W, colW: [COL_W * 0.58, COL_W * 0.42], rowH: ROW_H,
        border: { color: C.grid, pt: 0.5 } },
    );
    y += pqRows.length * ROW_H + 0.12;

    // Las marcas dominantes del área son más accionables para una tienda
    // automotriz que la edad media, así que van si queda espacio.
    const marcas = pq.ranking_marcas.slice(0, 5);
    const marcasFit = Math.min(marcas.length, rowsThatFit(y) - 1);
    if (marcasFit > 0) {
      slide.table(
        [
          headerRow(["Marca", "Vehículos", "% del parque"]),
          ...marcas.slice(0, marcasFit).map((m, i) =>
            row([m.marca, fmt(m.count), `${m.pct.toFixed(1)}%`], {
              fill: i % 2 ? C.rowAlt : undefined,
            }),
          ),
        ],
        { x: ML, y, w: COL_W, colW: [COL_W * 0.42, COL_W * 0.28, COL_W * 0.3], rowH: ROW_H,
          border: { color: C.grid, pt: 0.5 } },
      );
      y += (marcasFit + 1) * ROW_H + 0.16;
    }
  }

  // ── Columna derecha: proyección ────────────────────────────────────────────
  let ry = BODY_TOP;
  slide.text("Potencial estimado", {
    x: COL_R_X, y: ry, w: COL_W, h: 0.2,
    fontSize: 11, bold: true, color: C.ink,
  });
  ry += 0.2;
  slide.text(`${fmt(proj.estimatedUf)} UF/mes`, {
    x: COL_R_X, y: ry, w: COL_W, h: 0.34,
    fontSize: 22, bold: true, color: C.crimson,
  });
  ry += 0.34;
  slide.text(
    `${fmtCLP(proj.estimatedClp)}/mes · en régimen · rango ${fmt(proj.lowUf)}–${fmt(proj.highUf)} UF`,
    { x: COL_R_X, y: ry, w: COL_W, h: 0.16, fontSize: 7, color: C.muted },
  );
  ry += 0.2;

  const apertura = proj.years.find((r) => r.isBase);
  const supuestos: Array<[string, string]> = [
    ...(proj.rampEnabled && apertura
      ? ([["Venta al abrir", `${fmt(apertura.uf)} UF/mes (${Math.round(apertura.maturityPct)}% del régimen)`]] as Array<[string, string]>)
      : []),
    ["Maduración", proj.rampEnabled ? "Ubicación nueva, parte en rampa" : "Ubicación ya en régimen"],
    [
      "Ajuste",
      formatAdjustmentLabel(proj.isExpress, proj.expressAppliedPct, proj.exogenoPct) ?? "Sin ajuste",
    ],
    ["Base de cálculo", `${proj.comparables.length} locales comparables`],
  ];
  addTableBand(slide, "SUPUESTOS", COL_R_X, ry);
  ry += 0.2;
  slide.table(
    supuestos.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
    { x: COL_R_X, y: ry, w: COL_W, colW: [COL_W * 0.42, COL_W * 0.58], rowH: ROW_H,
      border: { color: C.grid, pt: 0.5 } },
  );
  ry += supuestos.length * ROW_H + 0.1;

  // Van TODOS: que la tabla muestre menos de los declarados arriba es
  // exactamente la contradicción que hay que evitar.
  if (proj.comparables.length > 0) {
    addTableBand(slide, "LOCALES COMPARABLES", COL_R_X, ry);
    ry += 0.2;
    slide.table(
      [
        headerRow(["Local", "UF/mes", "Fuente"]),
        ...proj.comparables.map((c, i) =>
          row([c.name, fmt(c.ufPerMonth), c.isActual ? "Venta real" : "Predicción"], {
            fill: i % 2 ? C.rowAlt : undefined,
          }),
        ),
      ],
      { x: COL_R_X, y: ry, w: COL_W, colW: [COL_W * 0.54, COL_W * 0.22, COL_W * 0.24],
        rowH: ROW_H, border: { color: C.grid, pt: 0.5 } },
    );
    ry += (proj.comparables.length + 1) * ROW_H + 0.1;
  }

  // Canibalización: va antes de la proyección año a año porque explica por qué
  // la cifra proyectada es menor que el potencial bruto del área.
  const canni = proj.cannibalization;
  if (canni && canni.overlapCount > 0) {
    addTableBand(slide, "CANIBALIZACIÓN CON LA RED", COL_R_X, ry);
    ry += 0.2;
    const canniRows: Array<[string, string]> = [
      ["Locales propios con solape", String(canni.overlapCount)],
      ["Población solapada", `${fmt(canni.overlapPop)} (${canni.popPct.toFixed(0)}%)`],
      ["Área solapada", `${canni.overlapAreaKm2.toFixed(2)} km² (${canni.areaPct.toFixed(0)}%)`],
      ["Parque solapado", `${fmt(canni.overlapVehiculos)} (${canni.vehiculosPct.toFixed(0)}%)`],
      ["Venta canibalizada", `${fmt(canni.lostUf)} UF/mes · ${fmtMM(canni.lostClp)}`],
    ];
    slide.table(
      canniRows.map(([k, v], i) => row([k, v], { fill: i % 2 ? C.rowAlt : undefined })),
      { x: COL_R_X, y: ry, w: COL_W, colW: [COL_W * 0.46, COL_W * 0.54], rowH: ROW_H,
        border: { color: C.grid, pt: 0.5 } },
    );
    ry += canniRows.length * ROW_H + 0.12;
  }

  addTableBand(slide, "PROYECCIÓN AÑO A AÑO", COL_R_X, ry);
  ry += 0.2;
  slide.table(
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
      rowH: ROW_H, border: { color: C.grid, pt: 0.5 } },
  );

  // Notas al pie a lo ancho de la lámina: en una sola columna se comían el
  // espacio que necesita la tabla de comparables.
  const notas = [
    canni && canni.overlapCount > 0
      ? `Canibalización medida sobre la intersección de isócronas con ${canni.overlapCount} local${canni.overlapCount === 1 ? "" : "es"} propio${canni.overlapCount === 1 ? "" : "s"}. El % rector es de POBLACIÓN solapada; área y parque van como contexto. El castigo aplicado es relativo al solape promedio de los comparables, no absoluto: sus ventas ya reflejan la canibalización que ellos sufren.${canni.incomplete ? " Cifra parcial: falta la isócrona guardada de algún local cercano." : ""}`
      : null,
    proj.rampEnabled
      ? "El potencial estimado corresponde al nivel en régimen. Un local recién abierto no rinde eso desde el primer día: la curva parte en la fracción medida en la red y sube hasta el 100%."
      : "Se asume la ubicación ya en régimen desde el primer año.",
    proj.isExpress
      ? `Incluye el castigo fijo de formato EXPRESS (${proj.expressAppliedPct}%)${proj.exogenoPct !== 0 ? ` más un ajuste Exógeno de ${proj.exogenoPct > 0 ? "+" : ""}${proj.exogenoPct}%` : ""} aplicado por el analista, no derivado del modelo.`
      : proj.exogenoPct !== 0
        ? `Incluye un ajuste Exógeno de ${proj.exogenoPct > 0 ? "+" : ""}${proj.exogenoPct}% aplicado por el analista, no derivado del modelo.`
        : "Estimación referencial construida por comparación con locales de la red; no reemplaza un estudio de terreno.",
  ].filter((n): n is string => n != null);
  slide.text(notas.map((n) => ({ text: n, breakLine: true })), {
    // Bajo el pie de las tablas: la de años llega hasta BODY_BOTTOM.
    x: ML, y: BODY_BOTTOM + 0.02, w: W - ML * 2, h: 0.28,
    fontSize: 6.5, color: C.muted, valign: "top",
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

  drawTerritorySlide(new PptxSlideSurface(pptx.addSlide()), report, images);
  if (projection) {
    drawProjectionSlide(new PptxSlideSurface(pptx.addSlide()), report, projection);
  }

  const fecha = new Date(report.generatedAt).toISOString().slice(0, 10).replace(/-/g, "");
  const base = (report.iso.name ?? "isocrona").replace(/[^\w-]+/g, "_");
  await pptx.writeFile({ fileName: `informe-${base}-${fecha}.pptx` });
};
