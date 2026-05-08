import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { IsochroneReport, IsochroneBandReport } from "./reportData";

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtCLP = (n: number) => `$${fmt(n)}`;
const fmtPct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

const PRIMARY: [number, number, number] = [37, 99, 235]; // tailwind blue-600
const MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const FG: [number, number, number] = [15, 23, 42]; // slate-900

/** jspdf-autotable adjunta lastAutoTable a la instancia; lo leemos vía cast. */
const lastY = (doc: jsPDF): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY ?? 0;

const addHeader = (doc: jsPDF, report: IsochroneReport, pageNum: number) => {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, w, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Informe de isócrona", 12, 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    `${report.iso.modeLabel} · ${report.iso.minutes.join("/")} min`,
    w - 12,
    9,
    { align: "right" },
  );
  doc.setTextColor(...FG);
  // Footer con fecha + página
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Generado: ${new Date(report.generatedAt).toLocaleString("es-CL")}`,
    12,
    h - 6,
  );
  doc.text(`Página ${pageNum}`, w - 12, h - 6, { align: "right" });
  doc.setTextColor(...FG);
};

const sectionTitle = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...FG);
  doc.text(text, 12, y);
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.5);
  doc.line(12, y + 1, doc.internal.pageSize.getWidth() - 12, y + 1);
  return y + 6;
};

const drawSummaryCards = (
  doc: jsPDF,
  band: IsochroneBandReport,
  y: number,
): number => {
  const pageW = doc.internal.pageSize.getWidth();
  const pad = 12;
  const cardW = (pageW - pad * 2 - 6) / 3;
  const cardH = 18;
  const cards: [string, string][] = [
    [fmt(band.totals.pop), "Personas"],
    [fmt(band.totals.hh), "Hogares"],
    [fmtCLP(band.totals.incomeAvgPerHh), "Ingreso prom./hogar"],
    [`${band.area_km2.toFixed(2)} km²`, "Área"],
    [fmt(band.density.popPerKm2), "Densidad hab/km²"],
    [fmtCLP(band.totals.incomeTotal), "Ingreso total/mes"],
  ];
  cards.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = pad + col * (cardW + 3);
    const yy = y + row * (cardH + 3);
    doc.setFillColor(241, 245, 249); // slate-100
    doc.roundedRect(x, yy, cardW, cardH, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...FG);
    doc.text(c[0], x + 3, yy + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(c[1], x + 3, yy + 13);
  });
  return y + Math.ceil(cards.length / 3) * (cardH + 3);
};

const tableTheme = {
  styles: { font: "helvetica" as const, fontSize: 8, cellPadding: 1.6 },
  headStyles: {
    fillColor: PRIMARY,
    textColor: [255, 255, 255] as [number, number, number],
    fontSize: 8,
    fontStyle: "bold" as const,
  },
  alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] }, // slate-50
  margin: { left: 12, right: 12 },
};

const addBandPage = (
  doc: jsPDF,
  report: IsochroneReport,
  band: IsochroneBandReport,
  isFirst: boolean,
): void => {
  if (!isFirst) doc.addPage();
  const pageNum = doc.internal.pages.length - 1;
  addHeader(doc, report, pageNum);

  let y = 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Banda de ${band.bandMinutes} minutos`, 12, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Centro: ${report.iso.centerLat.toFixed(5)}, ${report.iso.centerLng.toFixed(5)}  ·  Fuente población: ${
      band.totals.source === "manzanas"
        ? "Manzanas (Censo)"
        : "Estimación comunal proporcional"
    }`,
    12,
    y,
  );
  doc.setTextColor(...FG);
  y += 5;

  // Cards de KPIs
  y = drawSummaryCards(doc, band, y) + 4;

  // Tabla comunas
  y = sectionTitle(doc, "Comunas involucradas", y);
  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head: [["Comuna", "% iso", "% comuna", "NSE", "Personas en iso", "Hogares en iso", "Ingreso en iso (CLP)"]],
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
      1: { halign: "right" },
      2: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
  });
  y = (lastY(doc) || y) + 6;

  // NSE distribution
  if (band.nseDistribution.length > 0) {
    y = sectionTitle(doc, "Distribución NSE", y);
    autoTable(doc, {
      ...tableTheme,
      startY: y,
      head: [["NSE", "% del área de iso"]],
      body: band.nseDistribution.map((n) => [n.label, `${n.pct}%`]),
      columnStyles: { 1: { halign: "right" } },
      tableWidth: 80,
    });
    y = (lastY(doc) || y) + 6;
  }

  // Comparaciones vs RM
  if (band.comparisons.length > 0) {
    y = sectionTitle(doc, "Comparación vs RM", y);
    autoTable(doc, {
      ...tableTheme,
      startY: y,
      head: [["Indicador", "Valor", "vs RM"]],
      body: band.comparisons.map((c) => {
        let val: string;
        if (c.format === "clp") val = fmtCLP(c.value);
        else if (c.format === "pct") val = `${c.value.toFixed(1)}%`;
        else if (c.format === "decimal") val = c.value.toFixed(2);
        else val = fmt(c.value);
        const delta = c.vsRmPct == null ? "—" : `${c.vsRmPct > 0 ? "+" : ""}${c.vsRmPct.toFixed(1)}%`;
        return [c.label, val, delta];
      }),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      tableWidth: 120,
    });
    y = (lastY(doc) || y) + 6;
  }

  // Puntos territoriales — resumen
  y = sectionTitle(
    doc,
    `Capas territoriales · ${band.pointsTotal} puntos`,
    y,
  );
  if (band.pointsByGroup.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("Sin puntos territoriales en el área.", 12, y + 2);
    doc.setTextColor(...FG);
    y += 6;
  } else {
    const groupRows: (string | number)[][] = [];
    for (const g of band.pointsByGroup) {
      for (const l of g.layers) groupRows.push([g.groupName, l.layerName, l.count]);
    }
    autoTable(doc, {
      ...tableTheme,
      startY: y,
      head: [["Grupo", "Capa", "Cantidad"]],
      body: groupRows,
      columnStyles: { 2: { halign: "right" } },
    });
    y = (lastY(doc) || y) + 4;

    if (band.pointsDetail.length > 0) {
      autoTable(doc, {
        ...tableTheme,
        startY: y,
        head: [["Grupo", "Capa", "Nombre", "Lat", "Lng"]],
        body: band.pointsDetail.map((p) => [
          p.groupName,
          p.layerName,
          p.name ?? "(sin nombre)",
          p.lat.toFixed(5),
          p.lng.toFixed(5),
        ]),
        styles: { ...tableTheme.styles, fontSize: 7 },
        didDrawPage: (data) => {
          addHeader(doc, report, doc.internal.pages.length - 1);
          if (data.cursor) data.cursor.y = Math.max(data.cursor.y, 22);
        },
      });
      y = (lastY(doc) || y) + 6;
    }
  }

  // Comercios — resumen + detalle
  if (band.commerceCountsByCategory.length > 0) {
    y = sectionTitle(doc, "Comercios", y);
    autoTable(doc, {
      ...tableTheme,
      startY: y,
      head: [["Categoría", "Cantidad"]],
      body: band.commerceCountsByCategory.map((c) => [c.label, c.count]),
      columnStyles: { 1: { halign: "right" } },
      tableWidth: 100,
    });
    y = (lastY(doc) || y) + 4;

    if (band.commerceItemsInBand.length > 0) {
      autoTable(doc, {
        ...tableTheme,
        startY: y,
        head: [["Categoría", "Nombre", "Marca", "Dirección", "Teléfono", "Lat", "Lng"]],
        body: band.commerceItemsInBand.map((c) => [
          c.categoryLabel,
          c.name,
          c.brand ?? "",
          c.address ?? "",
          c.phone ?? "",
          c.lat.toFixed(5),
          c.lng.toFixed(5),
        ]),
        styles: { ...tableTheme.styles, fontSize: 7 },
        didDrawPage: (data) => {
          addHeader(doc, report, doc.internal.pages.length - 1);
          if (data.cursor) data.cursor.y = Math.max(data.cursor.y, 22);
        },
      });
    }
  } else {
    y = sectionTitle(doc, "Comercios", y);
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
      "No se consultaron categorías de comercios.",
      12,
      y + 2,
    );
    doc.setTextColor(...FG);
  }
};

/** Genera y descarga el PDF del informe. */
export const exportReportToPdf = (report: IsochroneReport): void => {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let first = true;
  for (const band of report.bands) {
    addBandPage(doc, report, band, first);
    first = false;
  }
  const filename = `informe-isocrona-${report.iso.id}.pdf`;
  doc.save(filename);
};
