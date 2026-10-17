import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DockContext } from "./dockContext";

/**
 * Contenedor común de los paneles de todos los datasets de puntos (abajo a la izquierda del mapa). Cada dataset pinta su panel
 * con <ProyectosPanelPortal>: así dos fuentes activas a la vez se apilan en vez de superponerse, y ningún dataset decide la
 * posición ni toca los de los demás.
 */
export const ProyectosPanelPortal = ({ children }: { children: ReactNode }) => {
  const dock = useContext(DockContext);
  return dock ? createPortal(children, dock) : null;
};
