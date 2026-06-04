/**
 * CrimeLayer.tsx
 * Riesgo delictivo por comuna · CEAD 2022-2024
 *
 * Usa L.geoJSON de Leaflet directamente (más robusto que <GeoJSON> de react-leaflet).
 * Sirve el archivo desde jsDelivr CDN (Lovable no sirve archivos grandes de /public/).
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { RiskLevel } from "@/types/crime";
import { RISK_COLORS } from "@/types/crime";

// ── URL del GeoJSON ───────────────────────────────────────────────────────────

const GEOJSON_URL =
  "https://cdn.jsdelivr.net/gh/mstrubee/geochile-compass@main/public/crime/crime_risk_chile.geojson";

// ── Caché global del GeoJSON (no re-descarga si el usuario alterna la capa) ──

let cachedData: GeoJSON.FeatureCollection | null = null;
let fetchPromise: Promise<GeoJSON.FeatureCollection> | null = null;

function fetchCrimeData(): Promise<GeoJSON.FeatureCollection> {
  if (cachedData) return Promise.resolve(cachedData);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch(GEOJSON_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} al cargar crime GeoJSON`);
      return r.json() as Promise<GeoJSON.FeatureCollection>;
    })
    .then((data) => {
      cachedData = data;
      fetchPromise = null;
      return data;
    })
    .catch((e) => {
      fetchPromise = null;
      throw e;
    });

  return fetchPromise;
}

// ── Estilos ───────────────────────────────────────────────────────────────────

interface CrimeProps {
  color?: string;
  nivel_riesgo?: RiskLevel;
  [key: string]: unknown;
}

function getStyle(feature?: GeoJSON.Feature): L.PathOptions {
  const p = feature?.properties as CrimeProps | undefined;
  const fillColor =
    p?.color ??
    RISK_COLORS[p?.nivel_riesgo as RiskLevel] ??
    "#9e9e9e";

  return {
    color: "#1a1a2e",
    weight: 0.8,
    fillColor,
    fillOpacity: 0.65,
    opacity: 1,
  };
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function makePopup(props: CrimeProps): string {
  const nivel = props.nivel_riesgo ?? "—";
  const color = RISK_COLORS[nivel as RiskLevel] ?? "#9e9e9e";
  const fmt = (v: unknown, d = 0) =>
    typeof v === "number"
      ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: d }).format(v)
      : "—";

  return `<div style="min-width:210px;font-family:system-ui,sans-serif;font-size:12px">
    <b style="color:${color};font-size:13px">${props.comuna ?? "—"}</b>
    <span style="color:#888;font-size:10px"> · ${props.region ?? ""}</span><br/>
    <span style="
      display:inline-block;margin:4px 0 6px;
      padding:1px 8px;border-radius:3px;
      background:${color}33;border:1px solid ${color};
      color:${color};font-weight:700;font-size:11px
    ">Riesgo ${nivel}</span>
    <table style="border-collapse:collapse;width:100%;font-size:10px">
      <tr><td style="color:#888;padding:1px 6px 1px 0">Score delictivo</td><td><b>${fmt(props.risk_score)} / 1000</b></td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Tasa x1000 hab/año</td><td>${fmt(props.tasa_x1000, 1)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Total delitos/año</td><td>${fmt(props.total_delitos_anual)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Robos c/violencia</td><td>${fmt(props.robos_violencia_anual)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Hurtos</td><td>${fmt(props.hurtos_anual)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Población</td><td>${fmt(props.poblacion)}</td></tr>
    </table>
    <div style="margin-top:5px;font-size:9px;color:#666">${props.fuente ?? "CEAD"} · ${props.years ?? "2022-2024"}</div>
  </div>`;
}

// ── Componente ────────────────────────────────────────────────────────────────

interface CrimeLayerProps {
  visible: boolean;
}

export const CrimeLayer = ({ visible }: CrimeLayerProps) => {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    // Si se oculta la capa: remover del mapa
    if (!visible) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    // Si ya está cargada y visible: no hacer nada
    if (layerRef.current) return;

    // Cargar y renderizar
    fetchCrimeData()
      .then((data) => {
        // Re-verificar que sigue siendo visible cuando llega la respuesta
        if (!visible) return;

        const layer = L.geoJSON(data, {
          style: getStyle,
          onEachFeature: (feature, lyr) => {
            const props = feature.properties as CrimeProps;
            lyr.bindPopup(makePopup(props), { maxWidth: 280 });
            lyr.on("mouseover", function (this: L.Path) {
              this.setStyle({ weight: 2, fillOpacity: 0.85 });
            });
            lyr.on("mouseout", function (this: L.Path) {
              layer.resetStyle(this);
            });
          },
        });

        layer.addTo(map);
        layerRef.current = layer;
      })
      .catch((e) => {
        console.error("[CrimeLayer] Error:", e);
      });

    // Cleanup al desmontar el componente
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [visible, map]);

  return null;   // Este componente no renderiza JSX — solo manipula el mapa via Leaflet
};

// ── Leyenda ───────────────────────────────────────────────────────────────────

const LEVELS: RiskLevel[] = ["Muy Alto", "Alto", "Medio", "Bajo", "Muy Bajo"];

export const CrimeLegend = () => (
  <div style={{
    background: "hsl(222 38% 10%)",
    border: "1px solid hsl(222 38% 22%)",
    borderRadius: 6, padding: "8px 10px",
    fontSize: 10, color: "hsl(215 19% 80%)",
  }}>
    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11 }}>Riesgo Delictivo</div>
    <div style={{ marginBottom: 4, color: "hsl(215 19% 55%)", fontSize: 9 }}>
      Robos y asaltos · x1000 hab/año · CEAD 2022-2024
    </div>
    {LEVELS.map((n) => (
      <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <div style={{ width: 14, height: 14, background: RISK_COLORS[n], borderRadius: 2, flexShrink: 0 }} />
        <span>{n}</span>
      </div>
    ))}
  </div>
);
