/**
 * BrandStyleEditorDialog
 * ─────────────────────
 * Dialog para editar el color, ícono y tamaño de marcador de una carpeta, capa
 * o marca ("Editar estilo"). El ícono se elige de un emoji, de la biblioteca
 * compartida de PNG (la misma para toda carpeta; "Subir" agrega uno o varios) o
 * de una URL.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import type { BrandStyle } from "@/hooks/useBrandStyles";
import { defaultColorForBrand } from "@/hooks/useBrandStyles";
import { useLayerIconLibrary } from "@/hooks/useLayerIconLibrary";
import { useUserRole } from "@/hooks/useUserRole";
import { MAX_ICON_BYTES } from "@/services/layerIconLibrary";

// ── Presets ──────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  "#367C2B", "#003B7B", "#C41230", "#E8701A", "#B5CC18",
  "#F59E0B", "#EF4444", "#3B82F6", "#10B981", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316", "#6B7280", "#1E40AF",
];

const ICON_PRESETS = [
  "🚜","🌾","🌱","🏭","🔧","🔩","⚙️","🛞","🚛","🚚",
  "🏗","🔑","📍","⭐","🏆","⚠️","✅","🔴","🟡","🟢",
  "🔵","🟠","🟣","⚫","⚪","🟤","🌿","🍃","🌻","🌽",
  "🐄","🐎","🐑","🐖","🐓","🏠","🏢","🏬","📦","🔋",
];

// ── Preview marker HTML (reproducido sin canvas, solo CSS) ───────────────────

const previewMarkerHtml = (style: BrandStyle, num: number): string => {
  const { color, icon, iconSize } = style;
  const s = Math.max(12, Math.min(40, iconSize));
  const isUrl = !!icon && (icon.startsWith("http") || icon.startsWith("/") || icon.startsWith("data:"));
  const isEmoji = !!icon && !isUrl;

  if (isUrl) {
    return `
      <div style="position:relative;display:inline-block;width:${s}px;height:${s}px">
        <img src="${icon}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;box-shadow:0 1px 4px rgba(0,0,0,.4)" />
        <div style="position:absolute;bottom:-2px;right:-4px;width:11px;height:11px;background:${color};border:1.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6.5px;font-weight:700;color:white;font-family:system-ui">${num}</div>
      </div>`;
  }
  return `
    <div style="width:${s}px;height:${s}px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,.4);font-family:system-ui;line-height:1">
      ${isEmoji
        ? `<span style="font-size:${Math.max(9, s * 0.55)}px">${icon}</span>`
        : `<span style="font-size:${Math.max(7, s * 0.45)}px;font-weight:700;color:white">${num}</span>`}
    </div>`;
};

// ── Biblioteca de íconos PNG (compartida por todas las carpetas) ─────────────

const LIBRARY_ACCEPT = "image/png,.png,application/zip,.zip";

interface LibraryProps {
  selected: string | null;
  onPick: (url: string) => void;
}

/** Se monta solo con el diálogo abierto: así la lista del bucket no se pide antes de tiempo. */
const IconLibrary = ({ selected, onPick }: LibraryProps) => {
  const { icons, isLoading, isError, upload, remove } = useLayerIconLibrary();
  const { isAdmin } = useUserRole();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite elegir el mismo archivo otra vez
    if (!files.length) return;
    try {
      const { uploaded, rejected } = await upload.mutateAsync(files);
      if (uploaded.length) {
        toast.success(uploaded.length === 1 ? "Ícono subido" : `${uploaded.length} íconos subidos`, {
          description: "Ya están disponibles para todas las carpetas.",
        });
        if (uploaded.length === 1) onPick(uploaded[0].url);
      }
      if (rejected.length) {
        const shown = rejected.slice(0, 4).map((r) => `${r.name}: ${r.reason}`);
        if (rejected.length > shown.length) shown.push(`…y ${rejected.length - shown.length} más`);
        toast.error(`${rejected.length} ${rejected.length === 1 ? "archivo no se subió" : "archivos no se subieron"}`, {
          description: shown.join("\n"),
        });
      }
    } catch (err) {
      toast.error("No se pudieron subir los íconos", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRemove = (path: string, label: string) => {
    if (!window.confirm(`¿Eliminar el ícono “${label}” de la biblioteca? Dejará de verse en las carpetas que lo usan.`)) return;
    remove.mutate(path, {
      onError: (err) => toast.error("No se pudo eliminar el ícono", { description: err.message }),
    });
  };

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Biblioteca de íconos PNG{icons.length ? ` (${icons.length})` : ""} — la ven todas las carpetas
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-2/60 px-3 py-1.5 text-[12px] font-semibold text-foreground transition hover:bg-surface-3 disabled:cursor-wait disabled:opacity-60"
          title="Subir uno o varios PNG, o un ZIP con PNG (máx. 512 KB cada uno)"
        >
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "📂"}
          {upload.isPending ? "Subiendo…" : "SUBIR"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={LIBRARY_ACCEPT}
          multiple
          aria-label="Subir íconos PNG"
          className="hidden"
          onChange={(e) => void handleFiles(e)}
        />
      </div>
      <div className="grid max-h-[200px] grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5 overflow-y-auto rounded-md bg-surface-2/60 p-2">
        {isLoading && <p className="col-span-full py-3 text-center text-[11px] text-muted-foreground">Cargando íconos…</p>}
        {isError && <p className="col-span-full py-3 text-center text-[11px] text-destructive">No se pudo cargar la biblioteca.</p>}
        {!isLoading && !isError && !icons.length && (
          <p className="col-span-full py-3 text-center text-[11px] text-muted-foreground">
            Aún no hay íconos. Usa SUBIR para agregar PNG (uno, varios o un ZIP).
          </p>
        )}
        {icons.map((icon) => (
          <div key={icon.path} className="group relative">
            <button
              type="button"
              onClick={() => onPick(icon.url)}
              title={icon.label}
              aria-label={`Usar ícono ${icon.label}`}
              aria-pressed={selected === icon.url}
              className={[
                "flex h-[52px] w-full items-center justify-center rounded-md p-1.5 transition-all hover:bg-surface-3",
                selected === icon.url ? "bg-surface-3 ring-2 ring-primary" : "",
              ].join(" ")}
            >
              <img src={icon.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleRemove(icon.path, icon.label)}
                aria-label={`Eliminar ícono ${icon.label}`}
                title="Eliminar de la biblioteca"
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] leading-none text-white group-hover:flex"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Solo PNG, hasta {Math.round(MAX_ICON_BYTES / 1024)} KB cada uno. Puedes elegir varios a la vez o un ZIP.
      </p>
    </div>
  );
};

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  brand: string | null;           // null = cerrado
  currentStyle: BrandStyle | null;
  onSave: (brand: string, style: BrandStyle) => void;
  onReset: (brand: string) => void;
  onClose: () => void;
}

// ── Componente ───────────────────────────────────────────────────────────────

export const BrandStyleEditorDialog = ({ brand, currentStyle, onSave, onReset, onClose }: Props) => {
  const [draft, setDraft] = useState<BrandStyle>({
    color:    "#6B7280",
    icon:     null,
    iconSize: 18,
    visible:  true,
  });
  const [urlInput, setUrlInput]   = useState("");
  const [hexInput, setHexInput]   = useState("");

  // Sincronizar draft cuando abre el dialog
  useEffect(() => {
    if (!brand || !currentStyle) return;
    setDraft({ ...currentStyle });
    setUrlInput(currentStyle.icon && !ICON_PRESETS.includes(currentStyle.icon) && currentStyle.icon !== ""
      ? currentStyle.icon
      : "");
    setHexInput(currentStyle.color ?? defaultColorForBrand(brand));
  }, [brand, currentStyle]);

  const isOpen = !!brand;
  const isUrl  = (s: string | null) => !!s && (s.startsWith("http") || s.startsWith("/") || s.startsWith("data:"));

  const applyUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) { setDraft((d) => ({ ...d, icon: null })); return; }
    if (trimmed.startsWith("http") || trimmed.startsWith("/") || trimmed.startsWith("data:")) {
      setDraft((d) => ({ ...d, icon: trimmed }));
    }
  };

  const applyHex = () => {
    if (/^#[0-9A-Fa-f]{3,6}$/.test(hexInput.trim())) {
      setDraft((d) => ({ ...d, color: hexInput.trim() }));
    }
  };

  if (!brand || !currentStyle) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl gap-5 overflow-y-auto border border-border/50 bg-surface/95 p-8 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">
            ✏️ Editar estilo — {brand}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-1">

          {/* ─── Color ─────────────────────────────────────────────────── */}
          <section>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Color
            </label>
            <div className="mb-3 flex flex-wrap gap-2.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setDraft((d) => ({ ...d, color: c })); setHexInput(c); }}
                  className="h-8 w-8 rounded-full border-2 transition-all hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: draft.color === c ? "white" : "transparent",
                    boxShadow: draft.color === c ? `0 0 0 2px ${c}` : "none",
                  }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <div
                className="h-9 w-9 flex-shrink-0 rounded-md border border-border/50"
                style={{ backgroundColor: draft.color }}
              />
              <input
                type="text"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                onBlur={applyHex}
                onKeyDown={(e) => e.key === "Enter" && applyHex()}
                placeholder="#RRGGBB"
                className="flex-1 rounded-md border border-border/60 bg-surface-2/60 px-3 py-2 font-mono text-[13px] outline-none focus:border-primary"
              />
              <input
                type="color"
                value={draft.color}
                onChange={(e) => { setDraft((d) => ({ ...d, color: e.target.value })); setHexInput(e.target.value); }}
                className="h-9 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Selector de color"
              />
            </div>
          </section>

          {/* ─── Ícono ─────────────────────────────────────────────────── */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ícono
              </label>
              {draft.icon && (
                <button
                  type="button"
                  onClick={() => { setDraft((d) => ({ ...d, icon: null })); setUrlInput(""); }}
                  className="text-[12px] text-muted-foreground hover:text-foreground"
                >
                  ✕ Usar número
                </button>
              )}
            </div>
            {/* Emoji grid */}
            <div className="mb-3 flex max-h-[120px] flex-wrap gap-1 overflow-y-auto rounded-md bg-surface-2/60 p-2">
              {ICON_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { setDraft((d) => ({ ...d, icon: emoji })); setUrlInput(""); }}
                  className={[
                    "flex h-9 w-9 items-center justify-center rounded text-[20px] transition-all hover:bg-surface-3",
                    draft.icon === emoji ? "bg-surface-3 ring-1 ring-primary" : "",
                  ].join(" ")}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {/* Biblioteca compartida de PNG (SUBIR vive aquí) */}
            <IconLibrary
              selected={draft.icon}
              onPick={(url) => { setDraft((d) => ({ ...d, icon: url })); setUrlInput(""); }}
            />
            {/* URL de una imagen externa */}
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={applyUrl}
              onKeyDown={(e) => e.key === "Enter" && applyUrl()}
              placeholder="…o pega la URL de una imagen (https://…)"
              className="w-full rounded-md border border-border/60 bg-surface-2/60 px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
            {isUrl(draft.icon) && (
              <p className="mt-1.5 text-[11px] text-text-muted/70">
                Imagen seleccionada — se mostrará con número en badge inferior derecho.
              </p>
            )}
          </section>

          {/* ─── Tamaño ────────────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tamaño del ícono
              </label>
              <span className="font-mono text-[13px] text-foreground">{draft.iconSize}px</span>
            </div>
            <Slider
              min={12}
              max={40}
              step={1}
              value={[draft.iconSize]}
              onValueChange={([v]) => setDraft((d) => ({ ...d, iconSize: v }))}
              className="w-full"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/60">
              <span>12px</span><span>40px</span>
            </div>
          </section>

          {/* ─── Vista previa ──────────────────────────────────────────── */}
          <section>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vista previa
            </label>
            <div className="flex items-center gap-4 rounded-md bg-surface-2/60 px-4 py-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  dangerouslySetInnerHTML={{ __html: previewMarkerHtml(draft, n) }}
                />
              ))}
              <div className="ml-2 text-[12px] text-muted-foreground">
                # marca · {brand}
              </div>
            </div>
          </section>

        </div>

        {/* ─── Acciones ──────────────────────────────────────────────────── */}
        <div className="flex justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => { onReset(brand!); onClose(); }}
            className="rounded-md border border-border/50 px-4 py-2 text-[13px] text-muted-foreground transition hover:bg-surface-2/60 hover:text-foreground"
          >
            ↩ Restaurar
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border/50 px-4 py-2 text-[13px] text-muted-foreground transition hover:bg-surface-2/60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => { onSave(brand!, draft); onClose(); }}
              className="rounded-md bg-primary px-6 py-2 text-[13px] font-medium text-primary-foreground transition hover:opacity-90"
            >
              Guardar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
