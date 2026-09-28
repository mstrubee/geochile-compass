/**
 * Tamaño real de un PNG en data URL, sin decodificarlo.
 *
 * Las fotos del mapa salen del tamaño que tenga el contenedor en pantalla, que
 * cambia con el ancho del panel y de la ventana. Dibujarlas en un recuadro
 * fijo las deforma, así que hay que conocer su proporción antes de ubicarlas.
 * El encabezado IHDR del PNG trae ancho y alto en los bytes 16 a 24, o sea que
 * basta con leer el principio del base64.
 */
const bytesIniciales = (b64: string, cuantos: number): Uint8Array | null => {
  // 4 caracteres base64 = 3 bytes.
  const trozo = b64.slice(0, Math.ceil(cuantos / 3) * 4);
  try {
    const bin =
      typeof atob === "function"
        ? atob(trozo)
        : Buffer.from(trozo, "base64").toString("binary");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

export interface Size { w: number; h: number }

export const pngSize = (dataUrl: string | null | undefined): Size | null => {
  if (!dataUrl) return null;
  const coma = dataUrl.indexOf(",");
  if (coma < 0 || !dataUrl.slice(0, coma).includes("base64")) return null;
  const b = bytesIniciales(dataUrl.slice(coma + 1), 24);
  if (!b || b.length < 24) return null;
  // Firma PNG: 89 50 4E 47.
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const leer = (i: number) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
  const w = leer(16);
  const h = leer(20);
  return w > 0 && h > 0 ? { w, h } : null;
};

/**
 * Recuadro centrado dentro de `caja` que respeta la proporción de `img`.
 * Sin el tamaño de la imagen devuelve la caja completa: mejor llenar el hueco
 * que dejar la lámina con un espacio vacío sin explicación.
 */
export const fitContain = (
  caja: { x: number; y: number; w: number; h: number },
  img: Size | null,
): { x: number; y: number; w: number; h: number } => {
  if (!img) return caja;
  const escala = Math.min(caja.w / img.w, caja.h / img.h);
  const w = img.w * escala;
  const h = img.h * escala;
  return { x: caja.x + (caja.w - w) / 2, y: caja.y + (caja.h - h) / 2, w, h };
};
