import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { useHealthComunaCounts, useHealthPoints, useHealthProvenance, useHealthSummary, useHealthTipos } from "@/hooks/useHealth";
import { useComunasGeoIndex } from "@/hooks/useComunasGeoIndex";
import { useMapViewport } from "@/hooks/useMapViewport";
import { DEFAULT_HEALTH_FILTERS, type HealthFilters } from "@/types/health";
import type { ThematicLayerRow } from "@/types/permits";
import { filterLabel, GEO_MARKED } from "@/utils/healthScale";
import { quantileBreaks } from "@/utils/permitsScale";
import { HealthChoroplethLayer } from "./HealthChoroplethLayer";
import { HealthChoroplethPanel, HealthPointsPanel } from "./HealthPanels";
import { HealthPointsLayer } from "./HealthPointsLayer";

type Renderer = ThematicLayerRow["renderer"];
/** Los paneles de salud se apilan A LA IZQUIERDA de los de permisos/proyectos que estén abiertos (ellos no saben de salud). */
const OTHERS: Renderer[] = ["choropleth_comuna", "points_permits", "polygons_crf", "points_projects"];
const HEALTH_ORDER: Renderer[] = ["points_health", "choropleth_health"];
const msg = (e: unknown) => (e ? (e as Error).message : null);

const initialFilters = (layer: ThematicLayerRow): HealthFilters => ({ ...DEFAULT_HEALTH_FILTERS, includeClosed: layer.default_params?.include_closed === true });

const useFicha = () => {
  const [open, setOpen] = useState(false);
  const summary = useHealthSummary(open);
  const tipos = useHealthTipos(open);
  return { setOpen, summary: summary.data, summaryError: msg(summary.error), tipos: tipos.data, tiposError: msg(tipos.error) };
};

const PointsHost = ({ offset, layer }: { offset: number; layer: ThematicLayerRow }) => {
  const map = useMap();
  const { bounds } = useMapViewport(true);
  const prov = useHealthProvenance(true);
  const ficha = useFicha();
  const [filters, setFilters] = useState<HealthFilters>(() => initialFilters(layer));
  const q = useHealthPoints(bounds, filters, true);
  const rows = useMemo(() => q.data ?? [], [q.data]);
  return (
    <>
      <HealthPointsLayer rows={rows} />
      {createPortal(
        <HealthPointsPanel layer={layer} filters={filters} onFilters={setFilters} sources={prov.data ?? []} provenanceError={msg(prov.error)} provenanceLoading={prov.isLoading}
          summary={ficha.summary} summaryError={ficha.summaryError} tipos={ficha.tipos} tiposError={ficha.tiposError} onFichaOpen={ficha.setOpen}
          loading={q.isFetching} error={msg(q.error)} offset={offset} shown={rows.length} totalMatching={rows[0]?.total_matching ?? null}
          imputedShown={rows.filter((r) => r.clase_fuente === "tabla").length} markedShown={rows.filter((r) => GEO_MARKED.has(r.geo_status)).length} />,
        map.getContainer())}
    </>
  );
};

const ChoroplethHost = ({ offset, layer }: { offset: number; layer: ThematicLayerRow }) => {
  const map = useMap();
  const geo = useComunasGeoIndex(true);
  const prov = useHealthProvenance(true);
  const ficha = useFicha();
  const [filters, setFilters] = useState<HealthFilters>(() => initialFilters(layer));
  const q = useHealthComunaCounts(filters, true);
  const breaks = useMemo(() => quantileBreaks((q.data ?? []).map((r) => r.establishments), 5), [q.data]);
  const missingPolygons = useMemo(() => {
    if (!geo.fc) return 0;
    const have = new Set(geo.fc.features.map((f) => String(f.properties?.codigo_comuna ?? f.properties?.cod_comuna ?? "")));
    return (q.data ?? []).filter((r) => r.establishments > 0 && !have.has(r.cut)).length;
  }, [geo.fc, q.data]);
  const onPick = (cut: string) => {
    const f = geo.fc?.features.find((x) => String(x.properties?.codigo_comuna ?? x.properties?.cod_comuna ?? "") === cut);
    if (!f) return;
    const b = L.geoJSON(f as never).getBounds();
    if (b.isValid()) map.fitBounds(b, { maxZoom: 12 });
  };
  return (
    <>
      <HealthChoroplethLayer rows={q.data} breaks={breaks} filterText={filterLabel(filters)} />
      {createPortal(
        <HealthChoroplethPanel layer={layer} filters={filters} onFilters={setFilters} sources={prov.data ?? []} provenanceError={msg(prov.error)} provenanceLoading={prov.isLoading}
          summary={ficha.summary} summaryError={ficha.summaryError} tipos={ficha.tipos} tiposError={ficha.tiposError} onFichaOpen={ficha.setOpen}
          loading={q.isFetching} error={msg(q.error)} offset={offset} rows={q.data} breaks={breaks} missingPolygons={missingPolygons} onPick={onPick} />,
        map.getContainer())}
    </>
  );
};

interface Props { thematic: ThematicLayerRow[]; visibleLayerIds: Set<string> }

/**
 * Monta las capas de Salud (establecimientos como puntos y establecimientos por comuna) cuando su capa temática está visible.
 * Renderers PROPIOS (`points_health`, `choropleth_health`): `choropleth_comuna` lo captura PermitsHost.
 */
export const HealthHost = ({ thematic, visibleLayerIds }: Props) => {
  const on = (r: Renderer) => thematic.find((t) => t.renderer === r && visibleLayerIds.has(t.layer_id));
  const offset = (r: Renderer) => OTHERS.filter((x) => on(x)).length + HEALTH_ORDER.slice(0, HEALTH_ORDER.indexOf(r)).filter((x) => on(x)).length;
  const points = on("points_health");
  const choro = on("choropleth_health");
  return (
    <>
      {points && <PointsHost offset={offset("points_health")} layer={points} />}
      {choro && <ChoroplethHost offset={offset("choropleth_health")} layer={choro} />}
    </>
  );
};
