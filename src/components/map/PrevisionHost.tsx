import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { useCasenProvenance, useCasenRegion, useIsapreComuna, useIsapreProvenance, useIsapreResumen, useIsapreSinAlta } from "@/hooks/usePrevision";
import { DEFAULT_ISAPRE_FILTERS, MIN_TRAMO_60, type IsapreFilters } from "@/types/prevision";
import type { HealthAltaDef } from "@/types/health";
import type { ThematicLayerRow } from "@/types/permits";
import { isapreFilterLabel, midpoint } from "@/utils/previsionScale";
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
  const q = useIsapreComuna(filters, true);
  const sinAlta = useIsapreSinAlta(sinAltaDef, MIN_TRAMO_60, true);
  const breaks = useMemo(() => quantileBreaks((q.data ?? []).map(midpoint), 5), [q.data]);
  return (
    <>
      <IsapreChoroplethLayer rows={q.data} breaks={breaks} filterText={isapreFilterLabel(filters)} />
      {createPortal(
        <IsapreChoroplethPanel layer={layer} filters={filters} onFilters={setFilters} rows={q.data} breaks={breaks} loading={q.isFetching} error={msg(q.error)}
          resumen={resumen.data?.[0]} resumenError={msg(resumen.error)} sinAlta={sinAlta.data?.[0]} sinAltaError={msg(sinAlta.error)} sinAltaLoading={sinAlta.isFetching}
          sinAltaDef={sinAltaDef} onSinAltaDef={setSinAltaDef} sources={prov.data ?? []} provenanceError={msg(prov.error)} provenanceLoading={prov.isLoading} offset={offset} />,
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
