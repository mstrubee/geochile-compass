import { useMemo } from "react";
import { CircleMarker, GeoJSON, Popup } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { CrfByComunaRow, CrfPolygonRow } from "@/types/projects";
import { clusterRadius, fmtInt } from "@/utils/projectsScale";
import { quantileBreaks, SEQUENTIAL } from "@/utils/permitsScale";
import { renderToStaticMarkup } from "react-dom/server";
import { CrfPopup } from "./ProjectPopups";

export const CRF_POLYGON_MIN_ZOOM = 12;

const colorFor = (v: number, breaks: number[]) => SEQUENTIAL[Math.min(breaks.filter((b) => v >= b).length, SEQUENTIAL.length - 1)];

/** Recepciones finales: polígonos (huellas) con zoom ≥ 12; por debajo, burbujas por comuna con las viviendas certificadas. */
export const IneCrfLayer = ({ polygons, byComuna, zoom }: { polygons: CrfPolygonRow[]; byComuna: CrfByComunaRow[]; zoom: number }) => {
  const fc = useMemo<FeatureCollection | null>(() => {
    if (zoom < CRF_POLYGON_MIN_ZOOM) return null;
    const features: Feature<Geometry, CrfPolygonRow>[] = polygons.flatMap((p) => {
      try { return [{ type: "Feature" as const, properties: p, geometry: JSON.parse(p.geojson) as Geometry }]; } catch { return []; }
    });
    return { type: "FeatureCollection", features } as FeatureCollection;
  }, [polygons, zoom]);
  const breaks = useMemo(() => quantileBreaks(polygons.map((p) => p.dwellings)), [polygons]);

  if (fc) {
    return (
      <GeoJSON
        key={`crf-${polygons.length}-${polygons[0]?.src_oid ?? 0}`}
        data={fc}
        style={(f) => {
          const p = f?.properties as CrfPolygonRow;
          return { color: p.geom_status > 0 ? "#dc2626" : "#065f46", weight: p.geom_status > 0 ? 2 : 1, dashArray: p.geom_status > 0 ? "3 2" : undefined,
                   fillColor: colorFor(p.dwellings, breaks), fillOpacity: 0.7 };
        }}
        onEachFeature={(f, layer) => {
          const p = f.properties as CrfPolygonRow;
          layer.bindTooltip(`${fmtInt(p.dwellings)} viv. · ${p.year}`);
          layer.bindPopup(renderToStaticMarkup(<CrfPopup row={p} />));
        }}
      />
    );
  }
  return (
    <>
      {byComuna.filter((c) => c.lon != null && c.lat != null).map((c) => (
        <CircleMarker key={c.comuna_cut} center={[c.lat as number, c.lon as number]} radius={clusterRadius(c.dwellings)}
          pathOptions={{ color: "#065f46", weight: 1, fillColor: "#10b981", fillOpacity: 0.5 }}>
          <Popup>
            <div className="space-y-1 text-xs" data-testid="popup-crf-comuna">
              <div className="text-sm font-semibold">Recepciones finales · comuna {c.comuna_cut}</div>
              <div>Viviendas de los certificados (suma): {fmtInt(c.dwellings)}</div>
              <div>Polígonos: {fmtInt(c.polygons)}</div>
              <div className="text-muted-foreground">Acerque el mapa (zoom ≥ {CRF_POLYGON_MIN_ZOOM}) para ver cada obra.</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
};

