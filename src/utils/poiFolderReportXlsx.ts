/**
 * poiFolderReportXlsx.ts
 * ──────────────────────
 * Genera y descarga el informe de ventas de una carpeta de POIs en formato .xlsx
 * con múltiples hojas:
 *
 *  1. Resumen Ejecutivo — KPIs, ranking de locales
 *  2. Ventas Últ. 12 Meses — tabla pivoteada por mes
 *  3. Histórico Completo — todos los períodos (si hay más de 12)
 *  4. Performance Modelo — real vs predicción, drivers (si existe)
 */

import * as XLSX from "xlsx";
import type { PoiFolderReportData } from "@/services/poiFolderReportService";

// ── formatters ───────────────────────────────────────────────────────────────

const fmtCLP = (v: number) => Math.round(v);

const fmtPctStr = (v: number | null): string =>
  v == null ? "" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-");
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
};

const slugify = (s: string): string =>
  s.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 40) || "carpeta";

const sheetName = (s: string): string =>
  s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

const colWidth = (wch: number) => ({ wch });

type AOA = (string | number | null)[][];

const makeSheet = (aoa: AOA, colWidths: { wch: number }[]): XLSX.WorkSheet => {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = colWidths;
  return ws;
};

// ── Hoja 1: Resumen Ejecutivo ────────────────────────────────────────────────

const buildResumenSheet = (data: PoiFolderReportData): XLSX.WorkSheet => {
  const { folder, totals, last12Periods, prev12Periods, generatedAt } = data;
  const today = new Date(generatedAt).toLocaleDateString("es-CL");
  const periodRange = last12Periods.length > 0
    ? `${monthLabel(last12Periods[0])} a ${monthLabel(last12Periods[last12Periods.length - 1])}`
    : "Sin datos";

  const aoa: AOA = [
    [`INFORME DE VENTAS — ${folder.name.toUpperCase()}`],
    ["Generado", today],
    ["Período analizado (últ. 12m)", periodRange],
    [],
    ["RESUMEN EJECUTIVO"],
    ["N° locales totales",          totals.nPois],
    ["N° locales con datos",        totals.nWithSales],
    ["Ventas totales últimos 12m (CLP)", fmtCLP(totals.last12mCLP)],
    ["Ventas totales período anterior (CLP)", fmtCLP(totals.prev12mCLP)],
    ["Crecimiento YoY",             totals.yoyPct != null ? fmtPctStr(totals.yoyPct) : "Sin datos previos"],
    ["Promedio mensual por local (CLP)", fmtCLP(totals.avgMonthlyCLP)],
    [],
    ["RANKING DE LOCALES (últimos 12 meses)"],
    ["#", "Local", "Ventas 12m (CLP)", "Prom/mes (CLP)", "YoY", "Estado"],
  ];

  data.pois.forEach((poi, idx) => {
    const l12 = last12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const p12 = prev12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const avg  = last12Periods.length > 0 ? Math.round(l12 / last12Periods.length) : 0;
    const yoy  = p12 > 0 ? ((l12 - p12) / p12) * 100 : null;

    const STATE_LABELS: Record<string, string> = {
      recovered_growing: "▲ Creciendo",
      stable:            "● Estable",
      decelerating:      "↘ Desacelerando",
      not_recovered:     "▼ No recuperado",
      at_risk:           "⚠ En riesgo",
      insufficient_data: "—",
    };

    aoa.push([
      idx + 1,
      poi.name,
      fmtCLP(l12),
      fmtCLP(avg),
      fmtPctStr(yoy),
      poi.temporal_state ? (STATE_LABELS[poi.temporal_state] ?? poi.temporal_state) : "",
    ]);
  });

  return makeSheet(aoa, [
    colWidth(4),
    colWidth(38),
    colWidth(24),
    colWidth(22),
    colWidth(10),
    colWidth(18),
  ]);
};

// ── Hoja 2: Ventas Últimos 12 Meses ─────────────────────────────────────────

const buildLast12Sheet = (data: PoiFolderReportData): XLSX.WorkSheet => {
  const { pois, last12Periods, prev12Periods } = data;
  const monthHeaders = last12Periods.map(monthLabel);

  const aoa: AOA = [
    ["Local", ...monthHeaders, "Total 12m (CLP)", "Prom/mes (CLP)", "YoY"],
  ];

  for (const poi of pois) {
    const monthly = last12Periods.map(p => poi.monthlyCLP[p] ?? 0);
    const total12  = monthly.reduce((a, b) => a + b, 0);
    const avg      = last12Periods.length > 0 ? Math.round(total12 / last12Periods.length) : 0;
    const prev12   = prev12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const yoy      = prev12 > 0 ? ((total12 - prev12) / prev12) * 100 : null;

    aoa.push([
      poi.name,
      ...monthly.map(v => v > 0 ? v : null),
      fmtCLP(total12),
      fmtCLP(avg),
      fmtPctStr(yoy),
    ]);
  }

  // Fila de totales
  const monthTotals = last12Periods.map(p =>
    pois.reduce((s, poi) => s + (poi.monthlyCLP[p] ?? 0), 0),
  );
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);
  const grandAvg   = last12Periods.length > 0 ? Math.round(grandTotal / last12Periods.length) : 0;
  const prevGrand  = pois.reduce((s, poi) =>
    s + prev12Periods.reduce((ss, p) => ss + (poi.monthlyCLP[p] ?? 0), 0), 0);
  const grandYoY   = prevGrand > 0 ? ((grandTotal - prevGrand) / prevGrand) * 100 : null;

  aoa.push([
    "TOTAL",
    ...monthTotals.map(v => v > 0 ? v : null),
    fmtCLP(grandTotal),
    fmtCLP(grandAvg),
    fmtPctStr(grandYoY),
  ]);

  return makeSheet(aoa, [
    colWidth(38),
    ...last12Periods.map(() => colWidth(13)),
    colWidth(20),
    colWidth(18),
    colWidth(10),
  ]);
};

// ── Hoja 3: Histórico Completo ───────────────────────────────────────────────

const buildHistoricoSheet = (data: PoiFolderReportData): XLSX.WorkSheet => {
  const { pois, allPeriods } = data;
  const monthHeaders = allPeriods.map(monthLabel);

  const aoa: AOA = [["Local", ...monthHeaders, "Total (CLP)"]];

  for (const poi of pois) {
    const monthly = allPeriods.map(p => poi.monthlyCLP[p] ?? 0);
    const total   = monthly.reduce((a, b) => a + b, 0);
    aoa.push([poi.name, ...monthly.map(v => v > 0 ? v : null), fmtCLP(total)]);
  }

  const monthTotals = allPeriods.map(p =>
    pois.reduce((s, poi) => s + (poi.monthlyCLP[p] ?? 0), 0));
  aoa.push([
    "TOTAL",
    ...monthTotals.map(v => v > 0 ? v : null),
    fmtCLP(monthTotals.reduce((a, b) => a + b, 0)),
  ]);

  return makeSheet(aoa, [
    colWidth(38),
    ...allPeriods.map(() => colWidth(13)),
    colWidth(18),
  ]);
};

// ── Hoja 4: Performance vs Modelo ───────────────────────────────────────────

const buildPerformanceSheet = (data: PoiFolderReportData): XLSX.WorkSheet => {
  const STATE_LABELS: Record<string, string> = {
    recovered_growing: "▲ Creciendo",
    stable:            "● Estable",
    decelerating:      "↘ Desacelerando",
    not_recovered:     "▼ No recuperado",
    at_risk:           "⚠ En riesgo",
    insufficient_data: "—",
  };

  const aoa: AOA = [
    ["PERFORMANCE VS MODELO PREDICTIVO"],
    [],
    [
      "Local",
      "Ventas Real (UF/mes)",
      "Predicción Modelo A (UF/mes)",
      "Diferencia %",
      "Estado temporal",
      "Driver 1",
      "Driver 2",
      "Driver 3",
    ],
  ];

  for (const poi of data.pois) {
    const drivers = poi.top_drivers.slice(0, 3).map(d =>
      `${d.label}: ${d.contribution_uf > 0 ? "+" : ""}${d.contribution_uf.toFixed(1)} UF`,
    );
    aoa.push([
      poi.name,
      poi.actual_monthly_uf    != null ? Number(poi.actual_monthly_uf.toFixed(2)) : null,
      poi.predicted_monthly_uf != null ? Number(poi.predicted_monthly_uf.toFixed(2)) : null,
      poi.residual_pct         != null ? fmtPctStr(poi.residual_pct) : null,
      poi.temporal_state ? (STATE_LABELS[poi.temporal_state] ?? poi.temporal_state) : null,
      drivers[0] ?? null,
      drivers[1] ?? null,
      drivers[2] ?? null,
    ]);
  }

  return makeSheet(aoa, [
    colWidth(38),
    colWidth(22),
    colWidth(26),
    colWidth(14),
    colWidth(20),
    colWidth(32),
    colWidth(32),
    colWidth(32),
  ]);
};

// ── Función principal exportada ──────────────────────────────────────────────

export const exportFolderReportToXlsx = (data: PoiFolderReportData): void => {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildResumenSheet(data),  sheetName("Resumen Ejecutivo"));
  XLSX.utils.book_append_sheet(wb, buildLast12Sheet(data),   sheetName("Ventas Últ. 12 Meses"));

  if (data.allPeriods.length > 12) {
    XLSX.utils.book_append_sheet(wb, buildHistoricoSheet(data), sheetName("Histórico Completo"));
  }

  if (data.hasPerformanceData) {
    XLSX.utils.book_append_sheet(wb, buildPerformanceSheet(data), sheetName("Performance Modelo"));
  }

  const today    = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `ventas_${slugify(data.folder.name)}_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
};
