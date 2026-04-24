import { useRef, useState, type DragEvent } from "react";
import { SidebarSection } from "./SidebarSection";
import { Search, Building2, Wifi, FolderOpen, Trash2, Loader2, Crosshair } from "lucide-react";
import { toast } from "sonner";
import type { LayerKey, LayerState } from "@/types/layers";
import type { ManzanaVariable } from "@/types/manzanas";
import type { UserLayer } from "@/types/userLayers";
import type { IsoMode, Isochrone } from "@/types/isochrones";
import { ISO_MODE_LABEL } from "@/types/isochrones";
import { parseFile, getExtension } from "@/utils/fileParsers";

interface SidebarProps {
  basemap: "dark" | "light" | "satellite";
  onBasemapChange: (b: "dark" | "light" | "satellite") => void;
  mode: "none" | "isochrone" | "microzone";
  layers: LayerState;
  onToggleLayer: (key: LayerKey) => void;
  manzanaVariable: ManzanaVariable;
  onManzanaVariableChange: (v: ManzanaVariable) => void;
  manzanaLoading: boolean;
  manzanaCount: number;
  userLayers: UserLayer[];
  onAddUserLayer: (layer: UserLayer) => void;
  onToggleUserLayer: (id: string) => void;
  onRemoveUserLayer: (id: string) => void;
  // Isochrones
  isoMode: IsoMode;
  onIsoModeChange: (m: IsoMode) => void;
  isoMinutes: number[];
  onIsoMinutesChange: (m: number[]) => void;
  isochrones: Isochrone[];
  onToggleIsochrone: (id: string) => void;
  onRemoveIsochrone: (id: string) => void;
  onClearIsochrones: () => void;
  onFocusIsochrone: (id: string) => void;
  isoLoading: boolean;
}

interface LayerRow {
  key?: LayerKey;
  color: string;
  name: string;
  count: number;
  sub?: string;
}

const TERRITORIAL_LAYERS: LayerRow[] = [
  { key: "communes", color: "bg-primary", name: "Demografía comunal", count: 20, sub: "Centroides comunales" },
  { key: "nse", color: "bg-brand-purple", name: "Grupo socioeconómico", count: 20, sub: "ABC1 · C2 · C3 · D · E" },
  { key: "traffic", color: "bg-brand-orange", name: "Tráfico vehicular", count: 20 },
  { key: "density", color: "bg-brand-pink", name: "Densidad población", count: 20 },
];

const POI_LAYERS: LayerRow[] = [
  { color: "bg-brand-green", name: "Supermercados", count: 12, sub: "Locales cargados / OSM" },
  { color: "bg-brand-red", name: "Farmacias", count: 15 },
  { color: "bg-brand-orange", name: "Estaciones de servicio", count: 10 },
];

const StatCard = ({ value, label }: { value: string | number; label: string }) => (
  <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
    <div className="text-[20px] font-semibold leading-none tracking-tight text-foreground">{value}</div>
    <div className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
  </div>
);

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div
    className={[
      "relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors",
      on ? "bg-brand-green" : "bg-surface-3",
    ].join(" ")}
  >
    <span
      className={[
        "absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all",
        on ? "left-[16px]" : "left-[2px]",
      ].join(" ")}
    />
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
    className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
    aria-pressed={on}
  >
    <span className={["h-2 w-2 flex-shrink-0 rounded-full", row.color].join(" ")} />
    <span className={["flex-1 text-[13px] leading-tight", on ? "text-foreground" : "text-muted-foreground"].join(" ")}>
      {row.name}
    </span>
    <span className="font-mono text-[10px] text-text-muted">{row.count}</span>
    <IOSSwitch on={on} />
  </button>
);

export const Sidebar = ({
  basemap,
  onBasemapChange,
  mode,
  layers,
  onToggleLayer,
  manzanaVariable,
  onManzanaVariableChange,
  manzanaCount,
  userLayers,
  onAddUserLayer,
  onToggleUserLayer,
  onRemoveUserLayer,
  isoMode,
  onIsoModeChange,
  isoMinutes,
  onIsoMinutesChange,
  isochrones,
  onToggleIsochrone,
  onRemoveIsochrone,
  onClearIsochrones,
  onFocusIsochrone,
  isoLoading,
}: SidebarProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const colorPalette = [
    "#34D399", "#F472B6", "#FBBF24", "#60A5FA",
    "#A78BFA", "#FB7185", "#22D3EE", "#FB923C",
  ];

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setBusy(true);
    for (const file of arr) {
      try {
        if (!getExtension(file.name)) {
          toast.error(`${file.name}: formato no soportado`);
          continue;
        }
        const data = await parseFile(file);
        if (!data.features?.length) {
          toast.error(`${file.name}: sin features válidas`);
          continue;
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const color = colorPalette[(userLayers.length) % colorPalette.length];
        onAddUserLayer({
          id,
          name: file.name.replace(/\.(geojson|json|kml|kmz)$/i, ""),
          color,
          visible: true,
          data,
        });
        toast.success(`${file.name} cargado (${data.features.length} features)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        toast.error(`${file.name}: ${msg}`);
      }
    }
    setBusy(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const variables: { key: ManzanaVariable; label: string }[] = [
    { key: "density", label: "Densidad" },
    { key: "nse", label: "NSE" },
    { key: "income", label: "Ingresos" },
    { key: "traffic", label: "Tráfico" },
  ];

  return (
    <aside className="flex w-[288px] flex-shrink-0 flex-col overflow-hidden border-r border-border/60 bg-surface/95">
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <SidebarSection title="Resumen">
          <div className="grid grid-cols-2 gap-2 pt-1">
            <StatCard value={20} label="Comunas" />
            <StatCard value={manzanaCount} label="Manzanas vis." />
            <StatCard value={0} label="POIs OSM" />
            <StatCard value={isochrones.length} label="Isócronas" />
          </div>
        </SidebarSection>

        <SidebarSection title="Manzanas — Visualización">
          <div className="mb-2 text-[11px] text-muted-foreground">Variable a visualizar</div>
          {/* Segmented control */}
          <div className="mb-3 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
            {variables.map((v) => (
              <button
                key={v.key}
                onClick={() => onManzanaVariableChange(v.key)}
                className={[
                  "flex-1 rounded-md px-1 py-1 text-[11px] font-medium transition-all",
                  manzanaVariable === v.key
                    ? "bg-surface-3 text-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onToggleLayer("manzanas")}
            className="flex w-full items-center gap-2.5 rounded-lg bg-surface-2/60 px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
          >
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-teal" />
            <span className="flex-1 text-[12px] text-foreground">Manzanas (hexágonos)</span>
            <IOSSwitch on={layers.manzanas} />
          </button>
          <div className="mt-1.5 px-1 text-[10px] text-text-muted">Grilla adaptativa al zoom</div>
        </SidebarSection>

        <SidebarSection title="Datos OpenStreetMap">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 animate-blink rounded-full bg-brand-green" />
            <span className="flex-1 text-muted-foreground">OSM Overpass API</span>
            <span className="font-medium text-brand-green">activo</span>
          </div>
          <button className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-2 text-[12px] text-foreground transition-all hover:bg-surface-2">
            <Wifi className="h-3.5 w-3.5 text-muted-foreground" /> Cargar POIs del área visible
          </button>
          <button className="flex w-full items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-2 text-[12px] text-foreground transition-all hover:bg-surface-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Cargar edificios / manzanas
          </button>
          <p className="mt-2.5 px-1 text-[10px] leading-relaxed text-text-muted">
            Fuente: openstreetmap.org · Overpass API
          </p>
        </SidebarSection>

        <SidebarSection title="Microzonas personalizadas">
          <p className="mb-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            Dibuja polígonos para analizar zonas que cruzan comunas.
          </p>
          <div className="mb-2 rounded-lg border border-dashed border-border-2 px-2 py-3 text-center text-[11px] text-text-muted">
            Sin microzonas dibujadas
          </div>
          <button className="w-full rounded-lg bg-surface-2/60 px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
            Limpiar microzonas
          </button>
        </SidebarSection>

        <SidebarSection title="Capas territoriales">
          {TERRITORIAL_LAYERS.map((row) => (
            <LayerItem
              key={row.name}
              row={row}
              on={row.key ? layers[row.key] : false}
              onToggle={row.key ? () => onToggleLayer(row.key!) : undefined}
            />
          ))}
        </SidebarSection>

        <SidebarSection title="Puntos de interés">
          {POI_LAYERS.map((row) => (
            <LayerItem key={row.name} row={row} on={true} />
          ))}
        </SidebarSection>

        <SidebarSection title="Isócronas">
          <div className="mb-2 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
            {(["foot-walking", "driving-car", "cycling-regular"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onIsoModeChange(m)}
                className={[
                  "flex-1 rounded-md px-1 py-1 text-[11px] font-medium transition-all",
                  isoMode === m
                    ? "bg-surface-3 text-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {ISO_MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="mb-2 text-[11px] text-muted-foreground">Minutos</div>
          <div className="mb-2 flex gap-1.5">
            {[0, 1, 2].map((idx) => (
              <input
                key={idx}
                type="number"
                min={1}
                max={60}
                value={isoMinutes[idx] ?? ""}
                onChange={(e) => {
                  const next = [isoMinutes[0] ?? 0, isoMinutes[1] ?? 0, isoMinutes[2] ?? 0];
                  const v = parseInt(e.target.value, 10);
                  next[idx] = Number.isFinite(v) ? v : 0;
                  onIsoMinutesChange(next);
                }}
                className="w-0 flex-1 rounded-lg border border-border/60 bg-surface-2/60 px-2 py-1.5 text-center font-mono text-[12px] text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              />
            ))}
          </div>
          <div
            className={[
              "mb-2 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed",
              mode === "isochrone"
                ? "bg-iso-1/15 text-iso-1"
                : "bg-surface-2/60 text-muted-foreground",
            ].join(" ")}
          >
            {isoLoading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Calculando isócrona…
              </span>
            ) : mode === "isochrone" ? (
              <>Haz clic en el mapa para añadir una isócrona.</>
            ) : (
              <>Activa <b>Isócronas</b> en la barra superior y haz clic en el mapa.</>
            )}
          </div>

          {isochrones.length > 0 && (
            <div className="space-y-0.5">
              {isochrones.map((iso) => (
                <div
                  key={iso.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/60"
                >
                  <button
                    onClick={() => onToggleIsochrone(iso.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                    aria-pressed={iso.visible}
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: iso.color }}
                    />
                    <span
                      className={[
                        "flex-1 truncate text-[12px]",
                        iso.visible ? "text-foreground" : "text-muted-foreground",
                      ].join(" ")}
                      title={`${ISO_MODE_LABEL[iso.mode]} · ${iso.minutes.join("/")} min`}
                    >
                      {ISO_MODE_LABEL[iso.mode]} · {iso.minutes.join("/")}′
                    </span>
                    <IOSSwitch on={iso.visible} />
                  </button>
                  <button
                    onClick={() => onFocusIsochrone(iso.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-primary/15 hover:text-primary"
                    aria-label="Centrar"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onRemoveIsochrone(iso.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-destructive/15 hover:text-destructive"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={onClearIsochrones}
                className="mt-1 w-full rounded-lg bg-surface-2/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                Borrar todas
              </button>
            </div>
          )}
        </SidebarSection>


        <SidebarSection title="Archivos">
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,.kml,.kmz,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={[
              "cursor-pointer rounded-xl border border-dashed px-2 py-4 text-center transition-colors",
              dragActive
                ? "border-primary bg-primary/10"
                : "border-border-2 hover:border-primary/60 hover:bg-primary/5",
            ].join(" ")}
          >
            <FolderOpen className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-2 text-[12px] leading-tight text-muted-foreground">
              <strong className="text-foreground">
                {busy ? "Procesando..." : "Arrastra o haz clic"}
              </strong>
              <br />
              <span className="text-text-muted">KMZ · KML · GeoJSON · máx 20MB</span>
            </p>
          </div>

          {userLayers.length > 0 && (
            <div className="mt-2.5 space-y-0.5">
              {userLayers.map((ul) => (
                <div
                  key={ul.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/60"
                >
                  <button
                    onClick={() => onToggleUserLayer(ul.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                    aria-pressed={ul.visible}
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: ul.color }}
                    />
                    <span
                      className={[
                        "flex-1 truncate text-[12px]",
                        ul.visible ? "text-foreground" : "text-muted-foreground",
                      ].join(" ")}
                      title={ul.name}
                    >
                      {ul.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted">
                      {ul.data.features.length}
                    </span>
                    <IOSSwitch on={ul.visible} />
                  </button>
                  <button
                    onClick={() => onRemoveUserLayer(ul.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-destructive/15 hover:text-destructive"
                    aria-label={`Eliminar ${ul.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Mapa base">
          <div className="flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
            {(["dark", "light", "satellite"] as const).map((b) => (
              <button
                key={b}
                onClick={() => onBasemapChange(b)}
                className={[
                  "flex-1 rounded-md px-1 py-1 text-[11px] font-medium transition-all",
                  basemap === b
                    ? "bg-surface-3 text-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground",
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

void Search;
