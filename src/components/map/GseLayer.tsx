import { useEffect, useMemo, useState } from "react";
import { GeoJSON, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { Layer } from "leaflet";
import type { Feature } from "geojson";
import type { GseFeatureCollection, GseProperties, GseVariable } from "@/types/gse";
import { colorForGse, GSE_VARIABLE_LABEL } from "@/utils/gseScales";
import { gseService } from "@/services/gseService";
import { COMMUNES, NSE_COLOR_HSL, NSE_LABELS, type Commune, type NSE } from "@/data/communes";
import { fmtNum } from "@/utils/formatters";

interface GseLayerProps {
  visible: boolean;
  data: GseFeatureCollection | null;
  variable: GseVariable;
  onViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
  /** En zooms bajos no hay polígonos. Mostramos los círculos por comuna como fallback. */
  showCommuneFallback: boolean;
}

const fmtN = (v: number | null, dig = 1) =>
  v == null ? "—" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: dig }).format(v);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const COMMUNE_BY_NAME = new Map<string, Commune>(COMMUNES.map((c) => [norm(c.name), c]));

const FallbackCirclePopup = ({ c }: { c: Commune }) => (
  <div style={{ minWidth: 170 }}>
    <div style={{ fontWeight: 600, color: `hsl(${NSE_COLOR_HSL[c.nse]})`, marginBottom: 4, fontSize: 12 }}>
      {c.name} <span style={{ color: "hsl(215 19% 50%)", fontWeight: 400 }}>· estimación</span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 8px", fontSize: 10 }}>
      <span style={{ color: "hsl(215 19% 50%)" }}>NSE pred.</span><span style={{ fontFamily: "monospace" }}>{NSE_LABELS[c.nse]}</span>
      <span style={{ color: "hsl(215 19% 50%)" }}>Población</span><span style={{ fontFamily: "monospace" }}>{fmtNum(c.pop)}</span>
      <span style={{ color: "hsl(215 19% 50%)" }}>Hogares</span><span style={{ fontFamily: "monospace" }}>{fmtNum(c.hh)}</span>
    </div>
    <div style={{ marginTop: 6, fontSize: 9, color: "hsl(215 19% 35%)" }}>
      Sin datos de manzana en esta zona. Acerca el zoom o cambia de comuna.
    </div>
  </div>
);

export const GseLayer = ({
  visible,
  data,
  variable,
  onViewportChange,
  showCommuneFallback,
}: GseLayerProps) => {
  const map = useMap();
  const [coveredCommuneNames, setCoveredCommuneNames] = useState<Set<string>>(new Set());

  // Notificar el viewport inicial y en cada movimiento.
  useEffect(() => {
    if (!visible) return;
    const b = map.getBounds();
    onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visible]);

  useMapEvents({
    moveend: () => {
      if (!visible) return;
      const b = map.getBounds();
      onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
    },
    zoomend: () => {
      if (!visible) return;
      const b = map.getBounds();
      onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
    },
  });

  // Determina qué comunas tienen cobertura GSE en el viewport actual
  // (para pintar el fallback solo en las que NO).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    gseService
      .coveredCommunesIn(bbox)
      .then((entries) => {
        if (cancelled) return;
        setCoveredCommuneNames(new Set(entries.map((e) => norm(e.commune))));
      })
      .catch(() => setCoveredCommuneNames(new Set()));
    return () => {
      cancelled = true;
    };
  }, [map, visible, data]);

  const fallbackCommunes = useMemo(() => {
    if (!showCommuneFallback) return [];
    // Comunas que NO están cubiertas por GSE 2012 → mostramos círculo estimado.
    return COMMUNES.filter((c) => !coveredCommuneNames.has(norm(c.name)));
  }, [coveredCommuneNames, showCommuneFallback]);

  if (!visible) return null;

  const styleFn = (feature?: Feature) => {
    const p = feature?.properties as GseProperties | undefined;
    if (!p) return {};
    return {
      color: "hsl(222 38% 18%)",
      weight: 0.3,
      fillColor: colorForGse(variable, p),
      fillOpacity: 0.7,
    };
  };

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const p = feature.properties as GseProperties;
    const html = `
      <div style="min-width:200px">
        <div style="font-weight:600;color:hsl(199 89% 60%);margin-bottom:4px;font-size:12px">
          Manzana · ${p.commune ?? "—"}
        </div>
        <div style="display:grid;grid-template-columns:auto auto;gap:2px 8px;font-size:10px">
          <span style="color:hsl(215 19% 50%)">Variable</span><span style="font-family:monospace">${GSE_VARIABLE_LABEL[variable]}</span>
          <span style="color:hsl(215 19% 50%)">GSE</span><span style="font-family:monospace">${p.gse ?? "—"}</span>
          <span style="color:hsl(215 19% 50%)">Quintil</span><span style="font-family:monospace">${p.quintil ?? "—"}</span>
          <span style="color:hsl(215 19% 50%)">Puntaje NSE</span><span style="font-family:monospace">${fmtN(p.nse_score, 0)}</span>
          <span style="color:hsl(215 19% 50%)">Escolaridad</span><span style="font-family:monospace">${fmtN(p.educ, 1)} años</span>
          <span style="color:hsl(215 19% 50%)">Hacinamiento</span><span style="font-family:monospace">${fmtN(p.hacin, 2)}</span>
          <span style="color:hsl(215 19% 50%)">Hac. clase</span><span style="font-family:monospace">${p.hacin_class ?? "—"}</span>
          <span style="color:hsl(215 19% 50%)">Movilización</span><span style="font-family:monospace">${fmtN(p.auto_score, 0)}</span>
        </div>
        <div style="margin-top:6px;font-size:9px;color:hsl(215 19% 35%)">
          Fuente: Censo 2012 · ID ${p.id}
        </div>
      </div>`;
    layer.bindPopup(html);
  };

  const key = data
    ? `${data.metadata.bbox.join(",")}|${variable}|${data.features.length}`
    : `empty|${variable}`;

  return (
    <>
      {data && data.features.length > 0 && (
        <GeoJSON key={key} data={data} style={styleFn} onEachFeature={onEachFeature} />
      )}
      {fallbackCommunes.map((c) => {
        const color = `hsl(${NSE_COLOR_HSL[c.nse]})`;
        return (
          <CircleMarker
            key={`gse-fallback-${c.name}`}
            center={[c.lat, c.lng]}
            radius={12}
            pathOptions={{
              color: "hsl(222 38% 12%)",
              weight: 1.5,
              opacity: 0.85,
              fillColor: color,
              fillOpacity: 0.55,
              dashArray: "3 3",
            }}
          >
            <Popup>
              <FallbackCirclePopup c={c} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};
