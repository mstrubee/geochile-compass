interface Props {
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: number;
}

const isImageUrl = (v: string | null | undefined): string | null => {
  if (!v) return null;
  if (v.startsWith("data:image/")) return v;
  if (/^https?:\/\//i.test(v) && /\.(png|jpe?g|gif|svg|webp)(\?.*)?$/i.test(v)) return v;
  return null;
};

/**
 * Previsualiza el marker tal y como se verá en el mapa:
 * - Si `icon` es URL/data:image válida → imagen.
 * - En caso contrario → círculo del color elegido (mismo render que SavedPoisLayer).
 */
export const PoiIconPreview = ({ icon, color, size = 32 }: Props) => {
  const url = isImageUrl(icon);
  if (url) {
    return (
      <img
        src={url}
        alt="icono"
        width={size}
        height={size}
        className="rounded-md border border-border bg-surface-2 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full border-2 border-white shadow"
      style={{
        width: size,
        height: size,
        backgroundColor: color || "#34D399",
      }}
      aria-label="Icono por defecto (círculo)"
    />
  );
};
