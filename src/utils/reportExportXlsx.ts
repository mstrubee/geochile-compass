import * as XLSX from "xlsx";
import type { IsochroneReport, IsochroneBandReport } from "./reportData";

const fmt = (n: number) => Math.round(n);
const fmtPct = (frac: number) => Math.round(frac * 1000) / 10; // 0..100, 1 decimal

const sheetFromAOA = (aoa: (string | number | null)[][]) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colCount = aoa.reduce((m, r) => Math.max(m, r.length), 0);
  ws["!cols"] = Array.from({ length: colCount }, () => ({ wch: 22 }));
  return ws;
};

const buildResumenAOA = (
  report: IsochroneReport,
  band: IsochroneBandReport,
): (string | number | null)[][] => {
  const r = report;
  return [
    ["Informe de isócrona"],
    [],
    ["ID", r.iso.id],
    ["Modo", r.iso.modeLabel],
    ["Bandas (min)", r.iso.minutes.join(", ")],
    ["Centro lat", r.iso.centerLat],
    ["Centro lng", r.iso.centerLng],
    ["Generado", new Date(r.generatedAt).toISOString()],
    [],
    ["Banda analizada (min)", band.bandMinutes],
    ["Área (km²)", Number(band.area_km2.toFixed(3))],
    ["Personas", fmt(band.totals.pop)],
    ["Hogares", fmt(band.totals.hh)],
    ["Ingreso total mensual (CLP)", fmt(band.totals.incomeTotal)],
    ["Ingreso promedio por hogar (CLP)", fmt(band.totals.incomeAvgPerHh)],
    ["Densidad poblacional (hab/km²)", fmt(band.density.popPerKm2)],
    ["Densidad hogares (hog/km²)", fmt(band.density.hhPerKm2)],
    [
      "Fuente población",
      band.totals.source === "manzanas" ? "Manzanas (Censo)" : "Estimación comunal proporcional",
    ],
  ];
};

const buildComunasAOA = (
  band: IsochroneBandReport,
): (string | number | null)[][] => {
  const rows: (string | number | null)[][] = [];
  rows.push([
    "Comuna",
    "% del área de la iso",
    "% del área comuna en iso",
    "Población comuna",
    "Hogares comuna (estimado)",
    "Ingreso/hogar (CLP)",
    "NSE",
    "Personas en iso",
    "Hogares en iso",
    "Ingreso en iso (CLP)",
  ]);
  for (const c of band.communes) {
    rows.push([
      c.name,
      fmtPct(c.areaShareInIso),
      fmtPct(c.areaShareOfCommune),
      c.poblacion ?? null,
      c.hogares ?? null,
      c.ingreso ?? null,
      c.nse ?? null,
      fmt(c.popInIso),
      fmt(c.hhInIso),
      fmt(c.incomeInIso),
    ]);
  }
  return rows;
};

const buildNseAOA = (
  band: IsochroneBandReport,
): (string | number | null)[][] => {
  const rows: (string | number | null)[][] = [["NSE", "% del área de iso"]];
  for (const n of band.nseDistribution) rows.push([n.label, n.pct]);
  if (band.gse) {
    rows.push([]);
    rows.push(["Indicadores GSE (manzanas)"]);
    if (band.gse.educYearsAvg != null)
      rows.push(["Escolaridad promedio (años)", Number(band.gse.educYearsAvg.toFixed(2))]);
    if (band.gse.hacinAvg != null)
      rows.push(["Hacinamiento promedio", Number(band.gse.hacinAvg.toFixed(2))]);
    if (band.gse.nseScoreAvg != null)
      rows.push(["Score NSE promedio (0-1000)", Math.round(band.gse.nseScoreAvg)]);
    if (band.gse.autoScoreAvg != null)
      rows.push(["Score automóvil", Number(band.gse.autoScoreAvg.toFixed(2))]);
  }
  return rows;
};

const buildPointsAOA = (
  band: IsochroneBandReport,
): (string | number | null)[][] => {
  const rows: (string | number | null)[][] = [];
  rows.push(["Resumen por capa territorial"]);
  rows.push(["Grupo", "Capa", "Cantidad"]);
  for (const g of band.pointsByGroup) {
    for (const l of g.layers) rows.push([g.groupName, l.layerName, l.count]);
  }
  rows.push([]);
  rows.push(["Detalle de puntos territoriales"]);
  rows.push(["Grupo", "Capa", "Nombre", "Lat", "Lng"]);
  for (const p of band.pointsDetail) {
    rows.push([
      p.groupName,
      p.layerName,
      p.name ?? "(sin nombre)",
      p.lat,
      p.lng,
    ]);
  }
  return rows;
};

const buildCommerceAOA = (
  band: IsochroneBandReport,
): (string | number | null)[][] => {
  const rows: (string | number | null)[][] = [];
  rows.push(["Resumen por categoría"]);
  rows.push(["Categoría", "Cantidad"]);
  for (const c of band.commerceCountsByCategory)
    rows.push([c.label, c.count]);
  rows.push([]);
  rows.push(["Detalle de comercios"]);
  rows.push([
    "Categoría",
    "Nombre",
    "Marca",
    "Dirección",
    "Teléfono",
    "Sitio web",
    "Horario",
    "Lat",
    "Lng",
  ]);
  for (const c of band.commerceItemsInBand) {
    rows.push([
      c.categoryLabel,
      c.name,
      c.brand ?? "",
      c.address ?? "",
      c.phone ?? "",
      c.website ?? "",
      c.openingHours ?? "",
      c.lat,
      c.lng,
    ]);
  }
  return rows;
};

/** Sanitiza nombre de hoja Excel (límite 31 chars, sin :, /, \, ?, *, [, ]) */
const sheetName = (raw: string) =>
  raw.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

/** Genera y descarga el .xlsx del informe completo. */
export const exportReportToXlsx = (report: IsochroneReport): void => {
  const wb = XLSX.utils.book_new();

  // Hoja "Resumen" con info general + un bloque por banda.
  const generalAOA: (string | number | null)[][] = [
    ["Informe de isócrona"],
    ["ID", report.iso.id],
    ["Modo", report.iso.modeLabel],
    ["Bandas (min)", report.iso.minutes.join(", ")],
    ["Centro", `${report.iso.centerLat}, ${report.iso.centerLng}`],
    ["Generado", new Date(report.generatedAt).toLocaleString("es-CL")],
    [],
    [
      "Banda (min)",
      "Área km²",
      "Personas",
      "Hogares",
      "Ingreso total CLP",
      "Ingreso/hogar CLP",
      "Densidad hab/km²",
      "Fuente",
    ],
  ];
  for (const b of report.bands) {
    generalAOA.push([
      b.bandMinutes,
      Number(b.area_km2.toFixed(3)),
      fmt(b.totals.pop),
      fmt(b.totals.hh),
      fmt(b.totals.incomeTotal),
      fmt(b.totals.incomeAvgPerHh),
      fmt(b.density.popPerKm2),
      b.totals.source,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromAOA(generalAOA), "Resumen");

  // Por cada banda, hojas dedicadas.
  for (const band of report.bands) {
    const tag = `${band.bandMinutes}min`;
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromAOA(buildResumenAOA(report, band)),
      sheetName(`Banda ${tag}`),
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromAOA(buildComunasAOA(band)),
      sheetName(`Comunas ${tag}`),
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromAOA(buildNseAOA(band)),
      sheetName(`NSE ${tag}`),
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromAOA(buildPointsAOA(band)),
      sheetName(`Puntos ${tag}`),
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromAOA(buildCommerceAOA(band)),
      sheetName(`Comercios ${tag}`),
    );
  }

  const filename = `informe-isocrona-${report.iso.id}.xlsx`;
  XLSX.writeFile(wb, filename);
};
