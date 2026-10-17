import { createContext } from "react";

/** Contenedor común de los paneles de los datasets de puntos; lo provee ProyectosHost. Ver dock.tsx. */
export const DockContext = createContext<HTMLElement | null>(null);
