import { useEffect, useRef, useState } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions } from "leaflet";

interface ComunaProps {
  codigo_comuna?: string;
  cod_comuna?: string;
  nom_comuna?: string;
}

interface ChileCommunesLayerProps {
  visible: boolean;
}

/**
 * Polígonos de las 346 comunas de Chile (GeoJSON estático en /public).
 * Popup muestra nombre + código, mapeando el código por /codigos_territoriales.csv.
 */
export const ChileCommunesLayer = ({ visible }: ChileCommunesLayerProps) => {
  const [geojson, setGeojson] = useState<FeatureCollection<Geometry, ComunaProps> | null>(null);
  const [nombresPorCodigo, setNombresPorCodigo] = useState<Record<string, string>>({});
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);

  // Cargar GeoJSON una sola vez (al activar la capa por primera vez)
  useEffect(() => {
    if (!visible || geojson) return;
    let cancelled = false;
    fetch("/comunas.geojson")
      .then(async (r) => {
        const ct = r.headers.get("content-type") ?? "";
        if (!r.ok || ct.includes("text/html")) {
          throw new Error(
            `No se encontró /comunas.geojson en public/. El servidor devolvió ${r.status} (${ct}). Sube el archivo a public/comunas.geojson.`,
          );
        }
        return r.json() as Promise<FeatureCollection<Geometry, ComunaProps>>;
      })
      .then((data) => {
        if (!cancelled) {
          console.log("[ChileCommunesLayer] GeoJSON cargado:", data.features?.length, "comunas");
          setGeojson(data);
        }
      })
      .catch((e) => console.error("[ChileCommunesLayer]", e instanceof Error ? e.message : e));
    return () => {
      cancelled = true;
    };
  }, [visible, geojson]);

  // Cargar CSV de nombres una sola vez
  useEffect(() => {
    if (!visible || Object.keys(nombresPorCodigo).length > 0) return;
    let cancelled = false;
    fetch("/codigos_territoriales.csv")
      .then((r) => r.text())
      .then((csv) => {
        const lineas = csv.trim().split(/\r?\n/);
        const mapa: Record<string, string> = {};
        for (let i = 1; i < lineas.length; i++) {
          const cols = lineas[i].split(",");
          if (cols.length < 6) continue;
          const codigo = cols[4]?.trim();
          const nombre = cols[5]?.trim();
          if (codigo && nombre) mapa[codigo] = nombre;
        }
        if (!cancelled) setNombresPorCodigo(mapa);
      })
      .catch((e) => console.error("[ChileCommunesLayer] CSV:", e));
    return () => {
      cancelled = true;
    };
  }, [visible, nombresPorCodigo]);

  if (!visible) return null;
  const ready = geojson && Object.keys(nombresPorCodigo).length > 0;
  if (!ready) return null;

  const style = (): PathOptions => ({
    fillColor: "hsl(199 89% 60%)",
    fillOpacity: 0.15,
    color: "hsl(199 89% 50%)",
    weight: 0.8,
  });

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const codigo =
      feature.properties.codigo_comuna ?? feature.properties.cod_comuna ?? "";
    layer.bindPopup(() => {
      const nombre =
        nombresPorCodigo[codigo] ?? feature.properties.nom_comuna ?? "Comuna desconocida";
      return `<div style="min-width:140px"><strong>${nombre}</strong><br/><span style="font-size:10px;opacity:0.7">Código: ${codigo}</span></div>`;
    });
    layer.on({
      mouseover: (e) => {
        const l = e.target as { setStyle: (s: PathOptions) => void; bringToFront: () => void };
        l.setStyle({ weight: 2, color: "hsl(199 89% 70%)", fillOpacity: 0.3 });
        l.bringToFront();
      },
      mouseout: (e) => {
        geoJsonRef.current?.resetStyle(e.target);
      },
    });
  };

  return (
    <GeoJSON
      ref={(r) => {
        geoJsonRef.current = r as unknown as LeafletGeoJSON | null;
      }}
      data={geojson}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
};
