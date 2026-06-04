/**
 * CrimeLayer.tsx  —  Riesgo Delictivo por comuna
 *
 * Estrategia de carga (intenta en orden):
 *   1. jsDelivr CDN   (GitHub → CDN global con CORS)
 *   2. GitHub raw     (raw.githubusercontent.com con CORS)
 *   3. /public/ local (para desarrollo con Vite)
 */

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { RiskLevel } from "@/types/crime";
import { RISK_COLORS } from "@/types/crime";

// ── URLs de fallback ──────────────────────────────────────────────────────────

const REPO  = "mstrubee/geochile-compass";
const FILE  = "public/crime/crime_risk_chile.geojson";
const URLS  = [
  "https://tcmyidycqdrrtwuaovbk.supabase.co/storage/v1/object/public/geodata/crime_risk_chile.geojson",
  `https://cdn.jsdelivr.net/gh/${REPO}@main/${FILE}`,
  `https://raw.githubusercontent.com/${REPO}/main/${FILE}`,
  `/${FILE.replace("public/", "")}`,
];

// ── Cache global ──────────────────────────────────────────────────────────────

let _cache: GeoJSON.FeatureCollection | null = null;

async function loadData(): Promise<GeoJSON.FeatureCollection> {
  if (_cache) return _cache;

  const errors: string[] = [];
  for (const url of URLS) {
    try {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as GeoJSON.FeatureCollection;
      console.info(`[CrimeLayer] ✅ cargado desde ${url} — ${data.features.length} comunas`);
      _cache = data;
      return data;
    } catch (e) {
      const msg = `${url} → ${e}`;
      errors.push(msg);
      console.warn(`[CrimeLayer] ⚠ falló: ${msg}`);
    }
  }
  throw new Error(`No se pudo cargar el GeoJSON:\n${errors.join("\n")}`);
}

// ── Estilos ───────────────────────────────────────────────────────────────────

interface CP {
  color?: string; nivel_riesgo?: string; comuna?: string; region?: string;
  risk_score?: number; tasa_x1000?: number; total_delitos_anual?: number;
  robos_violencia_anual?: number; hurtos_anual?: number; poblacion?: number;
  fuente?: string; years?: string; [k: string]: unknown;
}

const fmt = (v: unknown, d = 0) =>
  typeof v === "number"
    ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: d }).format(v)
    : "—";

function style(f?: GeoJSON.Feature): L.PathOptions {
  const p = f?.properties as CP | undefined;
  return {
    fillColor: p?.color ?? RISK_COLORS[(p?.nivel_riesgo as RiskLevel) ?? "Medio"] ?? "#9e9e9e",
    fillOpacity: 0.65,
    color: "#111827",
    weight: 0.7,
    opacity: 1,
  };
}

function popup(p: CP): string {
  const n = (p.nivel_riesgo ?? "Medio") as RiskLevel;
  const c = RISK_COLORS[n] ?? "#9e9e9e";
  return `<div style="min-width:200px;font-family:system-ui,sans-serif;font-size:12px">
    <b style="color:${c};font-size:13px">${p.comuna ?? "—"}</b>
    <span style="color:#888;font-size:10px"> · ${p.region ?? ""}</span><br/>
    <span style="display:inline-block;margin:4px 0 6px;padding:2px 8px;border-radius:3px;
      background:${c}33;border:1px solid ${c};color:${c};font-weight:700;font-size:11px">
      Riesgo ${n}</span>
    <table style="font-size:10px;border-collapse:collapse;width:100%">
      <tr><td style="color:#888;padding:1px 6px 1px 0">Score</td><td><b>${fmt(p.risk_score)} / 1000</b></td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Tasa x1000 hab/año</td><td>${fmt(p.tasa_x1000, 1)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Total delitos/año</td><td>${fmt(p.total_delitos_anual)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Robos c/violencia</td><td>${fmt(p.robos_violencia_anual)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Hurtos</td><td>${fmt(p.hurtos_anual)}</td></tr>
      <tr><td style="color:#888;padding:1px 6px 1px 0">Población</td><td>${fmt(p.poblacion)}</td></tr>
    </table>
    <div style="margin-top:4px;font-size:9px;color:#666">${p.fuente ?? "CEAD"} · ${p.years ?? "2022-2024"}</div>
  </div>`;
}

// ── Barra de carga flotante ───────────────────────────────────────────────────

type Status = "idle" | "loading" | "done" | "error";

function LoadingBar({ status, msg }: { status: Status; msg: string }) {
  if (status === "idle" || status === "done") return null;

  const isErr = status === "error";
  return (
    <div style={{
      position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)",
      zIndex: 10000, background: "rgba(10,15,30,0.93)", backdropFilter: "blur(8px)",
      border: `1px solid ${isErr ? "#ef4444" : "rgba(255,255,255,0.15)"}`,
      borderRadius: 10, padding: "10px 18px", display: "flex", alignItems: "center",
      gap: 10, color: "#e2e8f0", fontSize: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      pointerEvents: "none", whiteSpace: "nowrap",
    }}>
      {isErr
        ? <span style={{ fontSize: 18 }}>❌</span>
        : <Spinner />}
      <div>
        <div style={{ fontWeight: 700, color: isErr ? "#f87171" : "#e2e8f0" }}>
          {isErr ? "Error al cargar riesgo delictivo" : "Cargando Riesgo Delictivo…"}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{msg}</div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round"
      style={{ flexShrink: 0, animation: "crime-spin 0.85s linear infinite" }}>
      <style>{`@keyframes crime-spin{to{transform:rotate(360deg)}}`}</style>
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#1e3a5f" strokeWidth="2.5"/>
      <path d="M12 3a9 9 0 019 9"/>
    </svg>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface CrimeLayerProps { visible: boolean }

export const CrimeLayer = ({ visible }: CrimeLayerProps) => {
  const map = useMap();
  const layerRef  = useRef<L.GeoJSON | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [msg,    setMsg]    = useState("346 comunas · CEAD 2022-2024 · ~6 MB");

  useEffect(() => {
    if (!visible) {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      setStatus("idle");
      return;
    }

    // Ya está en el mapa: nada que hacer
    if (layerRef.current) return;

    setStatus("loading");
    setMsg("346 comunas · CEAD 2022-2024 · ~6 MB");

    loadData()
      .then((data) => {
        if (!visible) return;               // el usuario desactivó mientras cargaba

        const geoLayer = L.geoJSON(data, {
          style,
          onEachFeature(feature, lyr) {
            const p = feature.properties as CP;
            lyr.bindPopup(popup(p), { maxWidth: 290 });
            lyr.on("mouseover", function(this: L.Path) {
              this.setStyle({ weight: 2, fillOpacity: 0.88 });
            });
            lyr.on("mouseout",  function(this: L.Path) {
              geoLayer.resetStyle(this);
            });
          },
        });

        geoLayer.addTo(map);
        layerRef.current = geoLayer;
        setStatus("done");
        setMsg("");
        console.info(`[CrimeLayer] ✅ ${data.features.length} comunas renderizadas`);
      })
      .catch((e) => {
        console.error("[CrimeLayer] Error:", e);
        setStatus("error");
        setMsg(String(e).slice(0, 100));
      });

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    };
  }, [visible, map]);

  // El componente SIEMPRE renderiza algo cuando visible=true (la barra)
  // o null cuando está oculto
  if (!visible) return null;
  return <LoadingBar status={status} msg={msg} />;
};

// ── Leyenda (usada en Legend.tsx) ─────────────────────────────────────────────

const LEVELS: RiskLevel[] = ["Muy Alto", "Alto", "Medio", "Bajo", "Muy Bajo"];

export const CrimeLegend = () => (
  <div style={{
    background: "hsl(222 38% 10%)", border: "1px solid hsl(222 38% 22%)",
    borderRadius: 6, padding: "8px 10px", fontSize: 10, color: "hsl(215 19% 80%)",
  }}>
    <div style={{ fontWeight: 700, marginBottom: 5, fontSize: 11 }}>Riesgo Delictivo</div>
    <div style={{ marginBottom: 4, color: "hsl(215 19% 55%)", fontSize: 9 }}>
      Robos y asaltos · x1000 hab/año · CEAD 2022-2024
    </div>
    {LEVELS.map((n) => (
      <div key={n} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
        <div style={{ width:14, height:14, background:RISK_COLORS[n], borderRadius:2, flexShrink:0 }}/>
        <span>{n}</span>
      </div>
    ))}
  </div>
);
