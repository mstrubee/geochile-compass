import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { UserLayer } from "@/types/userLayers";

interface Props {
  layers: UserLayer[];
  fitId: string | null;
  onFitDone: () => void;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function makeBadgeIcon(name: string, color: string): L.DivIcon {
  const label = escapeHtml(name).slice(0, 18);
  const initial = escapeHtml(name.trim().charAt(0).toUpperCase() || "?");
  return L.divIcon({
    className: "user-layer-badge",
    html: `<div style="display:flex;align-items:center;gap:4px;padding:2px 6px 2px 2px;border-radius:999px;background:rgba(15,23,42,.85);color:#fff;font:500 11px/1 ui-sans-serif,system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4);white-space:nowrap;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:10px;">${initial}</span>
      <span>${label}</span>
    </div>`,
    iconSize: [120, 22],
    iconAnchor: [12, 11],
    popupAnchor: [0, -12],
  });
}

export const UserLayersLayer = ({ layers, fitId, onFitDone }: Props) => {
  const map = useMap();
  const groupsRef = useRef<Map<string, L.GeoJSON>>(new Map());

  useEffect(() => {
    const groups = groupsRef.current;
    const seen = new Set<string>();

    layers.forEach((ul) => {
      seen.add(ul.id);
      let group = groups.get(ul.id);
      if (!group) {
        group = L.geoJSON(ul.data, {
          style: (feature) => {
            const p = (feature?.properties ?? {}) as Record<string, unknown>;
            const stroke = (p.stroke as string) || (p["stroke-color"] as string) || ul.color;
            const fill = (p.fill as string) || stroke;
            const weight = typeof p["stroke-width"] === "number" ? (p["stroke-width"] as number) : 2;
            const fillOpacity =
              typeof p["fill-opacity"] === "number" ? (p["fill-opacity"] as number) : 0.25;
            const strokeOpacity =
              typeof p["stroke-opacity"] === "number" ? (p["stroke-opacity"] as number) : 1;
            return { color: stroke, weight, opacity: strokeOpacity, fillColor: fill, fillOpacity };
          },
          pointToLayer: (feature, latlng) => {
            const p = (feature?.properties ?? {}) as Record<string, unknown>;
            const iconUrl = (p.icon as string) || (p["marker-symbol"] as string);
            const candidates = Array.isArray(p.iconCandidates)
              ? (p.iconCandidates as string[])
              : iconUrl
                ? [iconUrl]
                : [];
            const name = String(p.name || p.brand || ul.name || "?");

            if (candidates.length) {
              const scale = typeof p["icon-scale"] === "number" ? (p["icon-scale"] as number) : 1;
              const size = Math.max(16, Math.round(32 * scale));
              const marker = L.marker(latlng, {
                icon: L.divIcon({
                  className: "user-layer-icon-wrap",
                  html: `<img src="${candidates[0]}" alt="" style="width:${size}px;height:${size}px;border-radius:6px;background:#fff;object-fit:contain;box-shadow:0 1px 4px rgba(0,0,0,.4);" />`,
                  iconSize: [size, size],
                  iconAnchor: [size / 2, size / 2],
                  popupAnchor: [0, -size / 2],
                }),
              });
              // Probar candidatos en cascada; si todos fallan → badge
              const tryCandidate = (idx: number) => {
                const el = marker.getElement()?.querySelector("img") as HTMLImageElement | null;
                if (!el) return;
                const onFail = () => {
                  const next = idx + 1;
                  if (next < candidates.length) {
                    el.src = candidates[next];
                    el.addEventListener("error", () => tryCandidate(next), { once: true });
                  } else {
                    marker.setIcon(makeBadgeIcon(name, ul.color));
                  }
                };
                if (el.complete && el.naturalWidth === 0) onFail();
                else el.addEventListener("error", onFail, { once: true });
              };
              setTimeout(() => tryCandidate(0), 0);
              return marker;
            }
            return L.marker(latlng, { icon: makeBadgeIcon(name, ul.color) });
          },
          onEachFeature: (feature, layer) => {
            const props = feature.properties ?? {};
            const name = props.name || props.Name || props.NAME || ul.name;
            const desc = props.description || props.Description || "";
            layer.bindPopup(
              `<strong>${name}</strong>${desc ? `<br/><span style="font-size:11px;opacity:.8">${desc}</span>` : ""}`
            );
          },
        });
        groups.set(ul.id, group);
      }
      if (ul.visible) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else {
        if (map.hasLayer(group)) map.removeLayer(group);
      }
    });

    // Remove deleted
    groups.forEach((group, id) => {
      if (!seen.has(id)) {
        if (map.hasLayer(group)) map.removeLayer(group);
        groups.delete(id);
      }
    });
  }, [layers, map]);

  // Fit bounds when requested
  useEffect(() => {
    if (!fitId) return;
    const group = groupsRef.current.get(fitId);
    if (group) {
      const bounds = group.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
    onFitDone();
  }, [fitId, map, onFitDone]);

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      groupsRef.current.forEach((g) => {
        if (map.hasLayer(g)) map.removeLayer(g);
      });
      groupsRef.current.clear();
    };
  }, [map]);

  return null;
};
