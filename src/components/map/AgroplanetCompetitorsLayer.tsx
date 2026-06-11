/**
 * AgroplanetCompetitorsLayer
 * ──────────────────────────
 * Renderiza los competidores de maquinaria agrícola agrupados por marca,
 * con numeración secuencial y estilos personalizables por marca.
 */

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { useAgroplanetCompetitors, type AgroplanetCompetitor } from "@/hooks/useAgroplanetCompetitors";
import { useBrandStyles, getBrandKey, type BrandStyle } from "@/hooks/useBrandStyles";

interface Props {
  visible: boolean;
}

// ── Helpers de marcadores ────────────────────────────────────────────────────

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isUrlLike = (s: string | null) =>
  !!s && (s.startsWith("http") || s.startsWith("/") || s.startsWith("data:"));

function makeBrandIcon(style: BrandStyle, num: number): L.DivIcon {
  const { color, icon, iconSize } = style;
  const s  = Math.max(12, Math.min(40, iconSize));
  const a  = s / 2;

  const isUrl   = isUrlLike(icon);
  const isEmoji = !!icon && !isUrl;

  let html: string;

  if (isUrl) {
    // Imagen con badge de número en esquina inferior derecha
    html = `
      <div style="position:relative;width:${s}px;height:${s}px">
        <img
          src="${escHtml(icon!)}"
          style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;
                 box-shadow:0 1px 5px rgba(0,0,0,.4);border:2px solid rgba(255,255,255,.8)"
          onerror="this.style.display='none'"
        />
        <div style="
          position:absolute;bottom:-2px;right:-4px;
          min-width:12px;height:12px;padding:0 2px;
          background:${escHtml(color)};border:1.5px solid rgba(255,255,255,.9);
          border-radius:6px;
          display:flex;align-items:center;justify-content:center;
          font-size:7px;font-weight:700;color:white;font-family:system-ui;line-height:1
        ">${num}</div>
      </div>`;
  } else if (isEmoji) {
    // Emoji sobre círculo de color
    html = `
      <div style="
        width:${s}px;height:${s}px;
        background:${escHtml(color)};
        border:2px solid rgba(255,255,255,.88);
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 1px 5px rgba(0,0,0,.38);
        font-size:${Math.max(9, Math.round(s * 0.55))}px;
        line-height:1
      ">${escHtml(icon!)}</div>`;
  } else {
    // Número puro sobre círculo de color
    html = `
      <div style="
        width:${s}px;height:${s}px;
        background:${escHtml(color)};
        border:2px solid rgba(255,255,255,.88);
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 1px 5px rgba(0,0,0,.38);
        font-size:${Math.max(7, Math.round(s * 0.46))}px;
        font-weight:700;color:white;
        font-family:system-ui,sans-serif;line-height:1
      ">${num}</div>`;
  }

  return L.divIcon({
    className:  "",
    html,
    iconSize:   [s + (isUrl ? 4 : 0), s + (isUrl ? 4 : 0)],
    iconAnchor: [a, a],
    popupAnchor:[0, -(a + 4)],
  });
}

// ── Popup ────────────────────────────────────────────────────────────────────

function buildPopup(c: AgroplanetCompetitor, brand: string, num: number): string {
  const badge = c.verified
    ? `<span style="background:#16a34a;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px">✓ verificado</span>`
    : `<span style="background:#9CA3AF;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px">OSM</span>`;

  const numBadge  = `<span style="background:#334155;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px">#${num}</span>`;
  const brandLine = `<div style="font-size:9.5px;color:#64748b;margin-bottom:2px">${escHtml(brand)}</div>`;
  const dirLine   = c.direccion ? `<div style="font-size:9.5px;color:#64748b;margin-top:2px">📍 ${escHtml(c.direccion)}</div>` : "";
  const telLine   = c.telefono  ? `<div style="font-size:9.5px;color:#64748b">📞 ${escHtml(c.telefono)}</div>` : "";
  const urlLine   = c.url
    ? `<div style="margin-top:3px"><a href="${escHtml(c.url)}" target="_blank" rel="noopener" style="font-size:9.5px;color:#2563eb">🔗 Sitio web</a></div>`
    : "";

  return `
    <div style="font-family:system-ui,sans-serif;min-width:175px;max-width:235px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin-bottom:3px">
        <strong style="font-size:11.5px;line-height:1.3">${escHtml(c.nombre)}</strong>
        <div style="display:flex;gap:3px;flex-shrink:0">${numBadge}${badge}</div>
      </div>
      ${brandLine}
      ${dirLine}${telLine}${urlLine}
      <div style="margin-top:5px;padding-top:3px;border-top:1px solid #f1f5f9;font-size:8.5px;color:#94a3b8">
        ${escHtml(c.fuente)} · ${c.cut ?? "—"} · ${c.region ?? ""}
      </div>
    </div>`;
}

// ── Componente ───────────────────────────────────────────────────────────────

export const AgroplanetCompetitorsLayer = ({ visible }: Props) => {
  const map     = useMap();
  const { data, loading } = useAgroplanetCompetitors(visible);
  const { getStyle }      = useBrandStyles();

  // Agrupar por marca, ordenar alfabéticamente dentro de cada grupo
  const brandGroups = useMemo(() => {
    const groups = new Map<string, AgroplanetCompetitor[]>();
    for (const c of data) {
      const brand = getBrandKey(c);
      if (!groups.has(brand)) groups.set(brand, []);
      groups.get(brand)!.push(c);
    }
    // Ordenar cada grupo alfabéticamente para numeración consistente
    for (const [, arr] of groups) {
      arr.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    }
    return groups;
  }, [data]);

  // Ref por brand → LayerGroup para recrear sólo las que cambiaron de estilo
  const groupRefs = useRef<Map<string, L.LayerGroup>>(new Map());

  useEffect(() => {
    // Limpiar capas anteriores
    groupRefs.current.forEach((g) => g.remove());
    groupRefs.current.clear();

    if (!visible || loading || data.length === 0) return;

    for (const [brand, competitors] of brandGroups) {
      const style = getStyle(brand);
      if (!style.visible) continue;

      const group = L.layerGroup().addTo(map);
      groupRefs.current.set(brand, group);

      competitors.forEach((c, idx) => {
        if (!c.lat || !c.lng) return;
        const num = idx + 1;
        L.marker([c.lat, c.lng], { icon: makeBrandIcon(style, num) })
          .bindPopup(buildPopup(c, brand, num), {
            maxWidth:  260,
            className: "leaflet-popup-agroplanet",
          })
          .addTo(group);
      });
    }

    return () => {
      groupRefs.current.forEach((g) => g.remove());
      groupRefs.current.clear();
    };
  }, [visible, loading, data, brandGroups, getStyle, map]);

  return null;
};
