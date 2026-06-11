/**
 * ComercialPOILayer.tsx
 * ──────────────────────
 * Renderiza POIs de la Red Comercial Nacional en el mapa Leaflet.
 *
 * Características:
 *  • Clustering dinámico con supercluster (sin depender de Leaflet.MarkerCluster)
 *  • Iconos emoji/color por marca (desde brand_catalog)
 *  • Carga progresiva: solo activa el fetch cuando la capa está visible
 *  • Popup con nombre, marca, dirección, comuna
 *  • Escala de cluster: pequeño (azul) → mediano (naranja) → grande (rojo)
 */

import { useEffect, useMemo, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useComercialPOI } from "@/hooks/useComercialPOI";
import { COMERCIAL_LAYER_META } from "@/types/comercial";
import type { ComercialCategoria, ComercialPOI } from "@/types/comercial";

// supercluster es tiny (~7 kB gzip) y no requiere plugins Leaflet
// npm install supercluster @types/supercluster
import Supercluster from "supercluster";

interface Props {
  categoria:      ComercialCategoria;
  visible:        boolean;
  filtroMarca?:   string | null;        // null = todas las marcas
  hiddenBrands?:  Set<string>;          // marcas ocultas (filtro client-side)
  onCountChange?: (n: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de iconos
// ─────────────────────────────────────────────────────────────────────────────

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildMarkerIcon(poi: ComercialPOI, meta: (typeof COMERCIAL_LAYER_META)[ComercialCategoria]) {
  const icon  = meta.icon;
  const color = meta.color;
  const size  = 26;
  const font  = Math.round(size * 0.55);
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.85);font-size:${font}px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer">${icon}</div>`,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function buildClusterIcon(count: number, color: string) {
  const size  = count < 10 ? 32 : count < 100 ? 40 : 48;
  const font  = Math.round(size * 0.33);
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid rgba(255,255,255,0.9);color:#fff;font-size:${font}px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer">${count}</div>`,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function clusterColor(count: number, baseColor: string): string {
  if (count < 5)   return baseColor;
  if (count < 20)  return "#F59E0B";
  return "#EF4444";
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup HTML
// ─────────────────────────────────────────────────────────────────────────────

function buildPopupHtml(poi: ComercialPOI): string {
  const nombre  = escHtml(poi.nombre  ?? poi.marca_estandar ?? "—");
  const marca   = poi.marca_estandar ? `<span style="color:#6B7280;font-size:11px">${escHtml(poi.marca_estandar)}</span>` : "";
  const dir     = poi.direccion ? `<div style="font-size:11px;color:#6B7280;margin-top:2px">📍 ${escHtml(poi.direccion)}</div>` : "";
  const comuna  = poi.comuna    ? `<div style="font-size:11px;color:#6B7280">${escHtml(poi.comuna)}</div>` : "";
  return `<div style="font-size:13px;font-family:system-ui,sans-serif;min-width:140px">
    <b>${nombre}</b>${marca ? `<br>${marca}` : ""}
    ${dir}${comuna}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export const ComercialPOILayer = ({ categoria, visible, filtroMarca, hiddenBrands, onCountChange }: Props) => {
  const map  = useMap();
  const meta = COMERCIAL_LAYER_META[categoria];

  const { data } = useComercialPOI(categoria, visible, { marca: filtroMarca });

  // Ref para los marcadores Leaflet (evita re-crear en cada render)
  const layerRef  = useRef<L.LayerGroup | null>(null);
  const clusterRef = useRef<Supercluster | null>(null);
  const zoomRef   = useRef<number>(map.getZoom());

  // Notificar conteo al parent
  useEffect(() => {
    onCountChange?.(data.length);
  }, [data.length, onCountChange]);

  // Convertir POIs a GeoJSON features; aplicar filtro de marcas ocultas (client-side)
  const features = useMemo(() => {
    const base = data.map((poi) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [poi.longitud, poi.latitud] },
      properties: { poi },
    }));
    if (!hiddenBrands || hiddenBrands.size === 0) return base;
    return base.filter((f) => {
      // NULL en DB → "Otros" (datos anteriores al ETL fix)
      const brand = f.properties.poi.marca_estandar ?? "Otros";
      return !hiddenBrands.has(brand);
    });
  }, [data, hiddenBrands]);

  // ── Render de clusters según viewport ──────────────────────────────────

  const renderClusters = () => {
    if (!layerRef.current || !clusterRef.current) return;

    const zoom   = map.getZoom();
    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    const clusters = clusterRef.current.getClusters(bbox, Math.round(zoom));

    layerRef.current.clearLayers();

    for (const cl of clusters) {
      const [lng, lat] = cl.geometry.coordinates;

      if (cl.properties.cluster) {
        // Es un cluster
        const count = cl.properties.point_count as number;
        const color = clusterColor(count, meta.color);
        const icon  = buildClusterIcon(count, color);
        const marker = L.marker([lat, lng], { icon });

        marker.on("click", () => {
          const expansionZoom = clusterRef.current!.getClusterExpansionZoom(
            cl.properties.cluster_id as number,
          );
          map.flyTo([lat, lng], Math.min(expansionZoom, 18), { duration: 0.5 });
        });

        marker.addTo(layerRef.current!);
      } else {
        // Es un punto individual
        const poi  = (cl.properties as { poi: ComercialPOI }).poi;
        const icon = buildMarkerIcon(poi, meta);
        const marker = L.marker([lat, lng], { icon });
        marker.bindPopup(buildPopupHtml(poi), { maxWidth: 240 });
        marker.addTo(layerRef.current!);
      }
    }
  };

  // ── Inicializar / destruir layer group ────────────────────────────────

  useEffect(() => {
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      layerRef.current?.remove();
      layerRef.current = null;
    };
  }, [map]);

  // ── Escuchar eventos de mapa para actualizar clusters ─────────────────

  useMapEvents({
    moveend:  renderClusters,
    zoomend:  () => { zoomRef.current = map.getZoom(); renderClusters(); },
  });

  // ── Re-renderizar cuando cambian los datos o la visibilidad ───────────

  useEffect(() => {
    if (!layerRef.current) return;

    if (!visible || features.length === 0) {
      layerRef.current.clearLayers();
      clusterRef.current = null;
      return;
    }

    // Construir índice supercluster
    const sc = new Supercluster({
      radius:  60,
      maxZoom: 16,
      minZoom: 0,
    });
    sc.load(features);
    clusterRef.current = sc;

    renderClusters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, features]);

  return null;
};
