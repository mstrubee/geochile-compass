/**
 * poiFolderReportPdf.ts
 * ─────────────────────
 * Genera y descarga el informe ejecutivo de ventas de una carpeta de POIs en PDF.
 *
 * Estructura:
 *   Página 1 (Portrait)  — Resumen ejecutivo + KPI cards + ranking
 *   Página 2 (Landscape) — Ventas mensuales últimos 12m por local
 *   Página 3 (Portrait)  — Performance vs modelo (si hay datos)
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { PoiFolderReportData } from "@/services/poiFolderReportService";

// ── Colores corporativos ─────────────────────────────────────────────────────

const PRIMARY:  [number, number, number] = [37,  99,  235]; // blue-600
const MUTED:    [number, number, number] = [100, 116, 139]; // slate-500
const FG:       [number, number, number] = [15,  23,  42];  // slate-900
const SUCCESS:  [number, number, number] = [22,  163, 74];  // green-600
const DANGER:   [number, number, number] = [220, 38,  38];  // red-600
const ALT_ROW:  [number, number, number] = [248, 250, 252]; // slate-50
const CARD_BG:  [number, number, number] = [241, 245, 249]; // slate-100

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtCLP = (v: number): string => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};

const fmtPct = (v: number | null): string =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-");
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${months[parseInt(m, 10) - 1]}/${y.slice(2)}`;
};

const slugify = (s: string): string =>
  s.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 30) || "carpeta";

// ── Utilidades jsPDF ─────────────────────────────────────────────────────────

/** Lee finalY del último autoTable (adjunto a la instancia vía cast). */
const lastY = (doc: jsPDF): number =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).lastAutoTable?.finalY ?? 0;

const tableTheme = {
  styles:           { font: "helvetica" as const, fontSize: 7.5, cellPadding: 1.4 },
  headStyles:       { fillColor: PRIMARY, textColor: [255,255,255] as [number,number,number], fontSize: 7.5, fontStyle: "bold" as const },
  alternateRowStyles: { fillColor: ALT_ROW },
  margin:           { left: 10, right: 10 },
};

const addHeader = (doc: jsPDF, folderName: string, pageNum: number): void => {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // Barra superior
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, w, 11, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(`Informe de Ventas · ${folderName}`, 10, 7.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Pág. ${pageNum}`, w - 10, 7.5, { align: "right" });

  // Footer
  doc.setTextColor(...MUTED);
  doc.setFontSize(6.5);
  doc.text(`Generado: ${new Date().toLocaleDateString("es-CL")}`, 10, h - 4);
  doc.text("GeoChile Compass", w - 10, h - 4, { align: "right" });
  doc.setTextColor(...FG);
};

const sectionTitle = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...FG);
  doc.text(text, 10, y);
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.35);
  doc.line(10, y + 1, doc.internal.pageSize.getWidth() - 10, y + 1);
  return y + 6;
};

// ── KPI Cards ────────────────────────────────────────────────────────────────

const drawKpiCards = (doc: jsPDF, data: PoiFolderReportData, startY: number): number => {
  const w    = doc.internal.pageSize.getWidth();
  const pad  = 10;
  const gapX = 3;
  const cardW = (w - pad * 2 - gapX * 3) / 4;
  const cardH = 17;

  const { totals, last12Periods } = data;
  const periodRange = last12Periods.length > 0
    ? `${monthLabel(last12Periods[0])} – ${monthLabel(last12Periods[last12Periods.length - 1])}`
    : "Sin datos";

  type Card = { val: string; label: string; color?: "green" | "red" };
  const cards: Card[] = [
    { val: String(totals.nWithSales),           label: "Locales con datos" },
    { val: fmtCLP(totals.last12mCLP),           label: `Ventas ${periodRange}` },
    { val: fmtCLP(totals.avgMonthlyCLP),        label: "Prom. mensual / local" },
    {
      val:   totals.yoyPct != null ? fmtPct(totals.yoyPct) : "—",
      label: "Crecimiento YoY",
      color: totals.yoyPct == null ? undefined : totals.yoyPct >= 0 ? "green" : "red",
    },
  ];

  cards.forEach((c, i) => {
    const x  = pad + i * (cardW + gapX);
    const yy = startY;

    doc.setFillColor(...CARD_BG);
    doc.roundedRect(x, yy, cardW, cardH, 1.5, 1.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    if (c.color === "green")     doc.setTextColor(...SUCCESS);
    else if (c.color === "red")  doc.setTextColor(...DANGER);
    else                         doc.setTextColor(...FG);
    doc.text(c.val, x + 3, yy + 7.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    // Wrap largo label
    const lines = doc.splitTextToSize(c.label, cardW - 6) as string[];
    doc.text(lines[0], x + 3, yy + 13);
  });
  doc.setTextColor(...FG);
  return startY + cardH + 4;
};

// ── Página 1: Resumen ejecutivo ──────────────────────────────────────────────

const addPage1 = (doc: jsPDF, data: PoiFolderReportData): void => {
  addHeader(doc, data.folder.name, 1);

  let y = 17;

  // Título
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...FG);
  doc.text("Informe de Ventas", 10, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`${data.folder.name} · ${data.totals.nPois} locales`, 10, y);
  doc.setTextColor(...FG);
  y += 6;

  // KPI cards
  y = drawKpiCards(doc, data, y) + 2;

  // Ranking
  y = sectionTitle(doc, "Ranking de locales · Últimos 12 meses", y);

  const STATE_LABELS: Record<string, string> = {
    recovered_growing: "▲ Creciendo",
    stable:            "● Estable",
    decelerating:      "↘ Desacel.",
    not_recovered:     "▼ No recup.",
    at_risk:           "⚠ Riesgo",
    insufficient_data: "—",
  };

  const rankBody = data.pois.map((poi, idx) => {
    const l12 = data.last12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const p12 = data.prev12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const avg  = data.last12Periods.length > 0 ? Math.round(l12 / data.last12Periods.length) : 0;
    const yoy  = p12 > 0 ? ((l12 - p12) / p12) * 100 : null;
    return [
      String(idx + 1),
      poi.name,
      fmtCLP(l12),
      fmtCLP(avg),
      fmtPct(yoy),
      poi.temporal_state ? (STATE_LABELS[poi.temporal_state] ?? poi.temporal_state) : "—",
    ];
  });

  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head:   [["#", "Local", "Ventas 12m", "Prom/mes", "YoY", "Estado"]],
    body:   rankBody,
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "center" },
    },
    didDrawPage: (hook) => {
      const pn = doc.internal.pages.length - 1;
      addHeader(doc, data.folder.name, pn);
      if (hook.cursor) hook.cursor.y = Math.max(hook.cursor.y, 17);
    },
  });
};

// ── Página 2: Ventas mensuales (landscape) ───────────────────────────────────

const addPage2 = (doc: jsPDF, data: PoiFolderReportData): void => {
  if (data.last12Periods.length === 0) return;

  doc.addPage("a4", "landscape");
  const pageNum = doc.internal.pages.length - 1;
  addHeader(doc, data.folder.name, pageNum);

  const periodRange = `${monthLabel(data.last12Periods[0])} – ${monthLabel(data.last12Periods[data.last12Periods.length - 1])}`;
  let y = sectionTitle(doc, `Ventas mensuales · ${periodRange}`, 17);

  const monthHeaders = data.last12Periods.map(monthLabel);

  const body = data.pois.map(poi => {
    const monthly  = data.last12Periods.map(p => poi.monthlyCLP[p] ?? 0);
    const total12  = monthly.reduce((a, b) => a + b, 0);
    const p12      = data.prev12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const yoy      = p12 > 0 ? ((total12 - p12) / p12) * 100 : null;
    return [
      poi.name,
      ...monthly.map(v => v > 0 ? fmtCLP(v) : "—"),
      fmtCLP(total12),
      fmtPct(yoy),
    ];
  });

  // Fila de totales
  const monthTotals = data.last12Periods.map(p =>
    data.pois.reduce((s, poi) => s + (poi.monthlyCLP[p] ?? 0), 0));
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);
  const prevGrand  = data.pois.reduce((s, poi) =>
    s + data.prev12Periods.reduce((ss, p) => ss + (poi.monthlyCLP[p] ?? 0), 0), 0);
  const grandYoY   = prevGrand > 0 ? ((grandTotal - prevGrand) / prevGrand) * 100 : null;
  body.push([
    "TOTAL",
    ...monthTotals.map(v => v > 0 ? fmtCLP(v) : "—"),
    fmtCLP(grandTotal),
    fmtPct(grandYoY),
  ]);

  // Anchos de columna
  const nMonths = data.last12Periods.length;
  const nameW   = 52;
  const numW    = 18;
  const totalW  = 20;
  const yoyW    = 12;
  const columnStyles: Record<number, { halign?: "right" | "left" | "center"; cellWidth?: number; fontStyle?: "bold" }> = {
    0: { cellWidth: nameW },
    [nMonths + 1]: { halign: "right", cellWidth: totalW, fontStyle: "bold" },
    [nMonths + 2]: { halign: "right", cellWidth: yoyW },
  };
  for (let i = 1; i <= nMonths; i++) {
    columnStyles[i] = { halign: "right", cellWidth: numW };
  }

  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head:   [["Local", ...monthHeaders, "Total 12m", "YoY"]],
    body,
    styles:        { ...tableTheme.styles, fontSize: 7 },
    columnStyles,
    didDrawPage: (hook) => {
      const pn = doc.internal.pages.length - 1;
      addHeader(doc, data.folder.name, pn);
      if (hook.cursor) hook.cursor.y = Math.max(hook.cursor.y, 17);
    },
  });
};

// ── Página 3: Performance vs modelo ─────────────────────────────────────────

const addPage3 = (doc: jsPDF, data: PoiFolderReportData): void => {
  if (!data.hasPerformanceData) return;

  const poisWithPerf = data.pois.filter(
    p => p.actual_monthly_uf != null || p.predicted_monthly_uf != null,
  );
  if (poisWithPerf.length === 0) return;

  doc.addPage("a4", "portrait");
  const pageNum = doc.internal.pages.length - 1;
  addHeader(doc, data.folder.name, pageNum);

  let y = sectionTitle(doc, "Performance vs Modelo Predictivo", 17);

  const STATE_LABELS: Record<string, string> = {
    recovered_growing: "▲ Creciendo",
    stable:            "● Estable",
    decelerating:      "↘ Desacelerando",
    not_recovered:     "▼ No recuperado",
    at_risk:           "⚠ En riesgo",
    insufficient_data: "—",
  };

  const body = poisWithPerf.map(p => {
    const topDriverText = p.top_drivers.slice(0, 2)
      .map(d => `${d.label} (${d.contribution_uf > 0 ? "+" : ""}${d.contribution_uf.toFixed(1)} UF)`)
      .join(", ");
    return [
      p.name,
      p.actual_monthly_uf    != null ? `${p.actual_monthly_uf.toFixed(1)} UF`    : "—",
      p.predicted_monthly_uf != null ? `${p.predicted_monthly_uf.toFixed(1)} UF` : "—",
      p.residual_pct         != null ? fmtPct(p.residual_pct) : "—",
      p.temporal_state ? (STATE_LABELS[p.temporal_state] ?? p.temporal_state) : "—",
      topDriverText || "—",
    ];
  });

  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head:   [["Local", "Real UF/mes", "Predicción UF/mes", "Diferencia", "Estado", "Drivers"]],
    body,
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "center" },
      5: { cellWidth: 65 },
    },
    didDrawPage: (hook) => {
      const pn = doc.internal.pages.length - 1;
      addHeader(doc, data.folder.name, pn);
      if (hook.cursor) hook.cursor.y = Math.max(hook.cursor.y, 17);
    },
  });

  // Nota metodológica
  y = (lastY(doc) || y) + 5;
  if (y < doc.internal.pageSize.getHeight() - 25) {
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      "Nota: Predicción basada en Modelo Ridge con features territoriales (NSE, densidad, competencia, gasto endógeno). Diferencia = (Real - Predicho) / Real.",
      10, y,
      { maxWidth: doc.internal.pageSize.getWidth() - 20 },
    );
    doc.setTextColor(...FG);
  }
};

// ── Función principal exportada ──────────────────────────────────────────────

export const exportFolderReportToPdf = (data: PoiFolderReportData): void => {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  addPage1(doc, data);
  addPage2(doc, data);
  addPage3(doc, data);

  const today    = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `ventas_${slugify(data.folder.name)}_${today}.pdf`;
  doc.save(filename);
};
