import { useEffect, useMemo, useRef } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { GeoJSON as LeafletGeoJSON, PathOptions } from "leaflet";
import type { FeatureCollection, Geometry } from "geojson";
import { useComunasGeoIndex, type ComunaFeature, type ComunaProps } from "@/hooks/useComunasGeoIndex";

interface CommuneOutlineLayerProps {
  /** Nombres de comunas (tal como aparecen en COMMUNES) a delinear. */
  names: string[];
  /** Si está presente, esa comuna se resalta con borde más grueso y leve fill. */
  highlightName?: string | null;
  /** Si true, hace fitBounds al conjunto cuando cambia la lista (default: solo si hay >1). */
  autoFit?: boolean;
}

/**
 * Dibuja únicamente los polígonos de las comunas seleccionadas (búsqueda
 * por texto, rango o comparador). No carga el geojson hasta que se le
 * pasen nombres por primera vez.
 */
export const CommuneOutlineLayer = ({
  names,
  highlightName = null,
  autoFit,
}: CommuneOutlineLayerProps) => {
  const map = useMap();
  const enabled = names.length > 0;
  const { ready, getFeatureByName } = useComunasGeoIndex(enabled);
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);
  const lastSignatureRef = useRef<string>("");
  const warnedRef = useRef<Set<string>>(new Set());

  // Construir FeatureCollection con solo las comunas pedidas (memo por nombres+ready).
  const fc = useMemo<FeatureCollection<Geometry, ComunaProps> | null>(() => {
    if (!ready || names.length === 0) return null;
    const features: ComunaFeature[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const f = getFeatureByName(name);
      if (f) {
        features.push({
          ...f,
          properties: { ...f.properties, _displayName: name } as ComunaProps & {
            _displayName: string;
          },
        });
      } else if (!warnedRef.current.has(name)) {
        missing.push(name);
        warnedRef.current.add(name);
      }
    }
    if (missing.length) {
      console.warn(
        "[CommuneOutlineLayer] No se encontró polígono para:",
        missing.join(", "),
      );
    }
    return { type: "FeatureCollection", features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, names.join("|")]);

  const styleFor = (feature?: ComunaFeature): PathOptions => {
    const display = (feature?.properties as { _displayName?: string } | undefined)
      ?._displayName;
    const isHighlight = highlightName && display === highlightName;
    return isHighlight
      ? {
          color: "hsl(38 92% 55%)",
          weight: 3.5,
          opacity: 1,
          fillColor: "hsl(38 92% 60%)",
          fillOpacity: 0.18,
        }
      : {
          color: "hsl(199 89% 60%)",
          weight: 2.5,
          opacity: 1,
          fillColor: "hsl(199 89% 60%)",
          fillOpacity: 0.05,
        };
  };

  // Re-style cuando cambia el highlight sin recrear las capas.
  useEffect(() => {
    const layer = geoJsonRef.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      const f = (l as unknown as { feature?: ComunaFeature }).feature;
      if (f) {
        (l as unknown as { setStyle: (s: PathOptions) => void }).setStyle(styleFor(f));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightName, fc]);

  // Auto-fit al conjunto cuando se actualiza la lista.
  useEffect(() => {
    if (!fc || fc.features.length === 0) return;
    const shouldFit = autoFit ?? fc.features.length > 1;
    const sig = names.slice().sort().join("|");
    if (sig === lastSignatureRef.current) return;
    lastSignatureRef.current = sig;
    if (!shouldFit) return;
    try {
      const bounds = L.geoJSON(fc as never).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      }
    } catch (e) {
      console.warn("[CommuneOutlineLayer] fitBounds:", e);
    }
  }, [fc, names, autoFit, map]);

  if (!fc || fc.features.length === 0) return null;

  // key fuerza re-mount cuando cambia la lista para que onEachFeature aplique
  // estilos nuevos (Leaflet no reemplaza features in-place).
  return (
    <GeoJSON
      key={names.slice().sort().join("|")}
      ref={(r) => {
        geoJsonRef.current = r as unknown as LeafletGeoJSON | null;
      }}
      data={fc}
      style={styleFor as never}
      interactive={false}
    />
  );
};
