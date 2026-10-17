import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { ThematicLayerRow } from "@/types/permits";
import { ProyectosPanelPortal } from "./proyectos/dock";
import { DockContext } from "./proyectos/dockContext";
import { REGISTRY, type Registry } from "./proyectos/registry";

interface Props {
  thematic: ThematicLayerRow[];
  visibleLayerIds: Set<string>;
  /** Solo para pruebas: otro registro de datasets. */
  registry?: Registry;
}

const Notice = ({ children }: { children: ReactNode }) => (
  <ProyectosPanelPortal>
    <div role="alert" data-testid="proyectos-notice" className="rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg">{children}</div>
  </ProyectosPanelPortal>
);

/** Un dataset que falla al pintarse no se lleva el mapa: se avisa en el dock y los demás siguen. */
class DatasetBoundary extends Component<{ dataset: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[proyectos] falló el dataset «${this.props.dataset}»`, error, info.componentStack); }
  render() {
    return this.state.error
      ? <Notice><b>Proyectos «{this.props.dataset}»</b><br />No se pudo dibujar esta capa: {this.state.error.message}</Notice>
      : this.props.children;
  }
}

const UnknownDataset = ({ dataset }: { dataset: string }) => {
  useEffect(() => { console.warn(`[proyectos] no hay un componente para el dataset «${dataset}» (proyectos/datasets/*.tsx)`); }, [dataset]);
  return <Notice><b>Capa de proyectos</b><br />No hay un renderer para el dataset «{dataset}».</Notice>;
};

/**
 * Monta las capas de PUNTOS (`thematic_layers.renderer = 'points_projects'`) que estén encendidas, un componente por DATASET.
 * Vive dentro del MapContainer (se monta junto a PermitsHost en TerritorialLayersHost). Los paneles van a un dock común.
 *
 * Para agregar un dataset (p. ej. INE) NO se edita este componente: se crea `proyectos/datasets/<nombre>.tsx` con
 * `export default { dataset: "<valor de thematic_layers.dataset>", Layer: MiComponente }`. Ver proyectos/README.md.
 */
export const ProyectosHost = ({ thematic, visibleLayerIds, registry = REGISTRY }: Props) => {
  const map = useMap();
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const active = thematic.filter((t) => t.renderer === "points_projects" && visibleLayerIds.has(t.layer_id));

  useEffect(() => {
    if (!dock) return;
    L.DomEvent.disableClickPropagation(dock);
    L.DomEvent.disableScrollPropagation(dock);
  }, [dock]);

  if (active.length === 0) return null;
  return (
    <DockContext.Provider value={dock}>
      {createPortal(
        <div ref={setDock} data-testid="proyectos-dock" className="absolute bottom-8 left-3 z-[1000] flex max-h-[80vh] w-80 flex-col gap-2 overflow-y-auto" />,
        map.getContainer(),
      )}
      {active.map((layer) => {
        const ds = registry.datasets.get(layer.dataset);
        return (
          <DatasetBoundary key={layer.layer_id} dataset={layer.dataset}>
            {ds ? <ds.Layer layer={layer} /> : <UnknownDataset dataset={layer.dataset} />}
          </DatasetBoundary>
        );
      })}
    </DockContext.Provider>
  );
};
