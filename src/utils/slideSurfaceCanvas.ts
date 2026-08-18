/**
 * Backend de `SlideSurface` sobre canvas 2D, para exportar la lámina como PNG.
 *
 * Las operaciones se GRABAN y se reproducen al final, en orden, en vez de
 * dibujarse al vuelo. El motivo son las imágenes: cargarlas es asíncrono, y si
 * cada una se dibujara al resolverse terminaría encima del texto que vino
 * después. Grabando y reproduciendo, el orden de apilado es exactamente el
 * mismo que en el .pptx.
 */

import type {
  Cell, HAlign, ImageOpts, LineOpts, RectOpts, SlideSurface, TableOpts, TextOpts, TextRun,
} from "./slideSurface";

const FONT = "Arial";

/**
 * Píxeles por pulgada. Con la lámina de 10×5.625" da 1920×1080: nítida al
 * proyectar y al insertarla como imagen a sangre completa en otro PPT.
 */
export const DEFAULT_DPI = 192;

type Op = (ctx: CanvasRenderingContext2D) => void;

const hex = (c: string) => (c.startsWith("#") ? c : `#${c}`);

export class CanvasSlideSurface implements SlideSurface {
  private readonly ops: Op[] = [];
  /** Imágenes a precargar, en el orden en que se pidieron. */
  private readonly pending: Array<{ data: string; o: ImageOpts }> = [];

  constructor(
    private readonly widthIn: number,
    private readonly heightIn: number,
    private readonly dpi: number = DEFAULT_DPI,
  ) {}

  /** Pulgadas → píxeles. */
  private px(inches: number) { return inches * this.dpi; }
  /** Puntos → píxeles (1 pt = 1/72"). */
  private pt(points: number) { return (points / 72) * this.dpi; }

  private font(sizePt: number, bold?: boolean) {
    return `${bold ? "bold " : ""}${this.pt(sizePt)}px ${FONT}, Helvetica, sans-serif`;
  }

  /** Parte un texto en líneas que caben en `maxW` píxeles. */
  private wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const probe = `${cur} ${words[i]}`;
      if (ctx.measureText(probe).width <= maxW) cur = probe;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines;
  }

  private drawLines(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    box: { x: number; y: number; w: number; h: number },
    align: HAlign,
    valign: "top" | "middle",
    lineH: number,
    padL = 0,
    padR = 0,
  ) {
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    const anchorX =
      align === "left" ? box.x + padL
      : align === "right" ? box.x + box.w - padR
      : box.x + box.w / 2;
    const total = lines.length * lineH;
    // El medio de la PRIMERA línea: de ahí en adelante se avanza `lineH`.
    const firstMid = valign === "middle"
      ? box.y + box.h / 2 - total / 2 + lineH / 2
      : box.y + lineH / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, anchorX, firstMid + i * lineH));
  }

  text(content: string | TextRun[], o: TextOpts): void {
    this.ops.push((ctx) => {
      ctx.save();
      ctx.font = this.font(o.fontSize, o.bold);
      ctx.fillStyle = hex(o.color);
      const box = { x: this.px(o.x), y: this.px(o.y), w: this.px(o.w), h: this.px(o.h) };
      const lineH = this.pt(o.fontSize) * (o.lineSpacingMultiple ?? 1.2);

      const paragraphs = typeof content === "string" ? [content] : content.map((r) => r.text);
      const lines = paragraphs.flatMap((p) => this.wrap(ctx, p, box.w));

      this.drawLines(ctx, lines, box, o.align ?? "left", o.valign ?? "middle", lineH);
      ctx.restore();
    });
  }

  rect(o: RectOpts): void {
    this.ops.push((ctx) => {
      ctx.save();
      const x = this.px(o.x), y = this.px(o.y), w = this.px(o.w), h = this.px(o.h);
      if (o.fill) { ctx.fillStyle = hex(o.fill); ctx.fillRect(x, y, w, h); }
      if (o.line) {
        ctx.strokeStyle = hex(o.line.color);
        ctx.lineWidth = Math.max(1, this.pt(o.line.width ?? 1));
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    });
  }

  line(o: LineOpts): void {
    this.ops.push((ctx) => {
      ctx.save();
      ctx.strokeStyle = hex(o.color);
      ctx.lineWidth = Math.max(1, this.pt(o.width ?? 1));
      const y = this.px(o.y);
      ctx.beginPath();
      ctx.moveTo(this.px(o.x), y);
      ctx.lineTo(this.px(o.x + o.w), y);
      ctx.stroke();
      ctx.restore();
    });
  }

  table(rows: Cell[][], o: TableOpts): void {
    this.ops.push((ctx) => {
      ctx.save();
      const rowHpx = this.px(o.rowH);
      rows.forEach((cells, r) => {
        let cx = this.px(o.x);
        const cy = this.px(o.y) + r * rowHpx;
        cells.forEach((cell, c) => {
          const cw = this.px(o.colW[c] ?? 0);
          const op = cell.options;
          if (op.fill) { ctx.fillStyle = hex(op.fill); ctx.fillRect(cx, cy, cw, rowHpx); }
          if (o.border) {
            ctx.strokeStyle = hex(o.border.color);
            ctx.lineWidth = Math.max(1, this.pt(o.border.pt));
            ctx.strokeRect(cx, cy, cw, rowHpx);
          }
          ctx.font = this.font(op.fontSize, op.bold);
          ctx.fillStyle = hex(op.color);
          const padL = this.pt(op.margin[3]);
          const padR = this.pt(op.margin[1]);
          // Una sola línea por celda: el ancho de columna está calculado para
          // que entre, y dejar que envuelva desbordaría la fila hacia la de
          // abajo, que en esta lámina es fija.
          this.drawLines(
            ctx, [cell.text], { x: cx, y: cy, w: cw, h: rowHpx },
            op.align ?? "left", "middle", rowHpx, padL, padR,
          );
          cx += cw;
        });
      });
      ctx.restore();
    });
  }

  image(o: ImageOpts): void {
    const idx = this.pending.length;
    this.pending.push({ data: o.data, o });
    this.ops.push((ctx) => {
      const img = this.loaded[idx];
      if (!img) return;
      const x = this.px(o.x), y = this.px(o.y), w = this.px(o.w), h = this.px(o.h);
      // `cover`: escala para tapar la caja y recorta el excedente centrado,
      // igual que el `sizing: cover` del .pptx.
      const scale = Math.max(w / img.width, h / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
    });
  }

  private loaded: Array<HTMLImageElement | null> = [];

  /** Reproduce todo y devuelve el PNG como data URL. */
  async toPng(): Promise<string> {
    this.loaded = await Promise.all(
      this.pending.map(
        ({ data }) =>
          new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            // Una captura que no carga no debe tumbar el informe entero: se
            // omite y la lámina sale con el resto.
            img.onerror = () => resolve(null);
            img.src = data;
          }),
      ),
    );

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(this.px(this.widthIn));
    canvas.height = Math.round(this.px(this.heightIn));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el contexto 2D para exportar la lámina");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const op of this.ops) op(ctx);

    return canvas.toDataURL("image/png");
  }
}
