import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { useCasenProvenance, useCasenRegion, useIsapreComuna, useIsaprePenetracion, useIsapreProvenance, useIsapreResumen, useIsapreSinAlta } from "@/hooks/usePrevision";
import { usePoblacionProvenance } from "@/hooks/usePoblacion";
import { DEFAULT_ISAPRE_FILTERS, MIN_TRAMO_60, type IsapreFilters, type IsapreMetric } from "@/types/prevision";
import type { HealthAltaDef } from "@/types/health";
import type { ThematicLayerRow } from "@/types/permits";
import { isapreFilterLabel, midpoint, pctDomain, penetracionRowsShown } from "@/utils/previsionScale";
import { quantileBreaks } from "@/utils/permitsScale";
import { IsapreChoroplethLayer } from "./IsapreChoroplethLayer";
import { CasenRegionPanel, IsapreChoroplethPanel } from "./PrevisionPanels";

type Renderer = ThematicLayerRow["renderer"];
/** Los paneles de previsión se apilan a la izquierda de los de permisos, proyectos y establecimientos que estén abiertos. */
const OTHERS: Renderer[] = ["choropleth_comuna", "points_permits", "polygons_crf", "points_projects", "points_health", "choropleth_health"];
const PREVISION_ORDER: Renderer[] = ["choropleth_isapre", "panel_casen_region"];
const msg = (e: unknown) => (e ? (e as Error).message : null);

const IsapreHost = ({ offset, layer }: { offset: number; layer: ThematicLayerRow }) => {
  const map = useMap();
  const prov = useIsapreProvenance(true);
  const resumen = useIsapreResumen(true);
  const [filters, setFilters] = useState<IsapreFilters>(DEFAULT_ISAPRE_FILTERS);
  const [sinAltaDef, setSinAltaDef] = useState<HealthAltaDef>("hospital");
  const [metric, setMetric] = useState<IsapreMetric>("n");
  const q = useIsapreComuna(filters, true);
  // 1b-2: la penetración se pide siempre (la ventana de la comuna la usa con cualquier métrica). El filtro «sin alta» no viaja a la RPC: se aplica con las comunas de `q`.
  const pen = useIsaprePenetracion(filters, true);
  const censoProv = usePoblacionProvenance(true);
  const allowed = useMemo(() => (filters.sinAlta ? new Set((q.data ?? []).map((r) => r.cut)) : null), [filters.sinAlta, q.data]);
  const penShown = useMemo(() => penetracionRowsShown(pen.data, allowed), [pen.data, allowed]);
  const domain = useMemo(() => pctDomain(penShown), [penShown]);
  const sources = useMemo(() => ({
    isapre: { period_end: resumen.data?.[0]?.period_end ?? pen.data?.[0]?.isapre_period_end ?? null, declared_date: resumen.data?.[0]?.declared_date ?? null },
    censo: { period_end: pen.data?.[0]?.censo_period_end ?? censoProv.data?.[0]?.period_end ?? null, declared_date: censoProv.data?.[0]?.declared_date ?? null },
  }), [resumen.data, pen.data, censoProv.data]);
  const onMetric = (m: IsapreMetric) => {
    setMetric(m);
    if (m === "pct" && filters.sexo === "SI") setFilters({ ...filters, sexo: null });   // el Censo no tiene «sexo sin información»
  };
  const sinAlta = useIsapreSinAlta(sinAltaDef, MIN_TRAMO_60, true);
  const breaks = useMemo(() => quantileBreaks((q.data ?? []).map(midpoint), 5), [q.data]);
  return (
    <>
      <IsapreChoroplethLayer rows={q.data} breaks={breaks} filterText={isapreFilterLabel(filters)} metric={metric} penRows={pen.data} penShown={penShown} domain={domain}
        sexoSinInfo={filters.sexo === "SI"} sources={sources} />
      {createPortal(
        <IsapreChoroplethPanel layer={layer} filters={filters} onFilters={setFilters} rows={q.data} breaks={breaks} loading={q.isFetching} error={msg(q.error)}
          resumen={resumen.data?.[0]} resumenError={msg(resumen.error)} sinAlta={sinAlta.data?.[0]} sinAltaError={msg(sinAlta.error)} sinAltaLoading={sinAlta.isFetching}
          sinAltaDef={sinAltaDef} onSinAltaDef={setSinAltaDef} sources={[...(prov.data ?? []), ...(censoProv.data ?? [])]} provenanceError={msg(prov.error) ?? msg(censoProv.error)} provenanceLoading={prov.isLoading || censoProv.isLoading} offset={offset}
          metric={metric} onMetric={onMetric} penRows={pen.data} penShown={penShown} domain={domain} penLoading={pen.isFetching} penError={msg(pen.error)} />,
        map.getContainer())}
    </>
  );
};

const CasenHost = ({ offset, layer }: { offset: number; layer: ThematicLayerRow }) => {
  const map = useMap();
  const prov = useCasenProvenance(true);
  const q = useCasenRegion(true);
  return createPortal(
    <CasenRegionPanel layer={layer} rows={q.data} loading={q.isFetching} error={msg(q.error)} sources={prov.data ?? []} provenanceError={msg(prov.error)} provenanceLoading={prov.isLoading} offset={offset} />,
    map.getContainer());
};

interface Props { thematic: ThematicLayerRow[]; visibleLayerIds: Set<string> }

/**
 * Monta las capas de previsión (Isapre por comuna y panel regional CASEN) cuando su capa temática está visible.
 * Renderers PROPIOS (`choropleth_isapre`, `panel_casen_region`): `choropleth_comuna` lo captura PermitsHost. CASEN es SOLO panel: no pinta comunas (D6).
 */
export const PrevisionHost = ({ thematic, visibleLayerIds }: Props) => {
  const on = (r: Renderer) => thematic.find((t) => t.renderer === r && visibleLayerIds.has(t.layer_id));
  const offset = (r: Renderer) => OTHERS.filter((x) => on(x)).length + PREVISION_ORDER.slice(0, PREVISION_ORDER.indexOf(r)).filter((x) => on(x)).length;
  const isapre = on("choropleth_isapre");
  const casen = on("panel_casen_region");
  return (
    <>
      {isapre && <IsapreHost offset={offset("choropleth_isapre")} layer={isapre} />}
      {casen && <CasenHost offset={offset("panel_casen_region")} layer={casen} />}
    </>
  );
};
