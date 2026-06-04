/**
 * HeatmapSettingsPanel.tsx
 * ========================
 * Panel flotante (solo admin) para ajustar parámetros de heatmap en tiempo real.
 * Los cambios se ven al instante; "Guardar" persiste en Supabase para todos.
 */

import { useState, useCallback } from "react";
import type { HeatmapSettings } from "@/hooks/useHeatmapSettings";

interface Props {
  layerLabel: string;
  settings:   HeatmapSettings;
  saving:     boolean;
  error:      string | null;
  currentZoom: number;
  onChange:   (s: HeatmapSettings) => void;   // preview en tiempo real
  onSave:     (s: HeatmapSettings) => void;   // persiste en Supabase
  onClose:    () => void;
}

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

function Slider({ label, hint, value, min, max, step = 1, onChange }: SliderProps) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{label}</span>
        <span style={{
          fontSize: 11, fontFamily: "monospace", fontWeight: 700,
          color: "#60a5fa", background: "rgba(96,165,250,0.12)",
          padding: "0 6px", borderRadius: 4,
        }}>{step < 1 ? value.toFixed(2) : value}</span>
      </div>
      {hint && <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>{hint}</div>}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#60a5fa", cursor: "pointer" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569" }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );
}

export const HeatmapSettingsPanel = ({
  layerLabel, settings, saving, error, currentZoom,
  onChange, onSave, onClose,
}: Props) => {
  const [draft, setDraft] = useState<HeatmapSettings>({ ...settings });

  const update = useCallback((patch: Partial<HeatmapSettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(next);  // preview inmediato
  }, [draft, onChange]);

  const handleSave = () => onSave(draft);

  return (
    <div style={{
      position: "absolute",
      bottom: 60, right: 12,
      zIndex: 10001,
      width: 280,
      background: "rgba(8,12,25,0.97)",
      backdropFilter: "blur(16px)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 12,
      padding: "14px 16px",
      boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
      color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 14 }}>⚙️</span>
        <div style={{ marginLeft: 8, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Ajuste de Heatmap</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>{layerLabel}</div>
        </div>
        <div style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 4,
          background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)",
          color: "#93c5fd",
        }}>
          Zoom actual: {currentZoom}
        </div>
        <button onClick={onClose} style={{
          marginLeft: 8, background: "none", border: "none", color: "#64748b",
          cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 4px",
        }}>✕</button>
      </div>

      {/* Sliders */}
      <Slider
        label="Zoom mínimo"
        hint="Mapa más cercano que este zoom → capa invisible"
        value={draft.min_zoom}
        min={8} max={16}
        onChange={v => update({ min_zoom: v })}
      />
      <Slider
        label="Radio de puntos"
        hint="Tamaño del punto en píxeles (a zoom=13)"
        value={draft.radius}
        min={5} max={80}
        onChange={v => update({ radius: v })}
      />
      <Slider
        label="Blur (difuminado)"
        hint="Mayor blur → aspecto más continuo y suave"
        value={draft.blur}
        min={1} max={60}
        onChange={v => update({ blur: v })}
      />
      <Slider
        label="Opacidad"
        hint="Transparencia de la capa (0=invisible, 1=sólido)"
        value={draft.opacity}
        min={0.1} max={1.0} step={0.05}
        onChange={v => update({ opacity: v })}
      />

      {/* Separador */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "12px 0 10px" }} />

      {/* Preview live */}
      <div style={{
        fontSize: 10, color: "#64748b", marginBottom: 10, lineHeight: 1.5,
        padding: "6px 8px", background: "rgba(96,165,250,0.06)",
        borderRadius: 6, border: "1px solid rgba(96,165,250,0.1)",
      }}>
        📡 Los cambios se aplican en tiempo real en tu vista.<br />
        Otros usuarios verán los cambios solo al <b style={{ color: "#93c5fd" }}>Guardar</b>.
      </div>

      {error && (
        <div style={{ fontSize: 10, color: "#f87171", marginBottom: 8,
          padding: "5px 8px", background: "rgba(239,68,68,0.1)", borderRadius: 5 }}>
          ❌ {error}
        </div>
      )}

      {/* Botones */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onClose}
          style={{
            flex: 1, padding: "7px 0", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 11,
          }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 2, padding: "7px 0", borderRadius: 7, border: "none",
            background: saving ? "#1e3a5f" : "linear-gradient(135deg,#1d4ed8,#2563eb)",
            color: "#fff", cursor: saving ? "not-allowed" : "pointer",
            fontSize: 11, fontWeight: 700,
            boxShadow: saving ? "none" : "0 2px 8px rgba(37,99,235,0.4)",
            transition: "all 0.15s",
          }}
        >
          {saving ? "Guardando…" : "💾 Guardar para todos"}
        </button>
      </div>
    </div>
  );
};
