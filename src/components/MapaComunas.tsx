import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Layer, PathOptions, GeoJSON as LeafletGeoJSON, LeafletMouseEvent } from "leaflet";

interface ComunaProps {
  cod_comuna: string;
  nom_comuna: string;
}

interface MapaComunasProps {
  valoresPorComuna?: Record<string, number>;
  onComunaClick?: (codComuna: string, nombre: string) => void;
}

const MIN_COLOR = [219, 234, 254]; // #dbeafe
const MAX_COLOR = [30, 58, 138];   // #1e3a8a

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const interpolateColor = (t: number): string => {
  const clamped = Math.max(0, Math.min(1, t));
  const r = lerp(MIN_COLOR[0], MAX_COLOR[0], clamped);
  const g = lerp(MIN_COLOR[1], MAX_COLOR[1], clamped);
  const b = lerp(MIN_COLOR[2], MAX_COLOR[2], clamped);
  return `rgb(${r}, ${g}, ${b})`;
};

const MapaComunas = ({ valoresPorComuna, onComunaClick }: MapaComunasProps) => {
  const [data, setData] = useState<FeatureCollection<Geometry, ComunaProps> | null>(null);
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);

  useEffect(() => {
    fetch("/comunas.geojson")
      .then((r) => r.json())
      .then((json: FeatureCollection<Geometry, ComunaProps>) => setData(json))
      .catch((err) => console.error("Error cargando comunas.geojson:", err));
  }, []);

  const maxValor = valoresPorComuna
    ? Math.max(0, ...Object.values(valoresPorComuna))
    : 0;

  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    if (!feature) {
      return { fillColor: "#3b82f6", fillOpacity: 0.45, color: "#1e3a8a", weight: 0.6 };
    }
    if (!valoresPorComuna || maxValor <= 0) {
      return { fillColor: "#3b82f6", fillOpacity: 0.45, color: "#1e3a8a", weight: 0.6 };
    }
    const valor = valoresPorComuna[feature.properties.cod_comuna];
    const t = valor === undefined ? 0 : valor / maxValor;
    return {
      fillColor: interpolateColor(t),
      fillOpacity: 0.7,
      color: "#1e3a8a",
      weight: 0.6,
    };
  };

  // Re-style when valoresPorComuna changes, without recreating the map
  useEffect(() => {
    const layer = geoJsonRef.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      const feature = (l as unknown as { feature?: Feature<Geometry, ComunaProps> }).feature;
      if (feature) {
        (l as unknown as { setStyle: (s: PathOptions) => void }).setStyle(styleFor(feature));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valoresPorComuna, data]);

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const { nom_comuna, cod_comuna } = feature.properties;
    layer.bindPopup(`<strong>${nom_comuna}</strong><br/>Código: ${cod_comuna}`);

    layer.on({
      mouseover: (e: LeafletMouseEvent) => {
        const target = e.target as unknown as {
          setStyle: (s: PathOptions) => void;
          bringToFront: () => void;
        };
        target.setStyle({ weight: 2, color: "#1d4ed8", fillOpacity: 0.65 });
        target.bringToFront();
      },
      mouseout: () => {
        geoJsonRef.current?.resetStyle(layer as never);
      },
      click: () => {
        onComunaClick?.(cod_comuna, nom_comuna);
      },
    });
  };

  return (
    <div className="w-full h-full min-h-[500px] relative">
      {!data && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
          Cargando comunas...
        </div>
      )}
      <MapContainer
        center={[-35.5, -71.0]}
        zoom={5}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        {data && (
          <GeoJSON
            ref={(r) => {
              geoJsonRef.current = r as unknown as LeafletGeoJSON | null;
            }}
            data={data}
            style={styleFor as never}
            onEachFeature={onEachFeature}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default MapaComunas;
