import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import { useComunasGeoIndex } from "@/hooks/useComunasGeoIndex";
import { useLayerProvenance, usePermitChoropleth } from "@/hooks/usePermits";
import type { PermitSelection, ThematicLayerRow } from "@/types/permits";
import { defaultSelection, normalizeSelection } from "@/utils/permitsPeriods";
import { displayValue, quantileBreaks, YOY_BREAKS } from "@/utils/permitsScale";
import { PermitsChoroplethLayer } from "./PermitsChoroplethLayer";
import { PermitsFichaDialog } from "./PermitsFichaDialog";
import { PermitsPanel } from "./PermitsPanel";

interface Props {
  thematic: ThematicLayerRow[];
  visibleLayerIds: Set<string>;
}

/**
 * Monta la capa "Permisos de edificación" cuando alguna capa temática `choropleth_comuna` está visible.
 * Vive dentro del MapContainer; el panel se pinta en el contenedor del mapa para no tocar Index.tsx.
 */
export const PermitsHost = ({ thematic, visibleLayerIds }: Props) => {
  const map = useMap();
  const layer = thematic.find((t) => t.renderer === "choropleth_comuna" && visibleLayerIds.has(t.layer_id));
  const enabled = layer != null;
  const prov = useLayerProvenance(enabled);
  const [selection, setSelection] = useState<PermitSelection | null>(null);
  const [ficha, setFicha] = useState<{ cut: string; name: string } | null>(null);
  const { fc } = useComunasGeoIndex(enabled);

  useEffect(() => {
    if (enabled && selection == null && prov.data) {
      setSelection(defaultSelection(prov.data, { metric: layer?.default_params?.metric, destination: layer?.default_params?.destination_class }));
    }
  }, [enabled, selection, prov.data, layer]);

  // Si cambian los datos cargados (p. ej. llega un año nuevo) la selección se corrige sola.
  const current = useMemo(() => (selection && prov.data ? normalizeSelection(selection, prov.data) : selection), [selection, prov.data]);
  const choro = usePermitChoropleth(current, enabled);
  const rows = choro.data;

  const breaks = useMemo(() => {
    if (!current) return [];
    if (current.display === "yoy") return [...YOY_BREAKS];
    return quantileBreaks((rows ?? []).map((r) => displayValue(r, "value")).filter((v): v is number => v != null));
  }, [rows, current]);

  const missingPolygons = useMemo(() => {
    if (!fc || !rows) return [];
    const have = new Set(fc.features.map((f) => String(f.properties?.codigo_comuna ?? "")));
    return rows.filter((r) => r.value != null && !have.has(r.comuna_cut)).map((r) => r.comuna_cut);
  }, [fc, rows]);

  if (!enabled) return null;
  if (!current) {
    // Sin selección posible: se dice por qué, en vez de dejar la capa "encendida" y vacía.
    const msg = prov.error
      ? `No se pudo leer la procedencia de los datos: ${(prov.error as Error).message}`
      : prov.isLoading ? "Cargando…" : "Todavía no hay datos de permisos de edificación cargados.";
    return createPortal(
      <div data-testid="permits-empty" role="status" className="absolute bottom-8 right-3 z-[1000] w-72 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg">
        <b>Permisos de edificación</b><br />{msg}
      </div>,
      map.getContainer(),
    );
  }
  return (
    <>
      <PermitsChoroplethLayer rows={rows} selection={current} breaks={breaks} onSelectComuna={(cut, name) => setFicha({ cut, name })} />
      {createPortal(
        <PermitsPanel
          selection={current}
          onChange={setSelection}
          provenance={prov.data}
          provenanceError={prov.error ? (prov.error as Error).message : null}
          loading={choro.isLoading}
          error={choro.error ? (choro.error as Error).message : null}
          rows={rows}
          breaks={breaks}
          missingPolygons={missingPolygons}
        />,
        map.getContainer(),
      )}
      {createPortal(
        <PermitsFichaDialog comuna={ficha} metric={current.metric} destination={current.destination} onClose={() => setFicha(null)} />,
        document.body,
      )}
    </>
  );
};
