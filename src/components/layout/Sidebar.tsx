import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { SidebarSection } from "./SidebarSection";
import { Search, Building2, Wifi, FolderOpen, Trash2, Loader2, Crosshair, BookmarkPlus, MapPin, Settings2, ChevronRight, ChevronDown, Folder, Scissors, ClipboardPaste, X, CheckSquare, Square, MinusSquare, CornerLeftUp, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { LayerKey, LayerState } from "@/types/layers";
import type { ManzanaVariable } from "@/types/manzanas";
import type { GseVariable } from "@/types/gse";
import { GSE_VARIABLE_LABEL } from "@/utils/gseScales";
import type { UserLayer } from "@/types/userLayers";
import type { IsoMode, Isochrone } from "@/types/isochrones";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import type { Microzone, MicrozoneSubmode } from "@/types/microzones";
import { ISO_MODE_LABEL } from "@/types/isochrones";
import { parseFile, getExtension, splitByFolderPath } from "@/utils/fileParsers";
import { OVERPASS_PRESETS } from "@/services/overpassService";

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
  gseVariable: GseVariable;
  onGseVariableChange: (v: GseVariable) => void;
  gseCount: number;
  userLayers: UserLayer[];
  onAddUserLayer: (layer: UserLayer) => void;
  onToggleUserLayer: (id: string) => void;
  onRemoveUserLayer: (id: string) => void;
  onSavePoisFromLayer: (id: string | string[]) => void;
  getLayerPointCount: (id: string) => number;
  isAuthenticated: boolean;
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
  onToggleIsoMode: () => void;
  // Microzonas
  microSubmode: MicrozoneSubmode;
  onMicroSubmodeChange: (s: MicrozoneSubmode) => void;
  microBufferRadius: number;
  onMicroBufferRadiusChange: (m: number) => void;
  microActive: boolean;
  onToggleMicroMode: () => void;
  microzones: Microzone[];
  onToggleMicrozone: (id: string) => void;
  onRemoveMicrozone: (id: string) => void;
  onClearMicrozones: () => void;
  onFocusMicrozone: (id: string) => void;
  onGenerateVoronoi: () => void;
  // Saved POIs
  savedPois: SavedPoi[];
  savedPoisVisible: boolean;
  onToggleSavedPoisVisible: () => void;
  onRemoveSavedPoi: (id: string) => void;
  onDeleteFolder?: (id: string) => Promise<void> | void;
  onClearSavedPois: () => void;
  onOpenPoiManager: () => void;
  poiFolderCount: number;
  poiFolders: PoiFolder[];
  onMoveFolder: (id: string, parentId: string | null) => Promise<void>;
  onMovePois: (ids: string[], folderId: string | null) => Promise<void>;
  /** Importa archivos KMZ/KML/GeoJSON directamente a una carpeta destino (sin diálogo). */
  onImportFilesIntoFolder?: (files: File[], folderId: string | null) => Promise<void> | void;
  /** Crea una carpeta nueva (opcionalmente como subcarpeta de `parentId`). */
  onCreateFolder?: (name: string, parentId: string | null) => Promise<{ id: string } | void> | void;
  // Papelera
  trashedPois?: SavedPoi[];
  trashedFolders?: PoiFolder[];
  onRestorePois?: (ids: string[]) => Promise<void> | void;
  onRestoreFolder?: (id: string) => Promise<void> | void;
  onPurgePois?: (ids: string[]) => Promise<void> | void;
  onPurgeFolder?: (id: string) => Promise<void> | void;
  /** IDs de carpetas ocultas (no se muestran en el mapa). */
  hiddenPoiFolders?: Set<string>;
  onHiddenPoiFoldersChange?: (next: Set<string>) => void;
  // OpenStreetMap (Overpass)
  onLoadOverpass: (
    kind: { type: "preset"; presetId: string; label: string } | { type: "text"; text: string },
  ) => Promise<void>;
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
  { key: "nse", color: "bg-brand-purple", name: "GSE por manzana", count: 36, sub: "Censo 2012 — AMS" },
  { key: "traffic", color: "bg-brand-orange", name: "Tráfico vehicular", count: 20 },
  { key: "density", color: "bg-brand-pink", name: "Densidad población", count: 20 },
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
  gseVariable,
  onGseVariableChange,
  gseCount,
  userLayers = [],
  onAddUserLayer,
  onToggleUserLayer,
  onRemoveUserLayer,
  onSavePoisFromLayer,
  getLayerPointCount,
  isAuthenticated,
  isoMode = "foot-walking",
  onIsoModeChange,
  isoMinutes = [5, 10, 15],
  onIsoMinutesChange,
  isochrones = [],
  onToggleIsochrone,
  onRemoveIsochrone,
  onClearIsochrones,
  onFocusIsochrone,
  isoLoading = false,
  onToggleIsoMode,
  microSubmode,
  onMicroSubmodeChange,
  microBufferRadius,
  onMicroBufferRadiusChange,
  microActive,
  onToggleMicroMode,
  microzones = [],
  onToggleMicrozone,
  onRemoveMicrozone,
  onClearMicrozones,
  onFocusMicrozone,
  onGenerateVoronoi,
  savedPois = [],
  savedPoisVisible = true,
  onToggleSavedPoisVisible,
  onRemoveSavedPoi,
  onDeleteFolder,
  onClearSavedPois,
  onOpenPoiManager,
  poiFolderCount = 0,
  poiFolders = [],
  onMoveFolder,
  onMovePois,
  onImportFilesIntoFolder,
  trashedPois = [],
  trashedFolders = [],
  onRestorePois,
  onRestoreFolder,
  onPurgePois,
  onPurgeFolder,
  hiddenPoiFolders,
  onHiddenPoiFoldersChange,
  onLoadOverpass,
}: SidebarProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Input separado para "Cargar KMZ a esta carpeta" (clic derecho sobre carpeta POI)
  const folderImportInputRef = useRef<HTMLInputElement>(null);
  const folderImportTargetIdRef = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [osmText, setOsmText] = useState("");
  const [osmLoading, setOsmLoading] = useState(false);
  // Selección múltiple de capas de archivo (sección "Archivos")
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());
  const toggleLayerSelected = (id: string) =>
    setSelectedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Limpiar selección de capas que dejaron de existir
  useEffect(() => {
    setSelectedLayerIds((prev) => {
      const valid = new Set(userLayers.map((l) => l.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [userLayers]);
  // Carpetas expandidas en el árbol de POIs guardados (por defecto: todas las raíz + "sin carpeta")
  const [expandedPoiFolders, setExpandedPoiFolders] = useState<Set<string>>(new Set(["__root__"]));
  const togglePoiFolder = (id: string) =>
    setExpandedPoiFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Portapapeles para cortar/pegar (carpetas o POIs)
  const [clipboard, setClipboard] = useState<
    | { kind: "folder"; id: string; name: string }
    | { kind: "poi"; id: string; name: string }
    | null
  >(null);

  // Confirmaciones de borrado — todo lo eliminado va a la papelera (30 días).
  const confirmRemovePoi = (id: string, name: string) => {
    if (window.confirm(`¿Eliminar "${name}"? Se moverá a la papelera durante 30 días antes de borrarse definitivamente.`)) {
      onRemoveSavedPoi(id);
    }
  };
  const confirmDeleteFolder = async (id: string, name: string) => {
    if (!onDeleteFolder) return;
    if (window.confirm(`¿Eliminar la carpeta "${name}" y todo su contenido (subcarpetas y POIs)? Se moverá a la papelera durante 30 días antes de borrarse definitivamente.`)) {
      try {
        await onDeleteFolder(id);
        toast.success("Movido a papelera");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al eliminar");
      }
    }
  };

  // Indexación jerárquica
  const poiChildrenMap = useMemo(() => {
    const m = new Map<string | null, PoiFolder[]>();
    poiFolders.forEach((f) => {
      const k = f.parent_id;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    });
    return m;
  }, [poiFolders]);
  const poisByFolderMap = useMemo(() => {
    const m = new Map<string | null, SavedPoi[]>();
    savedPois.forEach((p) => {
      const k = p.folder_id;
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    });
    return m;
  }, [savedPois]);
  // Recuento total (incluye descendientes)
  const totalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const visit = (id: string): number => {
      const own = (poisByFolderMap.get(id) ?? []).length;
      const subs = poiChildrenMap.get(id) ?? [];
      const total = own + subs.reduce((acc, s) => acc + visit(s.id), 0);
      counts.set(id, total);
      return total;
    };
    (poiChildrenMap.get(null) ?? []).forEach((f) => visit(f.id));
    return counts;
  }, [poiChildrenMap, poisByFolderMap]);

  // Descendientes de una carpeta (para evitar pegar en sí misma o sus hijas)
  const descendantsOfFolder = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (pid: string) => {
      (poiChildrenMap.get(pid) ?? []).forEach((c) => {
        if (!out.has(c.id)) {
          out.add(c.id);
          walk(c.id);
        }
      });
    };
    walk(id);
    return out;
  };

  const handlePaste = async (targetFolderId: string | null) => {
    if (!clipboard) return;
    try {
      if (clipboard.kind === "folder") {
        if (clipboard.id === targetFolderId) {
          toast.error("No puedes pegar la carpeta dentro de sí misma");
          return;
        }
        if (targetFolderId && descendantsOfFolder(clipboard.id).has(targetFolderId)) {
          toast.error("No puedes pegar una carpeta dentro de su descendiente");
          return;
        }
        await onMoveFolder(clipboard.id, targetFolderId);
      } else {
        await onMovePois([clipboard.id], targetFolderId);
      }
      toast.success(`"${clipboard.name}" movido`);
      if (targetFolderId) {
        setExpandedPoiFolders((p) => new Set(p).add(targetFolderId));
      }
      setClipboard(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al pegar");
    }
  };

  const colorPalette = [
    "#34D399", "#F472B6", "#FBBF24", "#60A5FA",
    "#A78BFA", "#FB7185", "#22D3EE", "#FB923C",
  ];

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setBusy(true);
    let layerOffset = userLayers.length;
    const addedLayerIds: string[] = [];
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
        const baseName = file.name.replace(/\.(geojson|json|kml|kmz)$/i, "");
        const buckets = splitByFolderPath(data);
        const hasHierarchy = buckets.some((b) => b.path.length > 0);

        if (!hasHierarchy) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const color = colorPalette[layerOffset++ % colorPalette.length];
          onAddUserLayer({ id, name: baseName, color, visible: true, data });
          addedLayerIds.push(id);
          toast.success(`${file.name} cargado (${data.features.length} features)`);
        } else {
          // Una capa por carpeta hoja del KMZ/KML
          let total = 0;
          buckets.forEach((bucket, idx) => {
            const id = `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`;
            const color = colorPalette[layerOffset++ % colorPalette.length];
            const suffix = bucket.path.length ? bucket.path.join(" / ") : "(raíz)";
            const fc = {
              type: "FeatureCollection" as const,
              features: bucket.features,
            };
            onAddUserLayer({
              id,
              name: `${baseName} · ${suffix}`,
              color,
              visible: true,
              data: fc,
            });
            addedLayerIds.push(id);
            total += bucket.features.length;
          });
          toast.success(
            `${file.name} cargado (${total} features en ${buckets.length} carpetas)`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        toast.error(`${file.name}: ${msg}`);
      }
    }
    setBusy(false);

    // Si hay sesión, ofrecer guardar como POIs eligiendo carpeta destino.
    // Encolamos un diálogo por cada capa cargada con puntos.
    if (isAuthenticated && addedLayerIds.length) {
      // Esperar al próximo tick para que userLayers ya esté actualizado en el padre.
      setTimeout(() => {
        addedLayerIds.forEach((id) => onSavePoisFromLayer(id));
      }, 0);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const variables: { key: ManzanaVariable; label: string }[] = [
    { key: "nse", label: "NSE" },
    { key: "income", label: "Ingresos" },
    { key: "traffic", label: "Tráfico" },
  ];

  // Ancho redimensionable (arrastrable). Persistido en localStorage.
  const MIN_W = 240;
  const MAX_W = 560;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 288;
    const v = Number(window.localStorage.getItem("sidebar.width"));
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : 288;
  });
  const resizingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = Math.min(MAX_W, Math.max(MIN_W, e.clientX));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem("sidebar.width", String(sidebarWidth));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarWidth]);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside
      className="relative flex flex-shrink-0 flex-col overflow-hidden border-r border-border/60 bg-surface/95"
      style={{ width: sidebarWidth }}
    >
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <SidebarSection title="Resumen">
          <div className="grid grid-cols-2 gap-2 pt-1">
            <StatCard value={20} label="Comunas" />
            <StatCard value={manzanaCount} label="Manzanas vis." />
            <StatCard value={0} label="POIs OSM" />
            <StatCard value={isochrones.length} label="Isócronas" />
          </div>
        </SidebarSection>

        <SidebarSection title="Comunas RM — Visualización">
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
            <span className="flex-1 text-muted-foreground">OSM Overpass · área visible</span>
            <span className="font-medium text-brand-green">activo</span>
          </div>

          {/* Presets */}
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {OVERPASS_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={osmLoading}
                onClick={async () => {
                  setOsmLoading(true);
                  try {
                    await onLoadOverpass({ type: "preset", presetId: p.id, label: p.label });
                  } finally {
                    setOsmLoading(false);
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-surface-2/60 px-2 py-2 text-left text-[11.5px] leading-tight text-foreground transition-all hover:bg-surface-2 disabled:opacity-50"
              >
                {osmLoading ? (
                  <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <MapPin className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>

          {/* Búsqueda libre */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const q = osmText.trim();
              if (!q) return;
              setOsmLoading(true);
              try {
                await onLoadOverpass({ type: "text", text: q });
              } finally {
                setOsmLoading(false);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-surface-2/60 px-2 py-1.5"
          >
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={osmText}
              onChange={(e) => setOsmText(e.target.value)}
              placeholder="Otro comercio (ej: bicicletería)"
              disabled={osmLoading}
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-text-muted outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={osmLoading || !osmText.trim()}
              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {osmLoading ? "…" : "Cargar"}
            </button>
          </form>

          <p className="mt-2.5 px-1 text-[10px] leading-relaxed text-text-muted">
            Acerca el mapa al área de interés antes de cargar. Cada consulta crea una capa.
          </p>
        </SidebarSection>

        <SidebarSection title="Microzonas personalizadas">
          <div className="mb-2 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
            {(["polygon", "buffer", "voronoi"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onMicroSubmodeChange(s)}
                className={[
                  "flex-1 rounded-md px-1 py-1 text-[11px] font-medium transition-all",
                  microSubmode === s
                    ? "bg-surface-3 text-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {s === "polygon" ? "Polígono" : s === "buffer" ? "Buffer" : "Voronoi"}
              </button>
            ))}
          </div>
          {microSubmode === "buffer" && (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Radio</span>
              <input
                type="number"
                min={50}
                max={10000}
                step={50}
                value={microBufferRadius}
                onChange={(e) => onMicroBufferRadiusChange(Math.max(50, parseInt(e.target.value, 10) || 500))}
                className="w-20 rounded-lg border border-border/60 bg-surface-2/60 px-2 py-1 text-center font-mono text-[11px] text-foreground outline-none focus:border-primary/60"
              />
              <span className="text-[11px] text-muted-foreground">m</span>
            </div>
          )}
          {microSubmode === "voronoi" ? (
            <button
              onClick={onGenerateVoronoi}
              className="mb-2 w-full rounded-lg bg-brand-purple px-2.5 py-2 text-[12px] font-medium text-background shadow-apple-sm hover:opacity-90"
            >
              Generar Voronoi de POIs visibles
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleMicroMode}
              className={[
                "mb-2 w-full rounded-lg px-2.5 py-2 text-[12px] font-medium transition-all",
                microActive
                  ? "bg-brand-purple text-background shadow-apple-sm"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              ].join(" ")}
            >
              {microActive
                ? "● Modo activo · clic en el mapa (clic aquí para desactivar)"
                : "Activar modo microzona"}
            </button>
          )}
          {microzones.length === 0 ? (
            <div className="mb-1 rounded-lg border border-dashed border-border/60 px-2 py-3 text-center text-[11px] text-text-muted">
              Sin microzonas
            </div>
          ) : (
            <div className="mb-1 space-y-0.5">
              {microzones.map((mz) => (
                <div key={mz.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/60">
                  <button
                    onClick={() => onToggleMicrozone(mz.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                    aria-pressed={mz.visible}
                  >
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: mz.color }} />
                    <span className={["flex-1 truncate text-[12px]", mz.visible ? "text-foreground" : "text-muted-foreground"].join(" ")} title={mz.name}>
                      {mz.name}
                    </span>
                    {mz.stats && (
                      <span className="font-mono text-[9.5px] text-text-muted" title={`${mz.stats.area_km2.toFixed(2)} km² · ${mz.stats.pop.toLocaleString("es-CL")} hab`}>
                        {mz.stats.area_km2.toFixed(1)}km² · {mz.stats.pop > 999 ? `${(mz.stats.pop / 1000).toFixed(1)}k` : mz.stats.pop} hab
                      </span>
                    )}
                    <IOSSwitch on={mz.visible} />
                  </button>
                  <button
                    onClick={() => onFocusMicrozone(mz.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-primary/15 hover:text-primary"
                    aria-label="Centrar"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onRemoveMicrozone(mz.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-destructive/15 hover:text-destructive"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {microzones.length > 0 && (
            <button
              onClick={onClearMicrozones}
              className="w-full rounded-lg bg-surface-2/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              Limpiar microzonas
            </button>
          )}
          {!layers.manzanas && (
            <p className="mt-2 px-1 text-[10px] leading-relaxed text-text-muted">
              Activa la capa <strong>Manzanas</strong> para obtener análisis demográfico (población, NSE).
            </p>
          )}
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
          {layers.nse && (
            <div className="mt-2 rounded-lg bg-surface-2/40 p-2">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-text-muted">
                Variable GSE · {gseCount} manzanas
              </div>
              <div className="flex flex-wrap gap-0.5 rounded-md bg-surface-2/60 p-0.5">
                {(Object.keys(GSE_VARIABLE_LABEL) as GseVariable[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => onGseVariableChange(v)}
                    className={[
                      "flex-1 rounded px-1.5 py-1 text-[10px] font-medium transition-all",
                      gseVariable === v
                        ? "bg-surface-3 text-foreground shadow-apple-sm"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {GSE_VARIABLE_LABEL[v]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
                Censo 2012 — comunas sin datos muestran círculo estimado.
              </p>
            </div>
          )}
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
          <button
            type="button"
            onClick={onToggleIsoMode}
            className={[
              "mb-2 w-full rounded-lg px-2.5 py-2 text-[12px] font-medium transition-all",
              mode === "isochrone"
                ? "bg-iso-1 text-background shadow-apple-sm"
                : "bg-primary text-primary-foreground hover:opacity-90",
            ].join(" ")}
          >
            {isoLoading ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Calculando isócrona…
              </span>
            ) : mode === "isochrone" ? (
              <>● Modo activo · Haz clic en el mapa (clic aquí para desactivar)</>
            ) : (
              <>Activar modo isócrona</>
            )}
          </button>

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
          {/* Input oculto para "cargar a esta carpeta" desde clic derecho en árbol POI */}
          <input
            ref={folderImportInputRef}
            type="file"
            accept=".geojson,.json,.kml,.kmz,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              const target = folderImportTargetIdRef.current;
              e.target.value = "";
              if (!files.length || !onImportFilesIntoFolder) return;
              try {
                await onImportFilesIntoFolder(files, target);
              } finally {
                folderImportTargetIdRef.current = null;
              }
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

          {userLayers.length > 0 && (() => {
            const allIds = userLayers.map((l) => l.id);
            const selCount = allIds.filter((id) => selectedLayerIds.has(id)).length;
            const allSelected = selCount === allIds.length && allIds.length > 0;
            const someSelected = selCount > 0 && !allSelected;
            const selectedWithPoints = allIds.filter(
              (id) => selectedLayerIds.has(id) && getLayerPointCount(id) > 0,
            );
            return (
              <div className="mt-2.5 space-y-0.5">
                {/* Cabecera con seleccionar todo + acciones bulk */}
                <div className="flex items-center gap-2 px-2 py-1">
                  <button
                    onClick={() => {
                      if (allSelected) setSelectedLayerIds(new Set());
                      else setSelectedLayerIds(new Set(allIds));
                    }}
                    className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                    title={allSelected ? "Deseleccionar todo" : "Seleccionar todo"}
                  >
                    {allSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    ) : someSelected ? (
                      <MinusSquare className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {selCount > 0
                        ? `${selCount} de ${allIds.length} seleccionada${allIds.length === 1 ? "" : "s"}`
                        : `${allIds.length} capa${allIds.length === 1 ? "" : "s"}`}
                    </span>
                  </button>
                  {selCount > 0 && (
                    <div className="ml-auto flex items-center gap-1">
                      {selectedWithPoints.length > 0 && (
                        <button
                          onClick={() => {
                            onSavePoisFromLayer(selectedWithPoints);
                            setSelectedLayerIds(new Set());
                          }}
                          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted transition-colors hover:bg-brand-green/15 hover:text-brand-green"
                          title={isAuthenticated
                            ? `Guardar ${selectedWithPoints.length} capa(s) como POIs`
                            : "Inicia sesión para guardar"}
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                          <span>Guardar</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (
                            !window.confirm(
                              `¿Eliminar ${selCount} capa${selCount === 1 ? "" : "s"} de archivo?`,
                            )
                          )
                            return;
                          allIds
                            .filter((id) => selectedLayerIds.has(id))
                            .forEach((id) => onRemoveUserLayer(id));
                          setSelectedLayerIds(new Set());
                        }}
                        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted transition-colors hover:bg-destructive/15 hover:text-destructive"
                        title={`Eliminar ${selCount} capa(s)`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  )}
                </div>

                {userLayers.map((ul) => {
                  const checked = selectedLayerIds.has(ul.id);
                  return (
                    <div
                      key={ul.id}
                      className={[
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                        checked ? "bg-primary/10" : "hover:bg-surface-2/60",
                      ].join(" ")}
                    >
                      <button
                        onClick={() => toggleLayerSelected(ul.id)}
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted hover:text-primary"
                        aria-label={checked ? "Deseleccionar" : "Seleccionar"}
                        aria-pressed={checked}
                      >
                        {checked ? (
                          <CheckSquare className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
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
                      {getLayerPointCount(ul.id) > 0 && (
                        <button
                          onClick={() => onSavePoisFromLayer(ul.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-brand-green/15 hover:text-brand-green"
                          aria-label={`Guardar como POIs ${ul.name}`}
                          title={isAuthenticated
                            ? `Guardar ${getLayerPointCount(ul.id)} puntos como POIs`
                            : "Inicia sesión para guardar"}
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (!window.confirm(`¿Eliminar la capa "${ul.name}"?`)) return;
                          onRemoveUserLayer(ul.id);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-destructive/15 hover:text-destructive"
                        aria-label={`Eliminar ${ul.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </SidebarSection>

        <SidebarSection title="Puntos de interés">
          {!isAuthenticated ? (
            <div className="rounded-lg bg-surface-2/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Inicia sesión para guardar puntos de forma permanente.
            </div>
          ) : savedPois.length === 0 && poiFolderCount === 0 ? (
            <>
              <div className="mb-2 rounded-lg bg-surface-2/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Aún no hay POIs ni carpetas. Carga un archivo con puntos y pulsa el icono <BookmarkPlus className="inline h-3 w-3" /> para guardarlos.
              </div>
              <button
                onClick={onOpenPoiManager}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface-2/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                <Settings2 className="h-3.5 w-3.5" /> Crear carpeta
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onOpenPoiManager}
                className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-primary/10 px-2.5 py-2 text-left text-primary transition-colors hover:bg-primary/15"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className="flex-1 text-[12px] font-medium">Administrar POIs</span>
                <span className="font-mono text-[10px] opacity-75">{poiFolderCount} carp.</span>
              </button>
              <button
                onClick={onToggleSavedPoisVisible}
                className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                aria-pressed={savedPoisVisible}
              >
                <MapPin className="h-3.5 w-3.5 text-brand-green" />
                <span className="flex-1 text-[12px] text-foreground">Mostrar en mapa</span>
                <span className="font-mono text-[10px] text-text-muted">{savedPois.length}</span>
                <IOSSwitch on={savedPoisVisible} />
              </button>
              {clipboard && (
                <div className="mb-1 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10.5px] text-primary">
                  <Scissors className="h-3 w-3" />
                  <span className="flex-1 truncate" title={clipboard.name}>
                    Cortado: <strong>{clipboard.name}</strong>
                  </span>
                  <button
                    onClick={() => handlePaste(null)}
                    className="rounded px-1.5 py-0.5 hover:bg-primary/15"
                    title="Pegar en raíz"
                  >
                    Pegar raíz
                  </button>
                  <button
                    onClick={() => setClipboard(null)}
                    className="rounded p-0.5 hover:bg-primary/15"
                    aria-label="Cancelar"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="scrollbar-thin max-h-72 space-y-0.5 overflow-y-auto">
                {(() => {
                  const renderPoi = (p: SavedPoi, depth: number) => (
                    <ContextMenu key={p.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          className="group flex items-center gap-2 rounded-md py-0.5 pr-1 hover:bg-surface-2/60"
                          style={{ paddingLeft: `${depth * 12 + 8}px` }}
                        >
                          <span
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: p.color || "#34D399" }}
                          />
                          <span className="flex-1 truncate text-[11.5px] text-foreground" title={p.name}>
                            {p.name}
                          </span>
                          <button
                            onClick={() => confirmRemovePoi(p.id, p.name)}
                            className="flex h-5 w-5 items-center justify-center rounded-md text-text-muted opacity-0 transition-colors hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                            aria-label={`Eliminar ${p.name}`}
                            title="Mover a papelera (30 días)"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="z-[1100]">
                        <ContextMenuItem onSelect={() => setClipboard({ kind: "poi", id: p.id, name: p.name })}>
                          <Scissors className="mr-2 h-3.5 w-3.5" /> Cortar
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => confirmRemovePoi(p.id, p.name)} className="text-destructive focus:text-destructive">
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> Mover a papelera
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );

                  const renderFolder = (f: PoiFolder, depth: number): JSX.Element => {
                    const isOpen = expandedPoiFolders.has(f.id);
                    const subs = poiChildrenMap.get(f.id) ?? [];
                    const own = poisByFolderMap.get(f.id) ?? [];
                    const total = totalCounts.get(f.id) ?? 0;
                    const canPasteHere =
                      !!clipboard &&
                      !(clipboard.kind === "folder" && clipboard.id === f.id) &&
                      !(clipboard.kind === "folder" && descendantsOfFolder(clipboard.id).has(f.id));
                    return (
                      <div key={f.id}>
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={() => togglePoiFolder(f.id)}
                              className="flex w-full items-center gap-1 rounded-md py-1 pr-1 text-left hover:bg-surface-2/60"
                              style={{ paddingLeft: `${depth * 12 + 2}px` }}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                              )}
                              <Folder className="h-3 w-3 flex-shrink-0" style={{ color: f.color || "#FBBF24" }} />
                              <span className="flex-1 truncate text-[11.5px] font-medium text-foreground" title={f.name}>
                                {f.name}
                              </span>
                              <span className="font-mono text-[9.5px] text-text-muted">{total}</span>
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="z-[1100]">
                            <ContextMenuItem onSelect={() => setClipboard({ kind: "folder", id: f.id, name: f.name })}>
                              <Scissors className="mr-2 h-3.5 w-3.5" /> Cortar carpeta
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={!canPasteHere}
                              onSelect={() => handlePaste(f.id)}
                            >
                              <ClipboardPaste className="mr-2 h-3.5 w-3.5" />
                              {clipboard ? `Pegar "${clipboard.name}" aquí` : "Pegar aquí"}
                            </ContextMenuItem>
                            {onImportFilesIntoFolder && (
                              <ContextMenuItem
                                onSelect={() => {
                                  folderImportTargetIdRef.current = f.id;
                                  folderImportInputRef.current?.click();
                                }}
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Cargar KMZ/KML/GeoJSON a esta carpeta…
                              </ContextMenuItem>
                            )}
                            {(() => {
                              const parent = poiFolders.find((x) => x.id === f.parent_id);
                              const grandparentId = parent?.parent_id ?? null;
                              const isRoot = f.parent_id === null;
                              return (
                                <ContextMenuItem
                                  disabled={isRoot}
                                  onSelect={async () => {
                                    if (isRoot) return;
                                    try {
                                      await onMoveFolder(f.id, grandparentId);
                                      toast.success(
                                        grandparentId === null
                                          ? `"${f.name}" movida a la raíz`
                                          : `"${f.name}" subida un nivel`,
                                      );
                                    } catch (err) {
                                      toast.error(err instanceof Error ? err.message : "Error al mover");
                                    }
                                  }}
                                >
                                  <CornerLeftUp className="mr-2 h-3.5 w-3.5" />
                                  Subir un nivel{isRoot ? " (ya está en raíz)" : ""}
                                </ContextMenuItem>
                              );
                            })()}
                            {clipboard && (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuItem onSelect={() => setClipboard(null)}>
                                  <X className="mr-2 h-3.5 w-3.5" /> Cancelar corte
                                </ContextMenuItem>
                              </>
                            )}
                            {onDeleteFolder && (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onSelect={() => confirmDeleteFolder(f.id, f.name)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Mover carpeta a papelera
                                </ContextMenuItem>
                              </>
                            )}
                          </ContextMenuContent>
                        </ContextMenu>
                        {isOpen && (
                          <div>
                            {subs.map((s) => renderFolder(s, depth + 1))}
                            {own.map((p) => renderPoi(p, depth + 1))}
                          </div>
                        )}
                      </div>
                    );
                  };

                  const rootFolders = poiChildrenMap.get(null) ?? [];
                  const orphan = poisByFolderMap.get(null) ?? [];
                  const orphanOpen = expandedPoiFolders.has("__root__");

                  return (
                    <>
                      {rootFolders.map((f) => renderFolder(f, 0))}
                      {orphan.length > 0 && (
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <div>
                              <button
                                type="button"
                                onClick={() => togglePoiFolder("__root__")}
                                className="flex w-full items-center gap-1 rounded-md py-1 pr-1 text-left hover:bg-surface-2/60"
                              >
                                {orphanOpen ? (
                                  <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                )}
                                <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                <span className="flex-1 truncate text-[11.5px] italic text-muted-foreground">Sin carpeta</span>
                                <span className="font-mono text-[9.5px] text-text-muted">{orphan.length}</span>
                              </button>
                              {orphanOpen && orphan.map((p) => renderPoi(p, 0))}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="z-[1100]">
                            <ContextMenuItem
                              disabled={!clipboard}
                              onSelect={() => handlePaste(null)}
                            >
                              <ClipboardPaste className="mr-2 h-3.5 w-3.5" />
                              {clipboard ? `Pegar "${clipboard.name}" en raíz` : "Pegar en raíz"}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )}
                      {rootFolders.length === 0 && orphan.length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-muted-foreground">Sin POIs.</div>
                      )}
                    </>
                  );
                })()}
              </div>
              <button
                onClick={() => {
                  const total = savedPois.length;
                  if (total === 0) {
                    toast.info("No hay POIs para borrar");
                    return;
                  }
                  if (!window.confirm(`¿Mover TODOS los ${total} POIs a la papelera? Podrás recuperarlos durante 30 días.`)) return;
                  onClearSavedPois();
                }}
                className="mt-1.5 w-full rounded-lg bg-surface-2/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                Mover todos a papelera
              </button>
            </>
          )}
        </SidebarSection>

        {(trashedPois.length > 0 || trashedFolders.length > 0) && (
          <SidebarSection title={`Papelera · 30 días (${trashedPois.length + trashedFolders.length})`}>
            <p className="mb-1.5 px-1 text-[10px] leading-relaxed text-text-muted">
              Los elementos eliminados se borran definitivamente a los 30 días.
            </p>
            <div className="scrollbar-thin max-h-56 space-y-0.5 overflow-y-auto">
              {trashedFolders.map((f) => {
                const days = f.deleted_at
                  ? Math.max(0, 30 - Math.floor((Date.now() - new Date(f.deleted_at).getTime()) / 86400000))
                  : 30;
                return (
                  <div key={f.id} className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-2/60">
                    <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-[11.5px] text-muted-foreground line-through" title={f.name}>
                      {f.name}
                    </span>
                    <span className="font-mono text-[9.5px] text-text-muted">{days}d</span>
                    {onRestoreFolder && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await onRestoreFolder(f.id);
                            toast.success(`"${f.name}" restaurada`);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Error");
                          }
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-primary opacity-0 hover:bg-primary/10 group-hover:opacity-100"
                        title="Restaurar"
                      >
                        Restaurar
                      </button>
                    )}
                    {onPurgeFolder && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Eliminar "${f.name}" definitivamente? Esta acción no se puede deshacer.`)) return;
                          try {
                            await onPurgeFolder(f.id);
                            toast.success("Eliminado definitivamente");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Error");
                          }
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-text-muted opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                        aria-label="Borrar definitivamente"
                        title="Borrar definitivamente"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
              {trashedPois.map((p) => {
                const days = p.deleted_at
                  ? Math.max(0, 30 - Math.floor((Date.now() - new Date(p.deleted_at).getTime()) / 86400000))
                  : 30;
                return (
                  <div key={p.id} className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-2/60">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color || "#34D399" }} />
                    <span className="flex-1 truncate text-[11.5px] text-muted-foreground line-through" title={p.name}>
                      {p.name}
                    </span>
                    <span className="font-mono text-[9.5px] text-text-muted">{days}d</span>
                    {onRestorePois && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await onRestorePois([p.id]);
                            toast.success(`"${p.name}" restaurado`);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Error");
                          }
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-primary opacity-0 hover:bg-primary/10 group-hover:opacity-100"
                        title="Restaurar"
                      >
                        Restaurar
                      </button>
                    )}
                    {onPurgePois && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Eliminar "${p.name}" definitivamente? Esta acción no se puede deshacer.`)) return;
                          try {
                            await onPurgePois([p.id]);
                            toast.success("Eliminado definitivamente");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Error");
                          }
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-text-muted opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                        aria-label="Borrar definitivamente"
                        title="Borrar definitivamente"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </SidebarSection>
        )}

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
      {/* Handle de arrastre para redimensionar */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar barra lateral"
        onMouseDown={startResize}
        onDoubleClick={() => {
          setSidebarWidth(288);
          try { window.localStorage.setItem("sidebar.width", "288"); } catch { /* ignore */ }
        }}
        className="group absolute right-0 top-0 z-10 flex h-full w-1.5 cursor-col-resize items-center justify-center hover:bg-primary/20"
      >
        <span className="h-10 w-[3px] rounded-full bg-border/60 transition-colors group-hover:bg-primary" />
      </div>
    </aside>
  );
};

void Search;
