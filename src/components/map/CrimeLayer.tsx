/**
 * CrimeLayer.tsx
 * Riesgo delictivo por comuna · CEAD 2022-2024
 *
 * Usa L.geoJSON de Leaflet directamente + barra de progreso visual.
 * Sirve el GeoJSON desde jsDelivr CDN (Lovable no sirve archivos grandes de /public/).
 */

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { RiskLevel } from "@/types/crime";
import { RISK_COLORS } from "@/types/crime";

// ── URL del GeoJSON ───────────────────────────────────────────────────────────

const GEOJSON_URL =
  "https://cdn.jsdelivr.net/gh/mstrubee/geochile-compass@main/public/crime/crime_risk_chile.geojson";

// ── Caché global (no re-descarga si el usuario alterna la capa) ──────────────

let cachedData: GeoJSON.FeatureCollection | null = null;
let fetchPromise: Promise<GeoJSON.FeatureCollection> | null = null;

function fetchCrimeData(): Promise<GeoJSON.FeatureCollection> {
  if (cachedData) return Promise.resolve(cachedData);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch(GEOJSON_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
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

// ── Estilos Leaflet ───────────────────────────────────────────────────────────

interface CrimeProps {
  color?: string;
  nivel_riesgo?: string;
  comuna?: string;
  region?: string;
  risk_score?: number;
  tasa_x1000?: number;
  total_delitos_anual?: number;
  robos_violencia_anual?: number;
  hurtos_anual?: number;
  poblacion?: number;
  fuente?: string;
  years?: string;
  [key: string]: unknown;
}

function getStyle(feature?: GeoJSON.Feature): L.PathOptions {
  const p = feature?.properties as CrimeProps | undefined;
  const fillColor =
    p?.color ??
    RISK_COLORS[(p?.nivel_riesgo as RiskLevel) ?? "Medio"] ??
    "#9e9e9e";
  return {
    color: "#111827",
    weight: 0.7,
    fillColor,
    fillOpacity: 0.65,
    opacity: 1,
  };
}

const fmt = (v: unknown, d = 0) =>
  typeof v === "number"
    ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: d }).format(v)
    : "—";

function makePopup(props: CrimeProps): string {
  const nivel = (props.nivel_riesgo as RiskLevel) ?? "Medio";
  const color = RISK_COLORS[nivel] ?? "#9e9e9e";
  return `
    <div style="min-width:210px;font-family:system-ui,sans-serif;font-size:12px">
      <b style="color:${color};font-size:13px">${props.comuna ?? "—"}</b>
      <span style="color:#888;font-size:10px"> · ${props.region ?? ""}</span><br/>
      <span style="display:inline-block;margin:4px 0 6px;padding:2px 8px;border-radius:3px;
        background:${color}33;border:1px solid ${color};color:${color};font-weight:700;font-size:11px">
        Riesgo ${nivel}
      </span>
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

// ── Barra de carga visual ─────────────────────────────────────────────────────

type Status = "idle" | "loading" | "done" | "error";

const STATUS_BAR_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 28,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1000,
  background: "rgba(15,23,42,0.92)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "8px 16px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 12,
  color: "#e2e8f0",
  boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
  pointerEvents: "none",
};

const Spinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5"
    style={{ animation: "spin 0.9s linear infinite" }}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
  </svg>
);

function LoadingBar({ status, count }: { status: Status; count: number }) {
  if (status === "idle" || status === "done") return null;

  return (
    <div style={STATUS_BAR_STYLE}>
      {status === "loading" && (
        <>
          <Spinner />
          <div>
            <div style={{ fontWeight: 600 }}>Cargando Riesgo Delictivo…</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
              346 comunas · CEAD 2022-2024 (~6 MB)
            </div>
          </div>
        </>
      )}
      {status === "error" && (
        <>
          <span style={{ fontSize: 16 }}>❌</span>
          <div>
            <div style={{ fontWeight: 600, color: "#f87171" }}>Error al cargar</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
              Revisa la consola del navegador
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface CrimeLayerProps {
  visible: boolean;
}

export const CrimeLayer = ({ visible }: CrimeLayerProps) => {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!visible) {
      // Ocultar capa y resetear estado
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      setStatus("idle");
      return;
    }

    // Ya está cargada → no hacer nada
    if (layerRef.current) return;

    setStatus("loading");

    fetchCrimeData()
      .then((data) => {
        if (!visible) return; // usuario desactivó mientras cargaba

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
        setCount(data.features.length);
        setStatus("done");
      })
      .catch((e) => {
        console.error("[CrimeLayer]", e);
        setStatus("error");
      });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [visible, map]);

  if (!visible) return null;

  return <LoadingBar status={status} count={count} />;
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
