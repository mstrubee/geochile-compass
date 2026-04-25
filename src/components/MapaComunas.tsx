import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L, { Layer, PathOptions } from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "leaflet/dist/leaflet.css";

interface Props {
  valoresPorComuna?: Record<string, number>;
  onComunaClick?: (codComuna: string, nombre: string) => void;
}

interface ComunaProps {
  codigo_comuna: string;
}

export default function MapaComunas({ valoresPorComuna, onComunaClick }: Props) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [nombresPorCodigo, setNombresPorCodigo] = useState<Record<string, string>>({});
  const geoJsonRef = useRef<L.GeoJSON | null>(null);

  // Cargar GeoJSON
  useEffect(() => {
    fetch("/comunas.geojson")
      .then((r) => r.json())
      .then((data) => {
        console.log("[DEBUG] GeoJSON cargado:", data.features?.length, "features");
        console.log("[DEBUG] Primer feature properties:", data.features?.[0]?.properties);
        setGeojson(data);
      })
      .catch((e) => console.error("Error cargando GeoJSON:", e));
  }, []);

  // Cargar CSV de nombres
  useEffect(() => {
    fetch("/codigos_territoriales.csv")
      .then((r) => r.text())
      .then((csv) => {
        const lineas = csv.trim().split("\n");
        const mapa: Record<string, string> = {};
        // Saltar header (primera línea)
        for (let i = 1; i < lineas.length; i++) {
          const cols = lineas[i].split(",");
          const codigo = cols[0]?.trim();
          const nombre = cols[1]?.trim();
          if (codigo && nombre) mapa[codigo] = nombre;
        }
        console.log("[DEBUG] CSV cargado:", Object.keys(mapa).length, "códigos");
        setNombresPorCodigo(mapa);
      })
      .catch((e) => console.error("Error cargando CSV:", e));
  }, []);

  // Escala de color
  const max = useMemo(() => {
    if (!valoresPorComuna) return 1;
    return Math.max(...Object.values(valoresPorComuna), 1);
  }, [valoresPorComuna]);

  const colorPara = (cod: string): string => {
    if (!valoresPorComuna) return "#3b82f6";
    const v = valoresPorComuna[cod] ?? 0;
    const t = v / max;
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${lerp(219, 30)}, ${lerp(234, 58)}, ${lerp(254, 138)})`;
  };

  const styleFeature = (f?: Feature<Geometry, ComunaProps>): PathOptions => ({
    fillColor: colorPara(f?.properties?.codigo_comuna ?? ""),
    fillOpacity: 0.45,
    color: "#1e3a8a",
    weight: 0.6,
  });

  // Re-pintar al cambiar valores
  useEffect(() => {
    geoJsonRef.current?.setStyle(styleFeature as L.StyleFunction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valoresPorComuna]);

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const codigo = feature.properties.codigo_comuna;

    // bindPopup con función → se evalúa al abrir, no al renderizar
    layer.bindPopup(() => {
      const nombre = nombresPorCodigo[codigo] ?? "Sin nombre";
      return `<strong>${nombre}</strong><br/>Código: ${codigo}`;
    });

    layer.on({
      mouseover: (e) => {
        const l = e.target as L.Path;
        l.setStyle({ weight: 2, color: "#1d4ed8", fillOpacity: 0.65 });
        l.bringToFront();
      },
      mouseout: (e) => {
        geoJsonRef.current?.resetStyle(e.target);
      },
      click: () => {
        const nombre = nombresPorCodigo[codigo] ?? "Sin nombre";
        onComunaClick?.(codigo, nombre);
      },
    });
  };

  // Renderizar GeoJSON SOLO cuando ambos archivos están listos
  const todoListo = geojson && Object.keys(nombresPorCodigo).length > 0;

  return (
    <div className="w-full h-full min-h-[500px]">
      <MapContainer
        center={[-35.5, -71.0]}
        zoom={5}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />
        {todoListo && (
          <GeoJSON
            ref={geoJsonRef}
            data={geojson!}
            style={styleFeature as L.StyleFunction}
            onEachFeature={onEachFeature}
          />
        )}
      </MapContainer>
    </div>
  );
}
