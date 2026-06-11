/**
 * BrandStyleEditorDialog
 * ─────────────────────
 * Dialog para editar el color, ícono y tamaño de marcador por marca
 * en la capa de Competidores de Maquinaria Agrícola.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import type { BrandStyle } from "@/hooks/useBrandStyles";
import { defaultColorForBrand } from "@/hooks/useBrandStyles";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setDraft((d) => ({ ...d, icon: dataUrl }));
      setUrlInput(dataUrl.slice(0, 30) + "…");
    };
    reader.readAsDataURL(file);
  };

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
      <DialogContent className="max-w-sm border border-border/50 bg-surface/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            ✏️ Editar estilo — {brand}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* ─── Color ─────────────────────────────────────────────────── */}
          <section>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Color
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setDraft((d) => ({ ...d, color: c })); setHexInput(c); }}
                  className="h-5 w-5 rounded-full border-2 transition-all hover:scale-110"
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
                className="h-7 w-7 flex-shrink-0 rounded-md border border-border/50"
                style={{ backgroundColor: draft.color }}
              />
              <input
                type="text"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                onBlur={applyHex}
                onKeyDown={(e) => e.key === "Enter" && applyHex()}
                placeholder="#RRGGBB"
                className="flex-1 rounded-md border border-border/60 bg-surface-2/60 px-2 py-1 font-mono text-[11px] outline-none focus:border-primary"
              />
              <input
                type="color"
                value={draft.color}
                onChange={(e) => { setDraft((d) => ({ ...d, color: e.target.value })); setHexInput(e.target.value); }}
                className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Selector de color"
              />
            </div>
          </section>

          {/* ─── Ícono ─────────────────────────────────────────────────── */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ícono
              </label>
              {draft.icon && (
                <button
                  type="button"
                  onClick={() => { setDraft((d) => ({ ...d, icon: null })); setUrlInput(""); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  ✕ Usar número
                </button>
              )}
            </div>
            {/* Emoji grid */}
            <div className="mb-2 flex max-h-[72px] flex-wrap gap-0.5 overflow-y-auto rounded-md bg-surface-2/60 p-1.5">
              {ICON_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { setDraft((d) => ({ ...d, icon: emoji })); setUrlInput(""); }}
                  className={[
                    "flex h-7 w-7 items-center justify-center rounded text-[15px] transition-all hover:bg-surface-3",
                    draft.icon === emoji ? "bg-surface-3 ring-1 ring-primary" : "",
                  ].join(" ")}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {/* URL o base64 */}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={applyUrl}
                onKeyDown={(e) => e.key === "Enter" && applyUrl()}
                placeholder="https://… (URL de imagen)"
                className="flex-1 rounded-md border border-border/60 bg-surface-2/60 px-2 py-1 text-[11px] outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-border/60 bg-surface-2/60 px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:bg-surface-3 hover:text-foreground"
                title="Subir imagen"
              >
                📂 Subir
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            {isUrl(draft.icon) && (
              <p className="mt-1 text-[9px] text-text-muted/70">
                Imagen cargada — se mostrará con número en badge inferior derecho.
              </p>
            )}
          </section>

          {/* ─── Tamaño ────────────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tamaño del ícono
              </label>
              <span className="font-mono text-[11px] text-foreground">{draft.iconSize}px</span>
            </div>
            <Slider
              min={12}
              max={40}
              step={1}
              value={[draft.iconSize]}
              onValueChange={([v]) => setDraft((d) => ({ ...d, iconSize: v }))}
              className="w-full"
            />
            <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground/50">
              <span>12px</span><span>40px</span>
            </div>
          </section>

          {/* ─── Vista previa ──────────────────────────────────────────── */}
          <section>
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vista previa
            </label>
            <div className="flex items-center gap-3 rounded-md bg-surface-2/60 px-3 py-2">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  dangerouslySetInnerHTML={{ __html: previewMarkerHtml(draft, n) }}
                />
              ))}
              <div className="ml-2 text-[10px] text-muted-foreground">
                # marca · {brand}
              </div>
            </div>
          </section>

        </div>

        {/* ─── Acciones ──────────────────────────────────────────────────── */}
        <div className="flex justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => { onReset(brand!); onClose(); }}
            className="rounded-md border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:bg-surface-2/60 hover:text-foreground"
          >
            ↩ Restaurar
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:bg-surface-2/60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => { onSave(brand!, draft); onClose(); }}
              className="rounded-md bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90"
            >
              Guardar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
