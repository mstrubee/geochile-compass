import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import {
  useDatasetProvenance, useIneCoverage, useIneCrfByComuna, useIneCrfCoverage, useIneCrfPolygons, useInePermitPoints, useIneVsMinvu, useSeiaProjects, useSeiaSummary,
} from "@/hooks/useProjects";
import { useMapViewport } from "@/hooks/useMapViewport";
import type { ThematicLayerRow } from "@/types/permits";
import { INE_CRF_DATASET, INE_PE_DATASET, SEIA_DATASET, type InePermitFilters, type SeiaFilters } from "@/types/projects";
import { SEIA_DEFAULT_STATES } from "@/utils/projectsScale";
import { IneCrfLayer, CRF_POLYGON_MIN_ZOOM } from "./IneCrfLayer";
import { IneCrfPanel } from "./IneCrfPanel";
import { InePermitPointsLayer, type PermitView } from "./InePermitPointsLayer";
import { InePermitPointsPanel } from "./InePermitPointsPanel";
import { SeiaProjectsLayer } from "./SeiaProjectsLayer";
import { SeiaProjectsPanel } from "./SeiaProjectsPanel";

type Renderer = ThematicLayerRow["renderer"];
const ORDER: Renderer[] = ["choropleth_comuna", "points_permits", "polygons_crf", "points_projects"];
const msg = (e: unknown) => (e ? (e as Error).message : null);

const PermitPointsHost = ({ offset }: { offset: number }) => {
  const map = useMap();
  const { bounds, zoom } = useMapViewport(true);
  const prov = useDatasetProvenance(INE_PE_DATASET, true);
  const cov = useIneCoverage(true);
  const diag = useIneVsMinvu(true);
  const [filters, setFilters] = useState<InePermitFilters>({ years: null, uso: null, minPrecision: 2 });
  const [view, setView] = useState<PermitView>("clusters");
  useEffect(() => {                                           // por defecto, el último año con datos: nunca todo el país de una vez
    const years = (cov.data ?? []).map((c) => c.year);
    if (filters.years == null && years.length) setFilters((f) => ({ ...f, years: [Math.max(...years)] }));
  }, [cov.data, filters.years]);
  const pts = useInePermitPoints(bounds, zoom, filters, filters.years != null);
  return (
    <>
      <InePermitPointsLayer rows={pts.data ?? []} view={view} />
      {createPortal(
        <InePermitPointsPanel filters={filters} onFilters={setFilters} view={view} onView={setView} coverage={cov.data} vsMinvu={diag.data}
          sources={prov.data ?? []} provenanceError={msg(prov.error) ?? msg(cov.error)} provenanceLoading={prov.isLoading}
          loading={pts.isFetching} error={msg(pts.error)} offset={offset} zoom={zoom} />,
        map.getContainer())}
    </>
  );
};

const CrfHost = ({ offset }: { offset: number }) => {
  const map = useMap();
  const { bounds, zoom } = useMapViewport(true);
  const prov = useDatasetProvenance(INE_CRF_DATASET, true);
  const cov = useIneCrfCoverage(true);
  const [years, setYears] = useState<number[] | null>(null);
  useEffect(() => {
    const ys = (cov.data ?? []).map((c) => c.year);
    if (years == null && ys.length) setYears([Math.max(...ys)]);
  }, [cov.data, years]);
  const polys = useIneCrfPolygons(bounds, years, years != null && zoom >= CRF_POLYGON_MIN_ZOOM);
  const byComuna = useIneCrfByComuna(years, years != null && zoom < CRF_POLYGON_MIN_ZOOM);
  const rows = useMemo(() => (polys.data ?? []).slice(0, 4000), [polys.data]);
  return (
    <>
      <IneCrfLayer polygons={zoom >= CRF_POLYGON_MIN_ZOOM ? rows : []} byComuna={zoom < CRF_POLYGON_MIN_ZOOM ? byComuna.data ?? [] : []} zoom={zoom} />
      {createPortal(
        <IneCrfPanel years={years} onYears={setYears} coverage={cov.data} sources={prov.data ?? []} provenanceError={msg(prov.error) ?? msg(cov.error)}
          provenanceLoading={prov.isLoading} loading={polys.isFetching || byComuna.isFetching} error={msg(polys.error) ?? msg(byComuna.error)}
          truncated={(polys.data?.length ?? 0) > 4000} offset={offset} zoom={zoom} />,
        map.getContainer())}
    </>
  );
};

const SeiaHost = ({ offset, layer }: { offset: number; layer: ThematicLayerRow }) => {
  const map = useMap();
  const { bounds } = useMapViewport(true);
  const prov = useDatasetProvenance(SEIA_DATASET, true);
  const summary = useSeiaSummary(true);
  const [filters, setFilters] = useState<SeiaFilters>({
    states: layer.default_params?.states?.length ? layer.default_params.states : SEIA_DEFAULT_STATES, forms: null, yearFrom: null, yearTo: null });
  const q = useSeiaProjects(bounds, filters, true);
  return (
    <>
      <SeiaProjectsLayer rows={q.data ?? []} />
      {createPortal(
        <SeiaProjectsPanel filters={filters} onFilters={setFilters} summary={summary.data} sources={prov.data ?? []}
          provenanceError={msg(prov.error) ?? msg(summary.error)} provenanceLoading={prov.isLoading} loading={q.isFetching} error={msg(q.error)}
          shown={q.data?.length ?? 0} offset={offset} />,
        map.getContainer())}
    </>
  );
};

interface Props { thematic: ThematicLayerRow[]; visibleLayerIds: Set<string> }

/**
 * Monta las capas de la Parte 4 (permisos georreferenciados del INE, recepciones finales del INE y proyectos del SEIA) cuando su capa temática
 * está visible. Vive dentro del MapContainer; cada panel se pinta en el contenedor del mapa y se apila a la izquierda del anterior.
 */
export const ProjectsHost = ({ thematic, visibleLayerIds }: Props) => {
  const on = (r: Renderer) => thematic.find((t) => t.renderer === r && visibleLayerIds.has(t.layer_id));
  const offset = (r: Renderer) => ORDER.slice(0, ORDER.indexOf(r)).filter((x) => on(x)).length;
  const seia = on("points_projects");
  return (
    <>
      {on("points_permits") && <PermitPointsHost offset={offset("points_permits")} />}
      {on("polygons_crf") && <CrfHost offset={offset("polygons_crf")} />}
      {seia && <SeiaHost offset={offset("points_projects")} layer={seia} />}
    </>
  );
};
