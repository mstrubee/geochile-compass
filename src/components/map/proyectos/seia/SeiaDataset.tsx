import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap, useMapEvents } from "react-leaflet";
import { useSeiaFacets, useSeiaProjects, useSeiaProvenance } from "@/hooks/useSeia";
import type { Bbox, SeiaFilters, SeiaProjectRow } from "@/types/seia";
import { initialFilters, parseSeiaDefaults, queryBbox } from "@/utils/seiaFilters";
import { ProyectosPanelPortal } from "../dock";
import type { ProyectosDatasetProps } from "../types";
import { SeiaFichaDialog } from "./SeiaFichaDialog";
import { SeiaPanel } from "./SeiaPanel";
import { SeiaPointsLayer } from "./SeiaPointsLayer";

const currentBbox = (map: ReturnType<typeof useMap>): Bbox => {
  const b = map.getBounds();
  return queryBbox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
};

/**
 * Capa «Proyectos SEIA»: puntos de los expedientes del recuadro visible, con filtros y ficha. Consulta por recuadro (la RPC usa el
 * GIST) y no trae todo el país. Lo configurable de la hoja (tipologías de partida, fuentes) viene de `thematic_layers.default_params`.
 */
export const SeiaDataset = ({ layer }: ProyectosDatasetProps) => {
  const map = useMap();
  const defaults = useMemo(() => parseSeiaDefaults(layer.default_params), [layer.default_params]);
  const prov = useSeiaProvenance(true);
  const facets = useSeiaFacets(defaults.sourceKeys, true);
  const [init, setInit] = useState<{ filters: SeiaFilters; notice: string | null } | null>(null);
  const [filters, setFilters] = useState<SeiaFilters | null>(null);
  const [bbox, setBbox] = useState<Bbox>(() => currentBbox(map));
  const [selected, setSelected] = useState<{ source_key: string; external_id: string } | null>(null);

  useMapEvents({ moveend: () => setBbox(currentBbox(map)) });

  // Los filtros de partida se calculan UNA vez, cuando llegan los valores reales de los datos.
  useEffect(() => {
    if (init == null && facets.data) {
      const i = initialFilters(defaults, facets.data);
      setInit(i);
      setFilters(i.filters);
    }
  }, [init, facets.data, defaults]);

  const projects = useSeiaProjects(bbox, filters, filters != null);
  const rows = projects.data;
  const pick = (r: SeiaProjectRow) => setSelected({ source_key: r.source_key, external_id: r.external_id });

  return (
    <>
      {rows && <SeiaPointsLayer rows={rows} onSelect={pick} />}
      <ProyectosPanelPortal>
        {filters ? (
          <SeiaPanel
            filters={filters}
            onChange={setFilters}
            facets={facets.data}
            facetsError={facets.error ? (facets.error as Error).message : null}
            provenance={prov.data}
            provenanceError={prov.error ? (prov.error as Error).message : null}
            rows={rows}
            loading={projects.isFetching && !rows}
            error={projects.error ? (projects.error as Error).message : null}
            notice={init?.notice ?? null}
          />
        ) : (
          <div data-testid="seia-loading" role="status" className="rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg">
            <b>Proyectos SEIA</b><br />
            {facets.error ? `No se pudo leer el resumen de los datos: ${(facets.error as Error).message}` : "Cargando…"}
          </div>
        )}
      </ProyectosPanelPortal>
      {createPortal(<SeiaFichaDialog selected={selected} onClose={() => setSelected(null)} />, document.body)}
    </>
  );
};
