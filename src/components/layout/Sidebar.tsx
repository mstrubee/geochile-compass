import { SidebarSection } from "./SidebarSection";
import { Search, Building2, Wifi, FolderOpen } from "lucide-react";
import type { LayerKey, LayerState } from "@/types/layers";

interface SidebarProps {
  basemap: "dark" | "light" | "satellite";
  onBasemapChange: (b: "dark" | "light" | "satellite") => void;
  mode: "none" | "isochrone" | "microzone";
  layers: LayerState;
  onToggleLayer: (key: LayerKey) => void;
}

interface LayerRow {
  key: LayerKey;
  color: string;
  name: string;
  count: number;
  sub?: string;
}

const TERRITORIAL_LAYERS: LayerRow[] = [
  { key: "communes", color: "bg-primary", name: "Demografía Comunal", count: 20, sub: "Centroides comunales" },
  { key: "nse", color: "bg-brand-purple", name: "Grupo Socioeconómico", count: 20, sub: "ABC1 · C2 · C3 · D · E" },
  { key: "traffic", color: "bg-brand-orange", name: "Tráfico Vehicular", count: 20 },
  { key: "density", color: "bg-brand-pink", name: "Densidad Población", count: 20 },
];

const POI_LAYERS: LayerRow[] = [
  { color: "bg-brand-green", name: "Supermercados", count: 12, sub: "Locales cargados / OSM" },
  { color: "bg-brand-red", name: "Farmacias", count: 15 },
  { color: "bg-brand-orange", name: "Estaciones de Servicio", count: 10 },
];

const StatCard = ({ value, label }: { value: string | number; label: string }) => (
  <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
    <div className="font-display text-[16px] font-bold leading-none text-primary">{value}</div>
    <div className="mt-1 text-[10px] leading-tight text-text-muted">{label}</div>
  </div>
);

interface LayerItemProps {
  row: LayerRow;
  on: boolean;
  onToggle?: () => void;
}

const LayerItem = ({ row, on, onToggle }: LayerItemProps) => (
  <button
    type="button"
    onClick={onToggle}
    className={[
      "mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded border px-1.5 py-1 text-left transition-colors",
      on ? "border-primary/20 bg-primary/10" : "border-transparent hover:bg-surface-2",
    ].join(" ")}
    aria-pressed={on}
    aria-label={`Capa ${row.name}`}
  >
    {/* Toggle */}
    <div
      className={[
        "relative h-3.5 w-[26px] flex-shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-border-2",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all",
          on ? "left-[14px] bg-background" : "left-0.5 bg-text-muted",
        ].join(" ")}
      />
    </div>
    <span className={["h-2 w-2 flex-shrink-0 rounded-sm", row.color].join(" ")} />
    <span className={["flex-1 text-[11px] leading-tight", on ? "text-foreground" : "text-muted-foreground"].join(" ")}>
      {row.name}
    </span>
    <span className="font-mono text-[9px] text-text-muted">{row.count}</span>
  </button>
);

export const Sidebar = ({ basemap, onBasemapChange, mode, layers, onToggleLayer }: SidebarProps) => {
  return (
    <aside className="flex w-[272px] flex-shrink-0 flex-col overflow-hidden border-r border-border bg-surface">
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {/* Resumen */}
        <SidebarSection title="Resumen" accent="primary">
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <StatCard value={20} label="Comunas" />
            <StatCard value={0} label="Manzanas vis." />
            <StatCard value={0} label="POIs OSM" />
            <StatCard value={0} label="Isócronas" />
          </div>
        </SidebarSection>

        {/* Manzanas */}
        <SidebarSection title="Manzanas — Visualización" accent="teal">
          <div className="mb-2 text-[10px] text-text-muted">Variable a visualizar</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {["Densidad Pob.", "NSE", "Ingresos", "Tráfico"].map((v, i) => (
              <button
                key={v}
                className={[
                  "rounded-sm border px-2 py-1 font-mono text-[9px] transition-colors",
                  i === 0
                    ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                    : "border-border bg-surface-2 text-text-muted hover:border-brand-teal/50",
                ].join(" ")}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="rounded border border-border bg-surface-2 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-teal" />
              <span className="flex-1">Manzanas (hexágonos)</span>
              <span className="font-mono text-text-muted">—</span>
            </div>
            <div className="ml-3.5 mt-0.5 font-mono text-[9px] text-text-muted">Grilla adaptativa al zoom</div>
          </div>
        </SidebarSection>

        {/* OSM */}
        <SidebarSection title="Datos OpenStreetMap" accent="orange">
          <div className="mb-1.5 flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-[10px]">
            <span className="h-1.5 w-1.5 animate-blink rounded-full bg-brand-green" />
            <span className="flex-1">OSM Overpass API</span>
            <span className="text-brand-green">activo</span>
          </div>
          <button className="mb-1 flex w-full items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 py-1.5 font-body text-[11px] text-muted-foreground transition-all hover:border-brand-teal hover:bg-brand-teal/5 hover:text-foreground">
            <Wifi className="h-3 w-3" /> Cargar POIs del área visible
          </button>
          <button className="flex w-full items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 py-1.5 font-body text-[11px] text-muted-foreground transition-all hover:border-brand-teal hover:bg-brand-teal/5 hover:text-foreground">
            <Building2 className="h-3 w-3" /> Cargar edificios / manzanas
          </button>
          <p className="mt-2 font-mono text-[9px] leading-relaxed text-text-muted">
            Fuente: openstreetmap.org · Overpass API
            <br />
            Migración: Google Maps API disponible
          </p>
        </SidebarSection>

        {/* Microzonas */}
        <SidebarSection title="Microzonas Personalizadas" accent="purple">
          <p className="mb-2 text-[10px] leading-relaxed text-text-muted">
            Dibuja polígonos para analizar zonas que cruzan comunas.
          </p>
          <div className="mb-1.5 rounded border border-dashed border-border-2 px-2 py-2.5 text-center font-mono text-[10px] text-text-muted">
            Sin microzonas dibujadas
          </div>
          <button className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:border-brand-red hover:text-brand-red">
            ✕ Limpiar microzonas
          </button>
        </SidebarSection>

        {/* Capas */}
        <SidebarSection title="Capas Territoriales" accent="primary">
          {TERRITORIAL_LAYERS.map((row) => (
            <LayerItem key={row.name} row={row} />
          ))}
        </SidebarSection>

        {/* POIs */}
        <SidebarSection title="Puntos de Interés" accent="orange">
          {POI_LAYERS.map((row) => (
            <LayerItem key={row.name} row={row} />
          ))}
        </SidebarSection>

        {/* Isócronas */}
        <SidebarSection title="Isócronas" accent="iso">
          <div className="mb-2 flex gap-1">
            {[
              { label: "🚶 Caminata", on: true },
              { label: "🚗 Vehículo" },
              { label: "🚲 Bici" },
            ].map((t) => (
              <button
                key={t.label}
                className={[
                  "flex-1 rounded border px-1 py-1 font-mono text-[10px] transition-colors",
                  t.on
                    ? "border-iso-1 bg-iso-1/10 text-iso-1"
                    : "border-border bg-surface-2 text-text-muted hover:border-iso-1/50",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mb-2 text-[10px] text-text-muted">Minutos</div>
          <div className="mb-2 flex gap-1">
            {[5, 10, 15].map((n) => (
              <input
                key={n}
                type="number"
                defaultValue={n}
                className="w-0 flex-1 rounded border border-border bg-surface-2 px-1 py-1 text-center font-mono text-[11px] text-foreground outline-none focus:border-iso-1"
              />
            ))}
          </div>
          <div
            className={[
              "rounded border px-2 py-1.5 text-[10px] leading-relaxed",
              mode === "isochrone"
                ? "border-iso-1/40 bg-iso-1/10 text-iso-1"
                : "border-iso-1/12 bg-iso-1/5 text-text-muted",
            ].join(" ")}
          >
            Activa <b className="text-iso-1">⏱ Isócronas</b> y haz clic en el mapa
          </div>
          <button className="mt-1.5 w-full rounded border border-border bg-transparent px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:border-brand-red hover:text-brand-red">
            ✕ Limpiar isócronas
          </button>
        </SidebarSection>

        {/* Archivos */}
        <SidebarSection title="Archivos" accent="primary">
          <div className="cursor-pointer rounded border border-dashed border-border-2 px-2 py-3 text-center transition-colors hover:border-primary hover:bg-primary/5">
            <FolderOpen className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
              <strong className="text-primary">Arrastra o haz clic</strong>
              <br />
              KMZ · KML · GeoJSON
            </p>
          </div>
        </SidebarSection>

        {/* Mapa Base */}
        <SidebarSection title="Mapa Base" accent="primary">
          <div className="flex gap-1">
            {(["dark", "light", "satellite"] as const).map((b) => (
              <button
                key={b}
                onClick={() => onBasemapChange(b)}
                className={[
                  "flex-1 rounded border px-1 py-1 font-mono text-[10px] uppercase transition-colors",
                  basemap === b
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface-2 text-text-muted hover:border-primary/50",
                ].join(" ")}
              >
                {b === "dark" ? "Oscuro" : b === "light" ? "Claro" : "Satélite"}
              </button>
            ))}
          </div>
        </SidebarSection>
      </div>
    </aside>
  );
};

// Suppress unused import warning — Search reserved for future filter input
void Search;
