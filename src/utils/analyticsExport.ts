import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { LocalMetrics } from "@/services/analyticsMetricsService";

/**
 * Export de la tabla de datos analíticos a Excel y PDF.
 *
 * Recibe las filas y columnas YA filtradas y seleccionadas por la UI, siguiendo
 * el patrón del informe de patentes de leaseflow: lo que se exporta es
 * exactamente lo que el usuario está viendo, no la tabla completa. Si el export
 * reconstruyera el conjunto por su cuenta, el archivo diría algo distinto de la
 * pantalla y no habría forma de saber cuál de los dos está mal.
 */

export interface ExportColumn {
  key: keyof LocalMetrics | "sqm";
  label: string;
  /** Formato para presentación. Los números crudos van al Excel. */
  format?: (v: unknown, row: LocalMetrics) => string | number | null;
  decimals?: number;
}

const asNumber = (v: unknown, decimals?: number): number | null => {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
  return decimals != null ? Math.round(v * 10 ** decimals) / 10 ** decimals : v;
};

const cellValue = (row: LocalMetrics, col: ExportColumn): string | number | null => {
  const raw = (row as unknown as Record<string, unknown>)[col.key as string];
  if (col.format) return col.format(raw, row);
  if (typeof raw === "number") return asNumber(raw, col.decimals ?? 1);
  if (typeof raw === "boolean") return raw ? "Sí" : "No";
  return (raw as string | null) ?? null;
};

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

export interface ExportContext {
  /** Nombre de la carpeta / red exportada. */
  folderName: string;
  /** Descripción del filtro activo, para dejar constancia en el archivo. */
  filterLabel: string;
  /** Total de filas antes de filtrar, para que se vea qué se dejó fuera. */
  totalRows: number;
}

export const exportAnalyticsToXlsx = (
  rows: LocalMetrics[],
  columns: ExportColumn[],
  ctx: ExportContext,
): void => {
  const header = columns.map((c) => c.label);
  const body = rows.map((r) => columns.map((c) => cellValue(r, c)));

  // La constancia del filtro va ARRIBA de la tabla: un Excel suelto sin eso es
  // indistinguible de un export completo, y las conclusiones cambian.
  const aoa: (string | number | null)[][] = [
    [`Datos analíticos · ${ctx.folderName}`],
    [`Generado ${new Date().toLocaleString("es-CL")}`],
    [`Filtro: ${ctx.filterLabel}`],
    [`Filas exportadas: ${rows.length} de ${ctx.totalRows}`],
    [],
    header,
    ...body,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(12, c.label.length + 3) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos analíticos");
  XLSX.writeFile(wb, `datos-analiticos-${ctx.folderName.replace(/[^\w-]+/g, "_")}-${stamp()}.xlsx`);
};

export const exportAnalyticsToPdf = (
  rows: LocalMetrics[],
  columns: ExportColumn[],
  ctx: ExportContext,
): void => {
  // Horizontal: con seis o más columnas de métricas, en vertical las cifras se
  // parten y la tabla deja de ser legible al proyectarla.
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(14);
  doc.text(`Datos analíticos · ${ctx.folderName}`, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Generado ${new Date().toLocaleString("es-CL")}`, 14, 23);
  doc.text(`Filtro: ${ctx.filterLabel}`, 14, 28);
  doc.text(`Filas: ${rows.length} de ${ctx.totalRows}`, 14, 33);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 38,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) =>
      columns.map((c) => {
        const v = cellValue(r, c);
        return v == null ? "—" : typeof v === "number" ? v.toLocaleString("es-CL") : String(v);
      }),
    ),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [192, 0, 63], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    margin: { left: 14, right: 14 },
  });

  // Nota metodológica: el PDF circula suelto y sin esto alguien puede leer la
  // columna de residual como si el modelo fuera confiable.
  const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 38;
  doc.setFontSize(7);
  doc.setTextColor(110);
  doc.text(
    "El modelo de comparables explica ~2,5% de la varianza de ventas: el residual indica desvío respecto de una referencia débil, no una meta. " +
    "Superficie asumida (425 m², Express la mitad) mientras no exista el dato real.",
    14, Math.min(y + 6, 200), { maxWidth: 265 },
  );

  doc.save(`datos-analiticos-${ctx.folderName.replace(/[^\w-]+/g, "_")}-${stamp()}.pdf`);
};
