/**
 * Venta mensual en millones de pesos, para tablas angostas.
 *
 * $94.045.442 se escribe "94". Los montos de venta de un local viven en las
 * decenas o centenas de millones, así que el peso exacto no aporta y sí gasta
 * el ancho que la columna no tiene. Bajo el millón se marca "<1" en vez de
 * redondear a "0", que se leería como un local sin venta.
 */
export const ventaMM = (clp: number | null | undefined): string => {
  if (!clp || clp <= 0) return "—";
  const mm = clp / 1_000_000;
  if (mm < 1) return "<1";
  return Math.round(mm).toLocaleString("es-CL");
};

/** Encabezado de esa columna, para que diga lo mismo en todos los informes. */
export const VENTA_MM_LABEL = "mm$/mes";
