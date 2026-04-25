import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Layer } from "leaflet";

interface ComunaProps {
  cod_comuna: string;
  nom_comuna: string;
}

const MapaComunas = () => {
  const [data, setData] = useState<FeatureCollection<Geometry, ComunaProps> | null>(null);

  useEffect(() => {
    fetch("/comunas.geojson")
      .then((r) => r.json())
      .then((json: FeatureCollection<Geometry, ComunaProps>) => setData(json))
      .catch((err) => console.error("Error cargando comunas.geojson:", err));
  }, []);

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const { nom_comuna, cod_comuna } = feature.properties;
    layer.bindPopup(`<strong>${nom_comuna}</strong><br/>Código: ${cod_comuna}`);
  };

  return (
    <div className="w-full h-full min-h-[500px]">
      <MapContainer
        center={[-35.5, -71.0]}
        zoom={5}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        {data && (
          <GeoJSON
            data={data}
            style={() => ({
              fillColor: "#3b82f6",
              fillOpacity: 0.45,
              color: "#1e3a8a",
              weight: 0.6,
            })}
            onEachFeature={onEachFeature}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default MapaComunas;
