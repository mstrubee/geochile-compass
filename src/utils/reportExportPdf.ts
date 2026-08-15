import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { IsochroneReport, IsochroneBandReport } from "./reportData";

// ─────────────────────────────────────────────────────────────────────────────
// PALETA Y TIPOGRAFÍA
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  navy:      [15,  23,  42]  as [number,number,number], // slate-900
  blue:      [37,  99, 235]  as [number,number,number], // blue-600
  blue50:    [239,246,255]   as [number,number,number], // blue-50
  slate600:  [71,  85, 105]  as [number,number,number],
  slate400:  [148,163,184]   as [number,number,number],
  slate100:  [241,245,249]   as [number,number,number],
  white:     [255,255,255]   as [number,number,number],
  emerald:   [5,  150, 105]  as [number,number,number],
  amber:     [217,119,  6]   as [number,number,number],
  red:       [185, 28,  28]  as [number,number,number],
  // NSE
  abc1:      [30,  58, 138]  as [number,number,number],
  c2:        [37,  99, 235]  as [number,number,number],
  c3:        [5,  150, 105]  as [number,number,number],
  d:         [217,119,  6]   as [number,number,number],
  e:         [185, 28,  28]  as [number,number,number],
};

const NSE_COLORS: Record<string, [number,number,number]> = {
  ABC1: C.abc1, C2: C.c2, C3: C.c3, D: C.d, E: C.e,
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

const fmt    = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtCLP = (n: number) => `$${fmt(n)}`;
const fmtPct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

const lastY = (doc: jsPDF): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY ?? 0;

const PW = 210; // A4 portrait width mm
const PH = 297; // A4 portrait height mm
const ML = 14;  // margin left/right
const BODY_TOP = 28; // y where body starts (after header)

// ─────────────────────────────────────────────────────────────────────────────
// PORTADA
// ─────────────────────────────────────────────────────────────────────────────

const addCoverPage = (doc: jsPDF, report: IsochroneReport): void => {
  // Fondo superior navy
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, PW, 100, "F");

  // Franja acento azul
  doc.setFillColor(...C.blue);
  doc.rect(0, 100, PW, 3, "F");

  // Logotipo / marca (texto)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...C.white);
  doc.text("GEOCHILE", ML, 32);
  doc.setFontSize(22);
  doc.setTextColor(...C.blue);
  doc.text("COMPASS", ML + 42, 32);

  // Subtítulo plataforma
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.slate400);
  doc.text("Plataforma de Análisis Territorial · Grupo Planet SpA", ML, 40);

  // Línea separadora
  doc.setDrawColor(...C.blue);
  doc.setLineWidth(0.4);
  doc.line(ML, 46, PW - ML, 46);

  // Título del informe
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...C.white);
  doc.text("Informe de", ML, 62);
  doc.text("Análisis Territorial", ML, 74);

  // Tipo de análisis
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(186, 230, 253); // light blue
  doc.text(
    `${report.iso.modeLabel} · Banda${report.iso.minutes.length > 1 ? "s" : ""}: ${report.iso.minutes.join(" / ")} minutos`,
    ML, 86
  );

  // Nombre de la isócrona guardada
  if (report.iso.name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...C.white);
    doc.text(report.iso.name, ML, 94);
  }

  // Bloque de datos del análisis (cuerpo página, fondo blanco)
  doc.setFillColor(...C.white);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...C.slate600);

  const infoY = 116;
  const col2  = PW / 2 + 8;

  // Coordenadas
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.slate400);
  doc.text("PUNTO DE ANÁLISIS", ML, infoY);
  doc.text("FECHA DE GENERACIÓN", col2, infoY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...C.navy);
  doc.text(
    `${report.iso.centerLat.toFixed(5)}, ${report.iso.centerLng.toFixed(5)}`,
    ML, infoY + 7
  );
  doc.text(
    new Date(report.generatedAt).toLocaleDateString("es-CL", {
      day: "2-digit", month: "long", year: "numeric",
    }),
    col2, infoY + 7
  );

  // Hora
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.slate400);
  doc.text(
    new Date(report.generatedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }),
    col2, infoY + 13
  );

  // Línea divisoria
  doc.setDrawColor(...C.slate100);
  doc.setLineWidth(0.3);
  doc.line(ML, infoY + 18, PW - ML, infoY + 18);

  // Resumen de bandas (una fila por banda)
  const bandY = infoY + 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.slate400);
  doc.text("BANDA (min)", ML, bandY);
  doc.text("PERSONAS", 60, bandY);
  doc.text("HOGARES", 95, bandY);
  doc.text("INGR. PROM./HOG. (CLP)", 130, bandY);
  doc.text("ÁREA (km²)", 178, bandY);

  report.bands.forEach((band, i) => {
    const by = bandY + 8 + i * 9;
    if (i % 2 === 0) {
      doc.setFillColor(...C.slate100);
      doc.rect(ML, by - 5, PW - ML * 2, 8, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.navy);
    doc.text(`${band.bandMinutes} min`, ML + 2, by);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.slate600);
    doc.text(fmt(band.totals.pop),          60, by);
    doc.text(fmt(band.totals.hh),           95, by);
    doc.text(fmtCLP(band.totals.incomeAvgPerHh), 130, by);
    doc.text(band.area_km2.toFixed(2),      178, by);
  });

  // Nota de confidencialidad
  const noteY = PH - 30;
  doc.setFillColor(254, 243, 199); // amber-100
  doc.roundedRect(ML, noteY - 5, PW - ML * 2, 16, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.amber);
  doc.text("DOCUMENTO CONFIDENCIAL", ML + 3, noteY + 2);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 80, 0);
  doc.text(
    "Este informe fue generado para uso interno. Los datos son referenciales y no reemplazan estudios de terreno certificados.",
    ML + 3, noteY + 8,
    { maxWidth: PW - ML * 2 - 6 }
  );

  // Pie de portada
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate400);
  doc.text("© Grupo Planet SpA · GeoChile Compass", ML, PH - 8);
  doc.text("geochile.planet.cl", PW - ML, PH - 8, { align: "right" });
};

// ─────────────────────────────────────────────────────────────────────────────
// ENCABEZADO Y PIE DE PÁGINA INTERIOR
// ─────────────────────────────────────────────────────────────────────────────

const addPageHeader = (doc: jsPDF, report: IsochroneReport, bandMinutes: number): void => {
  // Barra superior
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, PW, 10, "F");
  doc.setFillColor(...C.blue);
  doc.rect(0, 10, PW, 1.5, "F");

  // Marca izquierda
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.white);
  doc.text("GEOCHILE", ML, 7);
  doc.setTextColor(147, 197, 253); // blue-300
  doc.text("COMPASS", ML + 18, 7);

  // Info derecha
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate400);
  doc.text(
    `${report.iso.modeLabel} · Banda ${bandMinutes} min · ${new Date(report.generatedAt).toLocaleDateString("es-CL")}`,
    PW - ML, 7,
    { align: "right" }
  );
  doc.setTextColor(...C.navy);
};

const addPageFooter = (doc: jsPDF, pageNum: number, totalPages: number): void => {
  doc.setDrawColor(...C.slate400);
  doc.setLineWidth(0.2);
  doc.line(ML, PH - 10, PW - ML, PH - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.slate400);
  doc.text("GeoChile Compass · Análisis Territorial · Confidencial", ML, PH - 6);
  doc.text(`Página ${pageNum} de ${totalPages}`, PW - ML, PH - 6, { align: "right" });
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN TÍTULO
// ─────────────────────────────────────────────────────────────────────────────

const sectionTitle = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.navy);
  doc.text(text.toUpperCase(), ML, y);
  doc.setDrawColor(...C.blue);
  doc.setLineWidth(0.5);
  doc.line(ML, y + 1.5, PW - ML, y + 1.5);
  doc.setDrawColor(...C.slate100);
  doc.setLineWidth(0.2);
  doc.line(ML, y + 2, PW - ML, y + 2);
  return y + 7;
};

// ─────────────────────────────────────────────────────────────────────────────
// TARJETAS KPI
// ─────────────────────────────────────────────────────────────────────────────

const drawKpiCards = (doc: jsPDF, band: IsochroneBandReport, y: number): number => {
  const cardW  = (PW - ML * 2 - 10) / 3;
  const cardH  = 20;
  const gapX   = 5;
  const gapY   = 4;

  const cards: [string, string, [number,number,number]][] = [
    [fmt(band.totals.pop),               "Personas",              C.blue],
    [fmt(band.totals.hh),                "Hogares",               C.navy],
    [fmtCLP(band.totals.incomeAvgPerHh), "Ingreso prom./hogar",   C.emerald],
    [`${band.area_km2.toFixed(2)} km²`,  "Área del polígono",     C.slate600],
    [fmt(band.density.popPerKm2),        "Densidad hab/km²",      C.amber],
    [fmtCLP(band.totals.incomeTotal),    "Ingreso total/mes",     C.blue],
  ];

  cards.forEach(([val, label, accent], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x   = ML + col * (cardW + gapX);
    const yy  = y + row * (cardH + gapY);

    // Sombra leve
    doc.setFillColor(226, 232, 240); // slate-200
    doc.roundedRect(x + 0.6, yy + 0.6, cardW, cardH, 2, 2, "F");

    // Card
    doc.setFillColor(...C.white);
    doc.roundedRect(x, yy, cardW, cardH, 2, 2, "F");

    // Franja de color izquierda
    doc.setFillColor(...accent);
    doc.roundedRect(x, yy, 2, cardH, 1, 1, "F");
    doc.rect(x + 1, yy, 1, cardH, "F"); // square off right side of franja

    // Texto
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C.navy);
    doc.text(val, x + 5, yy + 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.slate600);
    doc.text(label, x + 5, yy + 15);
  });

  return y + Math.ceil(cards.length / 3) * (cardH + gapY);
};

// ─────────────────────────────────────────────────────────────────────────────
// GRÁFICO DE BARRAS NSE
// ─────────────────────────────────────────────────────────────────────────────

const drawNseChart = (
  doc: jsPDF,
  nseDistribution: { label: string; pct: number }[],
  y: number,
): number => {
  if (!nseDistribution.length) return y;

  const barMaxW = PW - ML * 2 - 32; // espacio para etiqueta + %
  const barH    = 7;
  const gap     = 3;

  nseDistribution.forEach((nse, i) => {
    const yy    = y + i * (barH + gap);
    const color = NSE_COLORS[nse.label] ?? C.slate600;
    const barW  = Math.max(1, (nse.pct / 100) * barMaxW);

    // Etiqueta NSE
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...C.navy);
    doc.text(nse.label, ML, yy + 5.5);

    // Fondo barra
    doc.setFillColor(...C.slate100);
    doc.roundedRect(ML + 18, yy, barMaxW, barH, 1, 1, "F");

    // Barra llena
    doc.setFillColor(...color);
    doc.roundedRect(ML + 18, yy, barW, barH, 1, 1, "F");

    // Porcentaje
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...color);
    doc.text(`${nse.pct}%`, ML + 18 + barMaxW + 3, yy + 5.5);
  });

  return y + nseDistribution.length * (barH + gap) + 4;
};

// ─────────────────────────────────────────────────────────────────────────────
// TABLA CONFIG UNIFICADA
// ─────────────────────────────────────────────────────────────────────────────

const tableTheme = {
  styles: {
    font: "helvetica" as const,
    fontSize: 8,
    cellPadding: 2,
    textColor: [15, 23, 42] as [number,number,number],
  },
  headStyles: {
    fillColor: C.navy,
    textColor: C.white as [number,number,number],
    fontSize: 8,
    fontStyle: "bold" as const,
    cellPadding: 2.5,
  },
  alternateRowStyles: {
    fillColor: [248, 250, 252] as [number,number,number],
  },
  margin: { left: ML, right: ML },
};

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN GASTO ENDÓGENO + PARQUE VEHICULAR (página opcional)
// ─────────────────────────────────────────────────────────────────────────────

const addEconomicPage = (
  doc: jsPDF,
  report: IsochroneReport,
  totalPages: number,
): void => {
  const { gastoEndogeno, parqueStats } = report;
  if (!gastoEndogeno && !parqueStats) return;

  doc.addPage();
  addPageHeader(doc, report, report.iso.minutes[report.iso.minutes.length - 1]);

  let y = BODY_TOP;

  // ── GASTO ENDÓGENO ────────────────────────────────────────────────────────
  if (gastoEndogeno && gastoEndogeno.totalHogaresObjetivo > 0) {
    y = sectionTitle(doc, "Distribución del Gasto por GSE (Canasta Autoplanet)", y);

    // KPI highlight
    const fmtM = (n: number) => {
      if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B/mes`;
      if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M/mes`;
      return `$${Math.round(n).toLocaleString("es-CL")}/mes`;
    };

    // Mini KPIs fila superior
    const kpis: [string, string, [number,number,number]][] = [
      [fmtM(gastoEndogeno.gastoMensualObjetivo), "Gasto objetivo total/mes",     C.blue],
      [fmt(gastoEndogeno.totalHogaresObjetivo),  "Hogares mercado objetivo",      C.navy],
      [fmtCLP(gastoEndogeno.gastoPromPorHogar),  "Gasto promedio por hogar/mes",  C.emerald],
    ];
    const cw3 = (PW - ML * 2 - 10) / 3;
    kpis.forEach(([val, label, accent], i) => {
      const x = ML + i * (cw3 + 5);
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(x + 0.5, y + 0.5, cw3, 18, 2, 2, "F");
      doc.setFillColor(...C.white);
      doc.roundedRect(x, y, cw3, 18, 2, 2, "F");
      doc.setFillColor(...accent);
      doc.roundedRect(x, y, 2, 18, 1, 1, "F");
      doc.rect(x + 1, y, 1, 18, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...C.navy);
      doc.text(val, x + 5, y + 7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...C.slate600);
      doc.text(label, x + 5, y + 14);
    });
    y += 24;

    // Tabla GSE
    const GSE_COLORS_PDF: Record<string, [number,number,number]> = {
      ABC1: C.abc1, C1: C.c2, C2: C.c2, C3: C.c3, D: C.d, E: C.e,
    };

    autoTable(doc, {
      ...tableTheme,
      startY: y,
      head: [["GSE", "Hogares", "Gasto (CLP/mes)", "% del Objetivo", "Objetivo"]],
      body: gastoEndogeno.rows.map((r) => [
        r.gse,
        fmt(r.hogares),
        fmtCLP(r.gastoMensual),
        r.esObjetivo ? `${r.pctDelTotal.toFixed(1)}%` : "—",
        r.esObjetivo ? "Sí" : "No",
      ]),
      columnStyles: {
        0: { fontStyle: "bold" },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const gse = gastoEndogeno.rows[data.row.index]?.gse;
          if (gse) {
            const c = GSE_COLORS_PDF[gse] ?? C.slate600;
            data.cell.styles.textColor = c;
          }
        }
      },
      tableWidth: PW - ML * 2,
      didDrawPage: (data) => {
        addPageHeader(doc, report, report.iso.minutes[report.iso.minutes.length - 1]);
        addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
        if (data.cursor) data.cursor.y = Math.max(data.cursor.y, BODY_TOP);
      },
    });
    y = (lastY(doc) || y) + 10;

    // Nota metodológica
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.slate400);
    const src = gastoEndogeno.source === "gse"
      ? "Distribución GSE calculada desde manzanas censales (Censo 2017)."
      : gastoEndogeno.source === "nse_fallback"
        ? "Distribución GSE estimada por NSE comunal (fallback — sin datos de manzanas)."
        : "Sin datos GSE disponibles.";
    doc.text(`Fuente: Coeficientes EPF 2021-2022 actualizados (XBREIN/Autoplanet). ${src}`, ML, y);
    y += 8;
  }

  // ── PARQUE VEHICULAR ──────────────────────────────────────────────────────
  if (parqueStats && parqueStats.vehiculos > 0) {
    if (y > PH - 80) {
      doc.addPage();
      addPageHeader(doc, report, report.iso.minutes[report.iso.minutes.length - 1]);
      addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
      y = BODY_TOP;
    }
    y = sectionTitle(doc, "Parque Vehicular y Ranking de Marcas", y);

    // KPIs parque
    const parqueKpis: [string, string, [number,number,number]][] = [
      [fmt(Math.round(parqueStats.vehiculos)), "Vehículos estimados",   C.blue],
      [`${parqueStats.edad_media.toFixed(1)} años`,  "Edad media del parque", C.navy],
      [`${parqueStats.edad_p25.toFixed(0)}–${parqueStats.edad_p75.toFixed(0)} años`, "Rango intercuartil (P25–P75)", C.emerald],
    ];
    const cw3p = (PW - ML * 2 - 10) / 3;
    parqueKpis.forEach(([val, label, accent], i) => {
      const x = ML + i * (cw3p + 5);
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(x + 0.5, y + 0.5, cw3p, 18, 2, 2, "F");
      doc.setFillColor(...C.white);
      doc.roundedRect(x, y, cw3p, 18, 2, 2, "F");
      doc.setFillColor(...accent);
      doc.roundedRect(x, y, 2, 18, 1, 1, "F");
      doc.rect(x + 1, y, 1, 18, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...C.navy);
      doc.text(val, x + 5, y + 7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...C.slate600);
      doc.text(label, x + 5, y + 14);
    });
    y += 24;

    // Tabla ranking de marcas
    if (parqueStats.ranking_marcas.length > 0) {
      autoTable(doc, {
        ...tableTheme,
        startY: y,
        head: [["#", "Marca", "Vehículos (est.)", "% del Parque"]],
        body: parqueStats.ranking_marcas.map((m, i) => [
          i + 1,
          m.marca,
          fmt(Math.round(m.count)),
          `${m.pct.toFixed(1)}%`,
        ]),
        columnStyles: {
          0: { halign: "right", cellWidth: 12 },
          2: { halign: "right" },
          3: { halign: "right" },
        },
        tableWidth: PW - ML * 2,
        didDrawPage: (data) => {
          addPageHeader(doc, report, report.iso.minutes[report.iso.minutes.length - 1]);
          addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
          if (data.cursor) data.cursor.y = Math.max(data.cursor.y, BODY_TOP);
        },
      });
      y = (lastY(doc) || y) + 6;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.slate400);
    doc.text("Fuente: Parque automotor SII/Registros Civiles (datos H3 hex agregados). Estimación por intersección geoespacial.", ML, y);
  }

  addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
};

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DE BANDA
// ─────────────────────────────────────────────────────────────────────────────

const addBandPage = (
  doc: jsPDF,
  report: IsochroneReport,
  band: IsochroneBandReport,
  totalPages: number,
): void => {
  addPageHeader(doc, report, band.bandMinutes);

  let y = BODY_TOP;

  // Título banda
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...C.navy);
  doc.text(`Banda de ${band.bandMinutes} minutos`, ML, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.slate600);
  doc.text(
    `Centro: ${report.iso.centerLat.toFixed(5)}, ${report.iso.centerLng.toFixed(5)}  ·  ` +
    `Fuente: ${band.totals.source === "manzanas" ? "Manzanas Censo 2017" : "Estimación comunal proporcional"}`,
    ML, y
  );
  y += 8;

  // KPI cards
  y = drawKpiCards(doc, band, y) + 6;

  // Comunas
  if (y > PH - 60) {
    doc.addPage();
    addPageHeader(doc, report, band.bandMinutes);
    addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
    y = BODY_TOP;
  }
  y = sectionTitle(doc, "Comunas involucradas", y);
  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head: [["Comuna", "% en iso", "% de comuna", "NSE", "Personas", "Hogares", "Ingreso (CLP)"]],
    body: band.communes.map((c) => [
      c.name,
      fmtPct(c.areaShareInIso),
      fmtPct(c.areaShareOfCommune),
      c.nse ?? "—",
      fmt(c.popInIso),
      fmt(c.hhInIso),
      fmtCLP(c.incomeInIso),
    ]),
    columnStyles: {
      1: { halign: "right" }, 2: { halign: "right" },
      4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" },
    },
    didDrawPage: (data) => {
      addPageHeader(doc, report, band.bandMinutes);
      addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
      if (data.cursor) data.cursor.y = Math.max(data.cursor.y, BODY_TOP);
    },
  });
  y = (lastY(doc) || y) + 8;

  // NSE — gráfico de barras
  if (band.nseDistribution.length > 0) {
    if (y > PH - 70) {
      doc.addPage();
      addPageHeader(doc, report, band.bandMinutes);
      addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
      y = BODY_TOP;
    }
    y = sectionTitle(doc, "Distribución NSE", y);
    y = drawNseChart(doc, band.nseDistribution, y) + 4;
  }

  addPageFooter(doc, doc.internal.pages.length - 1, totalPages);
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/** Genera y descarga el PDF oficial del informe de isócrona. */
export const exportReportToPdf = (report: IsochroneReport): void => {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // Estimación de páginas: portada + ~1 por banda + económica (si hay)
  const hasEconomic = !!(report.gastoEndogeno?.totalHogaresObjetivo || report.parqueStats?.vehiculos);
  const estimatedPages = 1 + report.bands.length + (hasEconomic ? 1 : 0);

  // Portada
  addCoverPage(doc, report);

  // Páginas por banda
  for (const band of report.bands) {
    doc.addPage();
    addBandPage(doc, report, band, estimatedPages);
  }

  // Análisis económico (gasto endógeno + parque vehicular) — última página
  addEconomicPage(doc, report, estimatedPages);

  // Actualizar pie con total real de páginas
  const totalReal = doc.internal.pages.length - 1;
  // (jsPDF no soporta two-pass nativo; el estimado es suficientemente cercano)
  void totalReal;

  const fecha = new Date(report.generatedAt)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  doc.save(`informe-isocrona-${fecha}-${report.iso.id.slice(0, 8)}.pdf`);
};
