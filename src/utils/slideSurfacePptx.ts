/**
 * Backend de `SlideSurface` sobre pptxgenjs: traduce cada primitiva a la
 * llamada equivalente de la librería. Es un adaptador delgado a propósito —
 * la superficie se diseñó calcando lo que el informe ya usaba.
 */

import type PptxGenJS from "pptxgenjs";
import type {
  Cell, ImageOpts, LineOpts, RectOpts, SlideSurface, TableOpts, TextOpts, TextRun,
} from "./slideSurface";

const FONT = "Arial";

export class PptxSlideSurface implements SlideSurface {
  constructor(private readonly slide: PptxGenJS.Slide) {}

  text(content: string | TextRun[], o: TextOpts): void {
    const common = {
      x: o.x, y: o.y, w: o.w, h: o.h,
      fontFace: FONT, fontSize: o.fontSize, bold: o.bold, color: o.color,
      align: o.align, valign: o.valign, margin: 0,
      lineSpacingMultiple: o.lineSpacingMultiple,
    };
    if (typeof content === "string") {
      this.slide.addText(content, common as never);
      return;
    }
    this.slide.addText(
      content.map((r) => ({ text: r.text, options: { breakLine: r.breakLine } })),
      common as never,
    );
  }

  rect(o: RectOpts): void {
    this.slide.addShape("rect" as never, {
      x: o.x, y: o.y, w: o.w, h: o.h,
      fill: o.fill ? { color: o.fill } : undefined,
      line: o.line ? { color: o.line.color, width: o.line.width } : undefined,
    } as never);
  }

  line(o: LineOpts): void {
    this.slide.addShape("line" as never, {
      x: o.x, y: o.y, w: o.w, h: 0,
      line: { color: o.color, width: o.width ?? 1 },
    } as never);
  }

  table(rows: Cell[][], o: TableOpts): void {
    this.slide.addTable(
      rows.map((r) =>
        r.map((c) => ({
          text: c.text,
          options: {
            fontFace: FONT,
            fontSize: c.options.fontSize,
            bold: c.options.bold,
            color: c.options.color,
            fill: c.options.fill ? { color: c.options.fill } : undefined,
            align: c.options.align,
            valign: c.options.valign,
            margin: c.options.margin,
          },
        })),
      ) as never,
      {
        x: o.x, y: o.y, w: o.w, colW: o.colW, rowH: o.rowH,
        border: o.border ? { type: "solid", color: o.border.color, pt: o.border.pt } : undefined,
      } as never,
    );
  }

  image(o: ImageOpts): void {
    this.slide.addImage({
      data: o.data, x: o.x, y: o.y, w: o.w, h: o.h,
      sizing: { type: "cover", w: o.w, h: o.h },
    } as never);
  }
}
