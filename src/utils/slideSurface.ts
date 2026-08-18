/**
 * slideSurface.ts
 * ===============
 * Superficie de dibujo de una lámina, en PULGADAS.
 *
 * Existe para que el informe de directorio se defina UNA sola vez y pueda
 * salir por dos destinos: el .pptx que se descarga y los PNG que consume
 * leaseflow. La alternativa —escribir las láminas dos veces, una con
 * pptxgenjs y otra en canvas— garantizaba que tarde o temprano el PNG dijera
 * algo distinto del PPT, que es justo lo que no puede pasar cuando las dos
 * cosas terminan en la misma presentación de directorio.
 *
 * Las coordenadas van en pulgadas y los tamaños de letra en puntos, que es la
 * unidad nativa de pptxgenjs; el backend de canvas convierte a píxeles.
 */

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle";

/** Colores en hex SIN `#`, como los espera pptxgenjs. */
export type Hex = string;

export interface TextRun {
  text: string;
  /** Corta línea después de este run. */
  breakLine?: boolean;
}

export interface TextOpts {
  x: number; y: number; w: number; h: number;
  /** Puntos. */
  fontSize: number;
  bold?: boolean;
  color: Hex;
  align?: HAlign;
  valign?: VAlign;
  lineSpacingMultiple?: number;
}

/** Márgenes de celda en puntos: [arriba, derecha, abajo, izquierda]. */
export type CellMargin = [number, number, number, number];

export interface CellOpts {
  fontSize: number;
  bold?: boolean;
  color: Hex;
  fill?: Hex;
  align?: HAlign;
  valign?: VAlign;
  margin: CellMargin;
}

export interface Cell {
  text: string;
  options: CellOpts;
}

export interface TableOpts {
  x: number; y: number; w: number;
  /** Ancho de cada columna, en pulgadas. Debe sumar `w`. */
  colW: number[];
  /** Alto de fila, en pulgadas. */
  rowH: number;
  border?: { color: Hex; pt: number };
}

export interface RectOpts {
  x: number; y: number; w: number; h: number;
  fill?: Hex;
  line?: { color: Hex; width?: number };
}

export interface LineOpts {
  x: number; y: number; w: number;
  color: Hex;
  width?: number;
}

export interface ImageOpts {
  /** Data URL. */
  data: string;
  x: number; y: number; w: number; h: number;
}

/**
 * Lo que una lámina sabe dibujar. Es deliberadamente chico: son las únicas
 * primitivas que el informe usa, y mantenerlo así es lo que hace barato tener
 * dos backends.
 */
export interface SlideSurface {
  text(content: string | TextRun[], opts: TextOpts): void;
  rect(opts: RectOpts): void;
  line(opts: LineOpts): void;
  table(rows: Cell[][], opts: TableOpts): void;
  image(opts: ImageOpts): void;
}
