// Secciones gestionables por permisos. La key se usa como identificador estable
// en custom_roles.permissions y debe coincidir con el `permissionKey` que se pasa
// a <SidebarSection /> en src/components/layout/Sidebar.tsx.

export type SectionKey =
  | "comunas"
  | "osm"
  | "microzonas"
  | "capas_territoriales"
  | "isocronas"
  | "archivos"
  | "pois"
  | "datos_analiticos";

export interface SectionDef {
  key: SectionKey;
  label: string;
  description: string;
  supportsEdit: boolean;
}

export const SECTIONS: SectionDef[] = [
  { key: "comunas", label: "Comunas", description: "Mapa de comunas, GSE, manzanas", supportsEdit: false },
  { key: "osm", label: "Datos OpenStreetMap", description: "Tráfico y comercios OSM", supportsEdit: false },
  { key: "microzonas", label: "Microzonas personalizadas", description: "Crear/usar microzonas hexagonales", supportsEdit: true },
  { key: "capas_territoriales", label: "Capas territoriales", description: "Ver capas cargadas por admin", supportsEdit: false },
  { key: "isocronas", label: "Isócronas", description: "Generar y guardar isócronas", supportsEdit: true },
  { key: "archivos", label: "Archivos", description: "Cargar archivos CSV/GeoJSON propios", supportsEdit: true },
  { key: "pois", label: "Puntos de interés", description: "Crear, editar y guardar POIs", supportsEdit: true },
  { key: "datos_analiticos", label: "Datos analíticos", description: "Métricas de eficiencia de locales actuales y estudiados", supportsEdit: false },
];

export const SECTIONS_BY_KEY: Record<SectionKey, SectionDef> = SECTIONS.reduce(
  (acc, s) => ({ ...acc, [s.key]: s }),
  {} as Record<SectionKey, SectionDef>,
);
