/**
 * reportExportPng.ts
 * ==================
 * Segunda salida del informe de directorio: las MISMAS 2 láminas, pero como
 * imágenes PNG en vez de un .pptx.
 *
 * Existe porque leaseflow-pro necesita insertar estas láminas dentro del PPT
 * del Informe Directorio, y pptxgenjs —la librería con la que ese PPT se
 * arma— no sabe LEER un .pptx: su API es solo de generación (`addSlide`,
 * `write`, `writeFile`). No hay forma de importar láminas de otro archivo.
 * Con PNG el problema desaparece: leaseflow las coloca a sangre completa en
 * dos láminas que crea él.
 *
 * Las láminas NO se redibujan acá. Se ejecutan los mismos `drawTerritorySlide`
 * / `drawProjectionSlide` que produce el .pptx, contra un backend de canvas
 * (ver slideSurface.ts). Esa es la garantía de que el PNG y el PPT muestren lo
 * mismo.
 */

import type { IsochroneReport, ReportProjection } from "./reportData";
import type { MapCaptureImages } from "./mapCapture";
import {
  drawProjectionSlide,
  drawTerritorySlide,
  SLIDE_H,
  SLIDE_W,
} from "./reportExportPptx";
import { CanvasSlideSurface, DEFAULT_DPI } from "./slideSurfaceCanvas";

export interface ReportSlidePng {
  /** 1 = territorial, 2 = proyección. */
  index: number;
  /** Título de la lámina, para nombrar el archivo y mostrarlo en la UI. */
  title: string;
  /** PNG como data URL (`data:image/png;base64,…`). */
  dataUrl: string;
}

/**
 * Renderiza el informe como PNG, una imagen por lámina.
 *
 * Devuelve 2 imágenes cuando hay proyección calculada y 1 cuando no — igual
 * que el .pptx, que también omite la segunda lámina en ese caso.
 */
export const exportReportToPng = async (
  report: IsochroneReport,
  projection: ReportProjection | null,
  images?: MapCaptureImages | null,
  dpi: number = DEFAULT_DPI,
): Promise<ReportSlidePng[]> => {
  const out: ReportSlidePng[] = [];

  const territory = new CanvasSlideSurface(SLIDE_W, SLIDE_H, dpi);
  drawTerritorySlide(territory, report, images);
  out.push({ index: 1, title: "Análisis territorial", dataUrl: await territory.toPng() });

  if (projection) {
    const proj = new CanvasSlideSurface(SLIDE_W, SLIDE_H, dpi);
    drawProjectionSlide(proj, report, projection);
    out.push({
      index: 2,
      title: "Potencial económico y proyección",
      dataUrl: await proj.toPng(),
    });
  }

  return out;
};

/** Nombre de archivo estable para una lámina, del mismo estilo que el .pptx. */
export const slidePngFileName = (report: IsochroneReport, index: number): string => {
  const fecha = new Date(report.generatedAt).toISOString().slice(0, 10).replace(/-/g, "");
  const base = (report.iso.name ?? "isocrona").replace(/[^\w-]+/g, "_");
  return `informe-${base}-${fecha}-lamina${index}.png`;
};
