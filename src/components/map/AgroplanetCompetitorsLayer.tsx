import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { useAgroplanetCompetitors, type AgroplanetCompetitor } from "@/hooks/useAgroplanetCompetitors";

interface Props {
  visible: boolean;
}

// ── Colores por categoría ──────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  dealer_john_deere:      "#367C2B",   // verde JD
  dealer_new_holland:     "#003B7B",   // azul NH
  dealer_case_ih:         "#C41230",   // rojo Case
  dealer_massey_ferguson: "#CC0000",   // rojo MF
  dealer_claas:           "#B5CC18",   // verde Claas
  dealer_kubota:          "#E8701A",   // naranja Kubota
  dealer_deutz:           "#009B3A",   // verde Deutz
  dealer_agco:            "#6633CC",   // violeta AGCO
  dealer_krone:           "#006B3C",
  dealer_fendt:           "#3C7D2D",
  tienda_agraria:         "#78716C",   // gris neutro
  maquinaria_agricola:    "#92400E",   // marrón
  taller_agricola:        "#0369A1",   // azul acero
  otro:                   "#6B7280",
};

const MARCA_ICONS: Record<string, string> = {
  dealer_john_deere:      "🟢",
  dealer_new_holland:     "🔵",
  dealer_case_ih:         "🔴",
  dealer_massey_ferguson: "🔴",
  tienda_agraria:         "⚙️",
  maquinaria_agricola:    "🚜",
  taller_agricola:        "🔧",
};

function makeDivIcon(categoria: string, verified: boolean): L.DivIcon {
  const color = CAT_COLORS[categoria] ?? "#6B7280";
  const size  = verified ? 14 : 11;
  const border = verified ? `2px solid ${color}` : "1.5px dashed #9CA3AF";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:${border};
      border-radius:50%;
      box-shadow:0 1px 3px rgba(0,0,0,0.35);
      opacity:${verified ? 0.95 : 0.7};
    "></div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function buildPopup(c: AgroplanetCompetitor): string {
  const icon  = MARCA_ICONS[c.categoria] ?? "📍";
  const badge = c.verified
    ? `<span style="background:#16a34a;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">✓ verificado</span>`
    : `<span style="background:#9CA3AF;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">OSM</span>`;

  const marcaLine = c.marca ? `<div style="font-size:10px;color:#6B7280;margin-bottom:3px">${c.marca}</div>` : "";
  const dirLine   = c.direccion ? `<div style="font-size:10px;color:#64748b;margin-top:2px">📍 ${c.direccion}</div>` : "";
  const telLine   = c.telefono  ? `<div style="font-size:10px;color:#64748b">📞 ${c.telefono}</div>` : "";
  const urlLine   = c.url
    ? `<div style="margin-top:3px"><a href="${c.url}" target="_blank" rel="noopener" style="font-size:10px;color:#2563eb">🔗 Sitio web</a></div>`
    : "";

  return `
    <div style="font-family:system-ui,sans-serif;min-width:180px;max-width:240px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin-bottom:4px">
        <strong style="font-size:12px;line-height:1.3">${icon} ${c.nombre}</strong>
        ${badge}
      </div>
      ${marcaLine}
      ${dirLine}
      ${telLine}
      ${urlLine}
      <div style="margin-top:5px;padding-top:4px;border-top:1px solid #f1f5f9;font-size:9px;color:#94a3b8">
        fuente: ${c.fuente} · cut: ${c.cut ?? "—"}
      </div>
    </div>
  `;
}

// ── Componente ────────────────────────────────────────────────────────────

export const AgroplanetCompetitorsLayer = ({ visible }: Props) => {
  const map        = useMap();
  const layerRef   = useRef<L.LayerGroup | null>(null);
  const { data, loading } = useAgroplanetCompetitors(visible);

  useEffect(() => {
    // Limpiar capa anterior
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!visible || loading || data.length === 0) return;

    const group = L.layerGroup();

    for (const c of data) {
      if (!c.lat || !c.lng) continue;
      L.marker([c.lat, c.lng], { icon: makeDivIcon(c.categoria, c.verified) })
        .bindPopup(buildPopup(c), { maxWidth: 260, className: "leaflet-popup-agroplanet" })
        .addTo(group);
    }

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [visible, data, loading, map]);

  return null;
};
