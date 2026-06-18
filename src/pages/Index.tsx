import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MapView } from "@/components/map/MapView";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { PoiManagerDialog } from "@/components/panels/PoiManagerDialog";
import { SavePoisDialog } from "@/components/panels/SavePoisDialog";
import { SaveIsochroneDialog } from "@/components/panels/SaveIsochroneDialog";
import { IsochroneReportDialog } from "@/components/panels/IsochroneReportDialog";
import { PoiEditorDialog, type PoiEditorDraft } from "@/components/panels/PoiEditorDialog";
import { CommuneSearchResultsDialog } from "@/components/panels/CommuneSearchResultsDialog";
import { CommuneCompareDialog } from "@/components/panels/CommuneCompareDialog";
import { PoiImportDialog } from "@/components/panels/PoiImportDialog";
import { PoiDetailDialog } from "@/components/panels/PoiDetailDialog";
import { PoiFolderSchemaDialog } from "@/components/panels/PoiFolderSchemaDialog";
import { AnalysisConfigDialog } from "@/components/panels/AnalysisConfigDialog";
import { ComputeFeaturesDialog } from "@/components/panels/ComputeFeaturesDialog";
// SalesProjectionPanel ahora vive dentro de AnalysisPanel
import { useAnalysisSettings } from "@/hooks/useAnalysisConfig";
import { useComputePerformanceBatch } from "@/hooks/usePoiPerformance";
import { useUserRoles } from "@/hooks/useUserRoles";
import { usePoiFolderSchemas } from "@/hooks/usePoiMetrics";
import { Legend } from "@/components/ui-overlays/Legend";
import { SearchBar, type SearchResult } from "@/components/ui-overlays/SearchBar";
import { CoordsBar } from "@/components/ui-overlays/CoordsBar";
import { ApiUsagePanel } from "@/components/ui-overlays/ApiUsagePanel";
import { useMapProvider } from "@/hooks/useMapProvider";
import { useManzanas } from "@/hooks/useManzanas";
import { useGseManzanas } from "@/hooks/useGseManzanas";
import { useComunasGeoIndex } from "@/hooks/useComunasGeoIndex";
import { useSavedPois } from "@/hooks/useSavedPois";
import { usePoiFolders } from "@/hooks/usePoiFolders";
import { useSavedIsochrones } from "@/hooks/useSavedIsochrones";
import { useAuth } from "@/hooks/useAuth";
import { fetchIsochrone } from "@/services/isochroneService";
import { findHexAt, loadParqueGeoJson, type ParqueHexProps } from "@/services/parqueData";
import { useParqueLayer } from "@/hooks/useParqueLayer";
import { MapContextMenu, type MapContextMenuItem } from "@/components/ui-overlays/MapContextMenu";
import { fetchOverpassPreset, fetchOverpassFreeText, bboxAreaDegSq } from "@/services/overpassService";
import { extractPointPois, countPoints, type PoiInsert, type SavedPoi, type PoiFolder } from "@/types/pois";
import { parseFile, getExtension } from "@/utils/fileParsers";
import type { NSE, Commune } from "@/data/communes";
import type { TrafficLevel } from "@/utils/traffic";
import type { LayerState } from "@/types/layers";
import type { ManzanaVariable } from "@/types/manzanas";
import type { GseVariable } from "@/types/gse";
import type { IneVariable } from "@/utils/ineScales";
import type { UserLayer } from "@/types/userLayers";
import { ISO_MODE_LABEL, type IsoMode, type Isochrone } from "@/types/isochrones";
import type { Microzone, MicrozoneSubmode } from "@/types/microzones";
import type { AgroplanetScoreMode } from "@/components/map/AgroplanetComunasLayer";
import { MICRO_PALETTE } from "@/types/microzones";
import {
  polygonFromLatLngs,
  bufferAroundPoint,
  voronoiFromPois,
  computeMicrozoneStats,
} from "@/utils/microzones";
import { useNavigate } from "react-router-dom";
import { TerritorialLayerFloatingPanel } from "@/components/map/TerritorialLayerFloatingPanel";
import type { ComercialLayerState, ComercialCategoria } from "@/types/comercial";
import { useBrandLogos } from "@/hooks/useComercialPOI";
import { useCustomLayers } from "@/hooks/useCustomLayers";
import { FootTrafficPanel } from "@/components/map/FootTrafficPanel";
import type { FootTrafficTarget } from "@/hooks/useFootTraffic";

type Mode = "none" | "isochrone" | "microzone";

const Index = () => {
  const mapProvider = useMapProvider();
  const [mode, setMode] = useState<Mode>("none");
  const [basemap, setBasemap] = useState<"dark" | "light" | "satellite" | "hybrid">(() => {
    try {
      const saved = localStorage.getItem("map_base_default_v1");
      if (saved === "dark" || saved === "light" || saved === "satellite" || saved === "hybrid") return saved;
    } catch { /* ignore */ }
    return "hybrid";
  });
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("analysis_panel_state_v1");
      if (saved === "open") return true;
      if (saved === "closed") return false;
    } catch { /* ignore */ }
    return false;
  });
  // Si el usuario cierra el panel, no se reabre solo al crear/seleccionar isócronas.
  const [panelHiddenByUser, setPanelHiddenByUser] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("analysis_panel_state_v1", panelOpen ? "open" : "closed"); } catch { /* ignore */ }
  }, [panelOpen]);
  // Ancho del panel de análisis (resizable por arrastre)
  const PANEL_MIN_W = 320;
  const PANEL_MAX_W = 800;
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("analysis_panel_width_v1"));
      if (Number.isFinite(v) && v >= PANEL_MIN_W && v <= PANEL_MAX_W) return v;
    } catch { /* ignore */ }
    return 480;
  });
  const handlePanelWidthChange = useCallback((w: number) => {
    const clamped = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Math.round(w)));
    setPanelWidth(clamped);
    try { localStorage.setItem("analysis_panel_width_v1", String(clamped)); } catch { /* ignore */ }
  }, []);
  const autoOpenPanel = useCallback(() => {
    if (!panelHiddenByUser) setPanelOpen(true);
  }, [panelHiddenByUser]);
  const userOpenPanel = useCallback(() => {
    setPanelHiddenByUser(false);
    setPanelOpen(true);
  }, []);
  const userClosePanel = useCallback(() => {
    setPanelHiddenByUser(true);
    setPanelOpen(false);
  }, []);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    communes: false,
    communesGeo: false,
    nse: false,
    traffic: false,
    density: false,
    manzanas: false,
    crime: false,
    commercial: false,
    gasto: false,
    agroplanet: false,
    agroplanet_competitors: false,
  });
  // ── Red Comercial Nacional (POIs OSM) ────────────────────────────────────
  const brandLogos = useBrandLogos();
  const { asUserLayers: customMapLayers, reload: reloadCustomLayers } = useCustomLayers();
  // ── Panel de afluencia BestTime ──────────────────────────────────────────
  const [footTrafficTarget, setFootTrafficTarget] = useState<FootTrafficTarget | null>(null);
  useEffect(() => {
    (window as any).__gp_foot = (target: FootTrafficTarget) => setFootTrafficTarget(target);
    return () => { delete (window as any).__gp_foot; };
  }, []);
  const [comercialLayers, setComercialLayers] = useState<ComercialLayerState>({
    supermercado:         false,
    farmacia:             false,
    combustible:          false,
    ferreteria:           false,
    retail_departamental: false,
    banco:                false,
    restaurante:          false,
    automotriz:           false,
    bodega:               false,
  });
  const [comercialCounts, setComercialCounts] = useState<Partial<Record<ComercialCategoria, number>>>({});
  const [comercialHiddenBrands, setComercialHiddenBrands] = useState<Partial<Record<ComercialCategoria, Set<string>>>>({});
  // Marcas reubicadas en carpetas (se muestran en el mapa de forma independiente a su categoría)
  const [comercialManagedBrands, setComercialManagedBrands] = useState<Partial<Record<ComercialCategoria, Set<string>>>>({});
  const handleComercialManagedBrandsChange = useCallback((managed: Partial<Record<ComercialCategoria, Set<string>>>) => {
    setComercialManagedBrands(managed);
  }, []);
  const handleComercialToggle = useCallback((cat: ComercialCategoria) => {
    setComercialLayers((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);
  const handleComercialCountChange = useCallback((cat: ComercialCategoria, n: number) => {
    setComercialCounts((prev) => ({ ...prev, [cat]: n }));
  }, []);
  const handleComercialBrandToggle = useCallback((cat: ComercialCategoria, brand: string) => {
    setComercialHiddenBrands((prev) => {
      const cur = prev[cat] ?? new Set<string>();
      const next = new Set(cur);
      if (next.has(brand)) next.delete(brand); else next.add(brand);
      return { ...prev, [cat]: next };
    });
  }, []);
  const handleSetComercialHiddenBrands = useCallback((cat: ComercialCategoria, brands: Set<string>) => {
    setComercialHiddenBrands((prev) => ({ ...prev, [cat]: brands }));
  }, []);
  // ────────────────────────────────────────────────────────────────────────
  const [nseFilter, setNseFilter] = useState<NSE | null>(null);
  const [trafficFilter, setTrafficFilter] = useState<TrafficLevel | null>(null);
  const [manzanaVariable, setManzanaVariable] = useState<ManzanaVariable>("nse");
  const [viewport, setViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  // Viewport general (siempre activo) para cargar POIs OSM aunque no haya capa de manzanas activa
  const [mapViewport, setMapViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const handleMapViewportChange = useCallback(
    (bbox: [number, number, number, number], zoom: number) => {
      setMapViewport({ bbox, zoom });
    },
    [],
  );
  // Capa de densidad poblacional (manzanas coloreadas por densidad), controlada desde "Capas territoriales"
  const [densityViewport, setDensityViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const handleDensityViewportChange = useCallback(
    (bbox: [number, number, number, number], zoom: number) => {
      setDensityViewport({ bbox, zoom });
    },
    [],
  );
  // Capa Atractores Comerciales
  const [activeCommercialCats, setActiveCommercialCats] = useState<Set<import("@/components/map/CommercialHeatLayer").CommercialCategory>>(
    new Set(["all"])
  );
  const handleCommercialToggle = (cat: import("@/components/map/CommercialHeatLayer").CommercialCategory) => {
    setActiveCommercialCats(prev => {
      const next = new Set(prev);
      if (cat === "all") {
        // "Todos" activa/desactiva todo
        return next.has("all") ? new Set() : new Set(["all"] as const);
      }
      if (next.has(cat)) { next.delete(cat); next.delete("all"); }
      else { next.add(cat); }
      if (next.size === 0) next.add("all");
      return next;
    });
  };

  // Capa Riesgo Delictivo
  const [crimeView, setCrimeView] = useState<"heat" | "manzana">("heat");
  const [gastoView, setGastoView] = useState<"heat" | "manzana">("heat");
  const [agroplanetScoreMode, setAgroplanetScoreMode] = useState<AgroplanetScoreMode>("combined");
  const [crimeType, setCrimeType] = useState<import("@/components/map/CrimeHeatLayer").CrimeType>("total");
  const [activeRisk, setActiveRisk] = useState<Set<import("@/components/map/CrimeHeatLayer").RiskFilter>>(
    new Set(["Muy Alto", "Alto", "Medio", "Bajo", "Muy Bajo"])
  );
  const handleRiskToggle = (r: import("@/components/map/CrimeHeatLayer").RiskFilter) => {
    setActiveRisk(prev => {
      const next = new Set(prev);
      if (next.has(r)) { next.delete(r); } else { next.add(r); }
      return next;
    });
  };

  // Capa GSE por manzana (Censo 2012)
  const [gseVariable, setGseVariable] = useState<GseVariable>("gse");
  const [chileCommunesVariable, setChileCommunesVariable] = useState<IneVariable>("poblacion");
  const [gseViewport, setGseViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [userLayers, setUserLayers] = useState<UserLayer[]>([]);
  const [fitId, setFitId] = useState<string | null>(null);

  // Isócronas
  const [isoMode, setIsoMode] = useState<IsoMode>("driving-car");
  const [isoMinutes, setIsoMinutes] = useState<number[]>([5, 7, 10]);
  const [isochrones, setIsochrones] = useState<Isochrone[]>([]);
  const [fitIsoId, setFitIsoId] = useState<string | null>(null);
  const [isoLoading, setIsoLoading] = useState(false);
  const [selectedIsoId, setSelectedIsoId] = useState<string | null>(null);
  const [saveIsoDialogId, setSaveIsoDialogId] = useState<string | null>(null);
  const [reportIsoDialogId, setReportIsoDialogId] = useState<string | null>(null);
  const [loadedSavedIsoIds, setLoadedSavedIsoIds] = useState<Set<string>>(new Set());

  // ---- Sales import system ----
  const { isAdmin } = useUserRoles();
  const { schemas: poiFolderSchemas, refresh: refreshSchemas, upsertSchema } = usePoiFolderSchemas();
  const [importDialogFolderId, setImportDialogFolderId] = useState<string | null>(null);
  const [schemaDialogFolderId, setSchemaDialogFolderId] = useState<string | null>(null);
  const [analysisConfigFolderId, setAnalysisConfigFolderId] = useState<string | null>(null);
  const [computeFeaturesFolderId, setComputeFeaturesFolderId] = useState<string | null>(null);
  // Proyección de potencial de venta (nueva ubicación via isócrona)
  const [projectionIsoId, setProjectionIsoId] = useState<string | null>(null);
  const performanceBatch = useComputePerformanceBatch();
  const [detailPoi, setDetailPoi] = useState<SavedPoi | null>(null);
  /** Modo "elegir POI en mapa" para una fila concreta del importador. */
  const [poiPickContext, setPoiPickContext] = useState<{ rowIndex: number } | null>(null);
  const [externalManualSelection, setExternalManualSelection] =
    useState<{ rowIndex: number; poiId: string } | null>(null);
  const [importViewing, setImportViewing] = useState(false);

  const {
    savedIsos,
    folders: isoFolders,
    saveIsochrone,
    updateIso: updateSavedIso,
    removeIso: removeSavedIso,
    createFolder: createIsoFolder,
    renameFolder: renameIsoFolder,
    deleteFolder: deleteIsoFolder,
  } = useSavedIsochrones();

  // Búsqueda de direcciones (centra el mapa)
  const [flyTarget, setFlyTarget] = useState<{
    id: number;
    lat: number;
    lng: number;
    bbox: [number, number, number, number] | null;
  } | null>(null);

  // Búsqueda de comunas
  const [popupCommune, setPopupCommune] = useState<string | null>(null);
  const [communeRangeResults, setCommuneRangeResults] = useState<{
    rows: Commune[];
    min: number;
    max: number | null;
  } | null>(null);
  const [communeRangeOpen, setCommuneRangeOpen] = useState(false);

  // Perímetros de comunas a dibujar (search/range/compare)
  const [outlinedCommuneNames, setOutlinedCommuneNames] = useState<string[]>([]);
  const [highlightedCommuneName, setHighlightedCommuneName] = useState<string | null>(null);

  // Comunas buscadas por nombre (acumulada hasta que el usuario las borre)
  const [searchedCommunes, setSearchedCommunes] = useState<Commune[]>([]);

  const { getBboxByName } = useComunasGeoIndex(true);

  const handleFlyToCommune = useCallback(
    (c: Commune) => {
      // Centrar el perímetro real del polígono si tenemos el geojson cargado;
      // si no, caer al punto del centroide.
      const bbox = getBboxByName(c.name);
      setFlyTarget({
        id: Date.now(),
        lat: c.lat,
        lng: c.lng,
        bbox,
      });
      setHighlightedCommuneName(c.name);
      // No fijamos outlinedCommuneNames aquí: cada call site decide qué lista mostrar.
      // No abrimos el popup demográfico (setPopupCommune) — la búsqueda solo centra y resalta.
    },
    [getBboxByName],
  );

  const handleOpenCommuneRangeResults = useCallback(
    (rows: Commune[], min: number, max: number | null) => {
      setCommuneRangeResults({ rows, min, max });
      setCommuneRangeOpen(true);
      setOutlinedCommuneNames(rows.map((r) => r.name));
      setHighlightedCommuneName(null);
    },
    [],
  );

  // Comparador de comunas
  const [compareCommunes, setCompareCommunes] = useState<Commune[]>([]);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const handleAddCommuneToCompare = useCallback((c: Commune) => {
    setCompareCommunes((prev) => {
      if (prev.some((x) => x.name === c.name)) {
        toast.info(`${c.name} ya está en el comparador`);
        return prev;
      }
      toast.success(`${c.name} añadida al comparador`, {
        description: `Total: ${prev.length + 1}`,
      });
      return [...prev, c];
    });
  }, []);
  const handleRemoveCommuneFromCompare = useCallback((name: string) => {
    setCompareCommunes((prev) => prev.filter((c) => c.name !== name));
  }, []);

  // Mientras el diálogo del comparador esté abierto, dibujar el perímetro
  // de todas las comunas en él. Al cerrar, restaurar al estado previo.
  useEffect(() => {
    if (!compareDialogOpen) return;
    if (compareCommunes.length === 0) return;
    setOutlinedCommuneNames(compareCommunes.map((c) => c.name));
    setHighlightedCommuneName(null);
  }, [compareDialogOpen, compareCommunes]);

  // Sincroniza la lista acumulada de comunas buscadas (tab Texto) con los
  // perímetros del mapa, salvo que esté abierto el rango o el comparador.
  useEffect(() => {
    if (compareDialogOpen) return;
    if (communeRangeOpen) return;
    setOutlinedCommuneNames(searchedCommunes.map((c) => c.name));
  }, [searchedCommunes, compareDialogOpen, communeRangeOpen]);

  // Microzonas
  const [microSubmode, setMicroSubmode] = useState<MicrozoneSubmode>("polygon");
  const [microBufferRadius, setMicroBufferRadius] = useState<number>(500); // metros
  const [microzones, setMicrozones] = useState<Microzone[]>([]);
  const [microDraft, setMicroDraft] = useState<Array<{ lat: number; lng: number }>>([]);
  const [fitMicrozoneId, setFitMicrozoneId] = useState<string | null>(null);

  // POIs guardados
  const navigate = useNavigate();
  const { user } = useAuth();

  // Minutos por defecto por modo (localStorage, no user-scoped)
  const ISO_DEFAULTS_KEY = "isochrone_default_minutes_v1";
  const ISO_MODE_TO_KEY: Record<IsoMode, "walking" | "vehicle" | "bike"> = {
    "foot-walking": "walking",
    "driving-car": "vehicle",
    "cycling-regular": "bike",
  };
  const FALLBACK_MINUTES: [number, number, number] = [5, 7, 10];

  const readIsoDefaults = useCallback((): Record<"walking" | "vehicle" | "bike", [number, number, number]> => {
    try {
      const raw = localStorage.getItem(ISO_DEFAULTS_KEY);
      if (!raw) return { walking: FALLBACK_MINUTES, vehicle: FALLBACK_MINUTES, bike: FALLBACK_MINUTES };
      const parsed = JSON.parse(raw);
      const toInt = (n: unknown): number => {
        const num = typeof n === "number" ? n : Number(n);
        return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
      };
      const pick = (k: string): [number, number, number] => {
        const v = parsed?.[k];
        if (Array.isArray(v)) {
          return [toInt(v[0]), toInt(v[1]), toInt(v[2])];
        }
        if (v && typeof v === "object") {
          return [toInt((v as any).min1), toInt((v as any).min2), toInt((v as any).min3)];
        }
        return FALLBACK_MINUTES;
      };
      return { walking: pick("walking"), vehicle: pick("vehicle"), bike: pick("bike") };
    } catch {
      return { walking: FALLBACK_MINUTES, vehicle: FALLBACK_MINUTES, bike: FALLBACK_MINUTES };
    }
  }, []);

  // Cargar defaults del modo inicial al montar
  useEffect(() => {
    const defaults = readIsoDefaults();
    setIsoMinutes(defaults[ISO_MODE_TO_KEY[isoMode]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cambiar modo, cargar defaults persistidos para ese modo
  const handleIsoModeChange = useCallback((m: IsoMode) => {
    setIsoMode(m);
    const defaults = readIsoDefaults();
    setIsoMinutes(defaults[ISO_MODE_TO_KEY[m]]);
  }, [readIsoDefaults]);

  const saveIsoMinutesAsDefault = useCallback(() => {
    try {
      const current = readIsoDefaults();
      const modeKey = ISO_MODE_TO_KEY[isoMode];
      const toInt = (n: unknown): number => {
        const num = typeof n === "number" ? n : Number(n);
        return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
      };
      const next = {
        ...current,
        [modeKey]: [
          toInt(isoMinutes[0]),
          toInt(isoMinutes[1]),
          toInt(isoMinutes[2]),
        ] as [number, number, number],
      };
      localStorage.setItem(ISO_DEFAULTS_KEY, JSON.stringify(next));
      const modeLabel = ISO_MODE_LABEL[isoMode];
      toast.success(`Defaults guardados para ${modeLabel}`);
    } catch {
      toast.error("No se pudo guardar");
    }
  }, [isoMode, isoMinutes, readIsoDefaults]);
  const {
    pois,
    trashedPois,
    folderCounts: poiFolderCounts,
    addMany,
    addOne: addOnePoi,
    update: updatePoi,
    moveMany: movePois,
    remove: removePoi,
    removeMany: removePois,
    restore: restorePois,
    purgePermanently: purgePois,
    clearAll: clearAllPois,
    loadFolders: loadPoiFolders,
    loading: poisLoading,
  } = useSavedPois();
  const {
    folders,
    trashedFolders,
    create: createFolder,
    rename: renameFolder,
    remove: deleteFolder,
    restore: restoreFolder,
    purgePermanently: purgeFolder,
    move: moveFolder,
    refresh: refreshFolders,
    loading: foldersLoading,
  } = usePoiFolders();
  const [savedPoisVisible, setSavedPoisVisible] = useState(false);
  const [hiddenPoiFolders, setHiddenPoiFolders] = useState<Set<string>>(
    () => new Set(["__orphan__"]),
  );
  const [loadedPoiFolderIds, setLoadedPoiFolderIds] = useState<Set<string | null>>(new Set());

  // Si cambia el user (login/logout/switch), olvidamos qué carpetas estaban
  // ya cargadas: el hook resetea el state de POIs y hay que volver a pedirlas.
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (prevUserIdRef.current !== uid) {
      prevUserIdRef.current = uid;
      setLoadedPoiFolderIds(new Set());
    }
  }, [user]);

  useEffect(() => {
    if (folders.length === 0) return;
    setHiddenPoiFolders((prev) => {
      const next = new Set(prev);
      folders.forEach((f) => next.add(f.id));
      return next;
    });
  }, [folders]);

  const loadPoiFoldersOnce = useCallback(
    async (ids: Array<string | null>) => {
      const fresh = ids.filter((id) => !loadedPoiFolderIds.has(id));
      if (fresh.length === 0) return;
      await loadPoiFolders(fresh);
      setLoadedPoiFolderIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.add(id));
        return next;
      });
    },
    [loadPoiFolders, loadedPoiFolderIds],
  );

  const handleHiddenPoiFoldersChange = useCallback(
    (next: Set<string>) => {
      const activated = Array.from(hiddenPoiFolders).filter((id) => !next.has(id));
      setHiddenPoiFolders(next);
      // Si el usuario enciende al menos una carpeta y el toggle global está apagado,
      // lo encendemos automáticamente para que los markers aparezcan en el mapa.
      if (activated.length > 0) {
        setSavedPoisVisible((v) => (v ? v : true));
      }
      const childrenByParent = new Map<string | null, string[]>();
      folders.forEach((f) => {
        const arr = childrenByParent.get(f.parent_id) ?? [];
        arr.push(f.id);
        childrenByParent.set(f.parent_id, arr);
      });
      const folderIds = new Set<string | null>();
      const addWithDescendants = (id: string | null) => {
        folderIds.add(id);
        if (!id) return;
        (childrenByParent.get(id) ?? []).forEach(addWithDescendants);
      };
      activated.forEach((id) => addWithDescendants(id === "__orphan__" ? null : id));
      const folderIdsToLoad = Array.from(folderIds);
      if (folderIdsToLoad.length > 0) void loadPoiFoldersOnce(folderIdsToLoad);
    },
    [folders, hiddenPoiFolders, loadPoiFoldersOnce],
  );

  // Filtra POIs visibles según la jerarquía: si una carpeta padre está oculta,
  // todos sus descendientes también lo están. La clave "__orphan__" controla los POIs sin carpeta.
  const visiblePois = useMemo(() => {
    if (hiddenPoiFolders.size === 0) return pois;
    const parentMap = new Map(folders.map((f) => [f.id, f.parent_id]));
    const isFolderHidden = (id: string | null): boolean => {
      let cur: string | null = id;
      while (cur) {
        if (hiddenPoiFolders.has(cur)) return true;
        cur = parentMap.get(cur) ?? null;
      }
      return false;
    };
    return pois.filter((p) =>
      p.folder_id === null
        ? !hiddenPoiFolders.has("__orphan__")
        : !isFolderHidden(p.folder_id),
    );
  }, [pois, folders, hiddenPoiFolders]);

  const [managerOpen, setManagerOpen] = useState(false);
  const [savePending, setSavePending] = useState<{ items: PoiInsert[]; defaultName: string } | null>(null);

  // Editor de POI (creación/edición) — centralizado.
  const [poiEditor, setPoiEditor] = useState<
    | { mode: "create"; defaultDraft: Partial<PoiEditorDraft> }
    | { mode: "edit"; poi: SavedPoi; defaultDraft?: Partial<PoiEditorDraft> }
    | null
  >(null);
  // Picker de coordenadas: cuando es true, el siguiente click del mapa
  // rellena lat/lng del draft y reabre el editor.
  const [coordPicker, setCoordPicker] = useState<{
    mode: "create" | "edit";
    poi?: SavedPoi;
    draft: PoiEditorDraft;
  } | null>(null);

  const openCreatePoiAt = useCallback(
    (latlng: { lat: number; lng: number } | null, folderId: string | null = null) => {
      const defaultDraft: Partial<PoiEditorDraft> = { folderId };
      if (latlng) {
        defaultDraft.lat = latlng.lat.toFixed(6);
        defaultDraft.lng = latlng.lng.toFixed(6);
      }
      setPoiEditor({ mode: "create", defaultDraft });
    },
    [],
  );

  const handlePickOnMap = useCallback((draft: PoiEditorDraft) => {
    // Cierra el editor (preservando el draft) y activa el picker.
    setPoiEditor((prev) => {
      if (!prev) return prev;
      if (prev.mode === "edit") {
        setCoordPicker({ mode: "edit", poi: prev.poi, draft });
      } else {
        setCoordPicker({ mode: "create", draft });
      }
      return null;
    });
    toast.info("Haz click en el mapa para fijar la posición", { duration: 4000 });
  }, []);

  const handlePickCoord = useCallback((c: { lat: number; lng: number }) => {
    setCoordPicker((prev) => {
      if (!prev) return null;
      const newDraft: PoiEditorDraft = {
        ...prev.draft,
        lat: c.lat.toFixed(6),
        lng: c.lng.toFixed(6),
      };
      if (prev.mode === "edit" && prev.poi) {
        setPoiEditor({ mode: "edit", poi: prev.poi, defaultDraft: newDraft });
      } else {
        setPoiEditor({ mode: "create", defaultDraft: newDraft });
      }
      return null;
    });
  }, []);

  // ESC cancela el picker.
  useEffect(() => {
    if (!coordPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setCoordPicker((prev) => {
        if (!prev) return null;
        if (prev.mode === "edit" && prev.poi) {
          setPoiEditor({ mode: "edit", poi: prev.poi, defaultDraft: prev.draft });
        } else {
          setPoiEditor({ mode: "create", defaultDraft: prev.draft });
        }
        return null;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coordPicker]);

  // Menú contextual del mapa (click derecho).
  const { visible: parqueVisible } = useParqueLayer();
  const [mapMenu, setMapMenu] = useState<
    { x: number; y: number; lat: number; lng: number } | null
  >(null);
  const [parqueInfo, setParqueInfo] = useState<
    { x: number; y: number; hex: ParqueHexProps } | null
  >(null);

  const handleMapContextMenu = useCallback(
    (c: { lat: number; lng: number; x: number; y: number }) => {
      if (coordPicker) return; // si está activo el picker, no abrir menú
      setParqueInfo(null);
      setMapMenu({ x: c.x, y: c.y, lat: c.lat, lng: c.lng });
      // Si la capa de parque está visible, precargar el GeoJSON para tener el hex listo
      if (parqueVisible) {
        void loadParqueGeoJson().catch(() => {});
      }
    },
    [coordPicker, parqueVisible],
  );

  const handleMenuCreatePoi = useCallback(() => {
    if (!mapMenu) return;
    if (!user) {
      toast.error("Inicia sesión para crear POIs");
      navigate("/auth");
      return;
    }
    openCreatePoiAt({ lat: mapMenu.lat, lng: mapMenu.lng }, null);
  }, [mapMenu, user, navigate, openCreatePoiAt]);

  const handleMenuParqueInfo = useCallback(() => {
    if (!mapMenu) return;
    const hex = findHexAt(mapMenu.lat, mapMenu.lng);
    if (!hex) {
      toast.error("No hay datos de parque en este punto");
      return;
    }
    setParqueInfo({ x: mapMenu.x, y: mapMenu.y, hex: hex.properties });
  }, [mapMenu]);

  const mapMenuItems = useMemo<MapContextMenuItem[]>(() => {
    const items: MapContextMenuItem[] = [
      { key: "poi", label: "Crear POI", icon: "📍", onClick: handleMenuCreatePoi },
    ];
    if (parqueVisible) {
      items.push({
        key: "parque",
        label: "Ver info parque",
        icon: "🚗",
        onClick: handleMenuParqueInfo,
      });
    }
    return items;
  }, [parqueVisible, handleMenuCreatePoi, handleMenuParqueInfo]);

  const savePoisFromLayer = useCallback(
    (layerIdOrIds: string | string[]) => {
      if (!user) {
        toast.error("Inicia sesión para guardar POIs");
        navigate("/auth");
        return;
      }
      const ids = Array.isArray(layerIdOrIds) ? layerIdOrIds : [layerIdOrIds];
      const layers = ids
        .map((id) => userLayers.find((l) => l.id === id))
        .filter((l): l is NonNullable<typeof l> => !!l);
      if (!layers.length) return;
      const items = layers.flatMap((layer) =>
        extractPointPois(layer.data, layer.name, { color: layer.color }),
      );
      if (!items.length) {
        toast.error(layers.length > 1 ? "Las capas seleccionadas no contienen puntos" : "Esta capa no contiene puntos");
        return;
      }
      const defaultName =
        layers.length === 1 ? layers[0].name : `${layers.length} capas`;
      setSavePending({ items, defaultName });
    },
    [user, userLayers, navigate],
  );

  /**
   * Guarda items con `_folderPath` opcional, replicando subcarpetas dentro
   * de `folderId` (carpeta destino raíz; null = sin carpeta). Devuelve
   * { inserted, foldersCreated }.
   */
  const savePoiItemsToFolder = useCallback(
    async (
      items: PoiInsert[],
      folderId: string | null,
    ): Promise<{ inserted: number; foldersCreated: number }> => {
      const FOLDER_PATH_KEY = "_folderPath";
      const cache = new Map<string, string | null>();
      cache.set("", folderId);

      const ensureFolder = async (path: string[]): Promise<string | null> => {
        if (!path.length) return folderId;
        const key = path.join("\u0000");
        if (cache.has(key)) return cache.get(key)!;
        const parent = await ensureFolder(path.slice(0, -1));
        const name = path[path.length - 1];
        const f = await createFolder(name, parent, null);
        cache.set(key, f.id);
        return f.id;
      };

      const itemsWithFolders: PoiInsert[] = [];
      for (const item of items) {
        const props = (item.properties ?? {}) as Record<string, unknown>;
        const raw = props[FOLDER_PATH_KEY];
        const path = Array.isArray(raw)
          ? (raw.filter((x) => typeof x === "string") as string[])
          : [];
        const targetFolder = await ensureFolder(path);
        itemsWithFolders.push({ ...item, folder_id: targetFolder });
      }

      const inserted = await addMany(itemsWithFolders, folderId);
      return { inserted, foldersCreated: cache.size - 1 };
    },
    [addMany, createFolder],
  );

  const confirmSavePois = useCallback(
    async (folderId: string | null) => {
      if (!savePending) return;
      try {
        const { inserted, foldersCreated } = await savePoiItemsToFolder(
          savePending.items,
          folderId,
        );
        toast.success(
          foldersCreated > 0
            ? `${inserted} POIs guardados · ${foldersCreated} carpetas creadas`
            : `${inserted} POIs guardados`,
        );
        setSavePending(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(`No se pudieron guardar: ${msg}`);
      }
    },
    [savePending, savePoiItemsToFolder],
  );

  /**
   * Importa archivos KMZ/KML/GeoJSON directamente a una carpeta destino,
   * sin pasar por el diálogo de selección de carpeta.
   */
  const importFilesIntoFolder = useCallback(
    async (files: File[], folderId: string | null) => {
      if (!user) {
        toast.error("Inicia sesión para guardar POIs");
        navigate("/auth");
        return;
      }
      if (!files.length) return;
      let totalInserted = 0;
      let totalFolders = 0;
      let totalFiles = 0;
      for (const file of files) {
        try {
          if (!getExtension(file.name)) {
            toast.error(`${file.name}: formato no soportado`);
            continue;
          }
          const data = await parseFile(file);
          const baseName = file.name.replace(/\.(geojson|json|kml|kmz)$/i, "");
          const items = extractPointPois(data, baseName);
          if (!items.length) {
            toast.error(`${file.name}: sin puntos para guardar`);
            continue;
          }
          const { inserted, foldersCreated } = await savePoiItemsToFolder(
            items,
            folderId,
          );
          totalInserted += inserted;
          totalFolders += foldersCreated;
          totalFiles += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Error";
          toast.error(`${file.name}: ${msg}`);
        }
      }
      if (totalInserted > 0) {
        toast.success(
          totalFolders > 0
            ? `${totalInserted} POIs guardados desde ${totalFiles} archivo(s) · ${totalFolders} subcarpetas creadas`
            : `${totalInserted} POIs guardados desde ${totalFiles} archivo(s)`,
        );
      }
    },
    [user, navigate, savePoiItemsToFolder],
  );

  const isoColorPalette = [
    "#34D399", "#60A5FA", "#F472B6", "#FBBF24",
    "#A78BFA", "#FB7185", "#22D3EE", "#FB923C",
  ];

  const addUserLayer = useCallback((layer: UserLayer) => {
    setUserLayers((prev) => [...prev, layer]);
    setFitId(layer.id);
  }, []);
  const toggleUserLayer = useCallback((id: string) => {
    setUserLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }, []);
  const removeUserLayer = useCallback((id: string) => {
    setUserLayers((prev) => prev.filter((l) => l.id !== id));
  }, []);
  const handleFitDone = useCallback(() => setFitId(null), []);

  // Cargar POIs desde Overpass (OSM) en el área visible
  const loadOverpass = useCallback(
    async (kind: { type: "preset"; presetId: string; label: string } | { type: "text"; text: string }) => {
      if (!mapViewport) {
        toast.error("Mapa aún no listo");
        return;
      }
      const [south, west, north, east] = mapViewport.bbox;
      const bbox = { south, west, north, east };
      const area = bboxAreaDegSq(bbox);
      // ~0.25 deg² ≈ 50x50 km a la latitud de Santiago — suficiente; mayor = lento o rechazado
      if (area > 0.25) {
        toast.error("Acerca el mapa: el área visible es demasiado grande para OSM");
        return;
      }
      const tId = toast.loading("Consultando OpenStreetMap…");
      try {
        const fc =
          kind.type === "preset"
            ? await fetchOverpassPreset(kind.presetId, bbox)
            : await fetchOverpassFreeText(kind.text, bbox);
        if (!fc.features.length) {
          toast.error("Sin resultados en el área visible", { id: tId });
          return;
        }
        const label = kind.type === "preset" ? kind.label : kind.text;
        const id = `osm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const palette = ["#34D399", "#F472B6", "#FBBF24", "#60A5FA", "#A78BFA", "#FB7185", "#22D3EE", "#FB923C"];
        const color = palette[userLayers.length % palette.length];
        addUserLayer({
          id,
          name: `OSM · ${label}`,
          color,
          visible: true,
          data: fc,
        });
        toast.success(`${fc.features.length} POIs cargados (${label})`, { id: tId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(`Overpass falló: ${msg}`, { id: tId });
      }
    },
    [mapViewport, userLayers.length, addUserLayer],
  );

  const toggleIsochrone = useCallback((id: string) => {
    setIsochrones((prev) => prev.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)));
  }, []);
  const removeIsochrone = useCallback((id: string) => {
    setIsochrones((prev) => prev.filter((i) => i.id !== id));
  }, []);
  const clearIsochrones = useCallback(() => setIsochrones([]), []);
  const handleFitIsoDone = useCallback(() => setFitIsoId(null), []);

  // ---- Saved isochrones loading into the active map state ----
  const loadSavedIsoToMap = useCallback(
    (id: string) => {
      const s = savedIsos.find((x) => x.id === id);
      if (!s) return null;
      const mapId = `saved:${s.id}`;
      setIsochrones((prev) => {
        if (prev.some((i) => i.id === mapId)) return prev;
        return [
          ...prev,
          {
            id: mapId,
            mode: s.mode,
            minutes: s.minutes,
            center: { lat: s.center_lat, lng: s.center_lng },
            color: s.color ?? "hsl(var(--iso-1))",
            visible: true,
            createdAt: new Date(s.created_at).getTime(),
            features: s.features,
          },
        ];
      });
      setLoadedSavedIsoIds((prev) => {
        const next = new Set(prev);
        next.add(s.id);
        return next;
      });
      return mapId;
    },
    [savedIsos],
  );

  const toggleSavedIso = useCallback(
    (id: string) => {
      const mapId = `saved:${id}`;
      if (loadedSavedIsoIds.has(id)) {
        setIsochrones((prev) => prev.filter((i) => i.id !== mapId));
        setLoadedSavedIsoIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        loadSavedIsoToMap(id);
      }
    },
    [loadedSavedIsoIds, loadSavedIsoToMap],
  );

  const focusSavedIso = useCallback(
    (id: string) => {
      const mapId = `saved:${id}`;
      if (!loadedSavedIsoIds.has(id)) loadSavedIsoToMap(id);
      setFitIsoId(mapId);
      setSelectedIsoId(mapId);
      autoOpenPanel();
    },
    [loadedSavedIsoIds, loadSavedIsoToMap],
  );

  const analyzeSavedIso = useCallback(
    (id: string) => {
      const mapId = `saved:${id}`;
      if (!loadedSavedIsoIds.has(id)) loadSavedIsoToMap(id);
      setSelectedIsoId(mapId);
      userOpenPanel();
    },
    [loadedSavedIsoIds, loadSavedIsoToMap, userOpenPanel],
  );

  const handleSaveIsochronePayload = useCallback(
    async (payload: import("@/types/savedIsochrones").SaveIsochronePayload) => {
      try {
        await saveIsochrone(payload);
        toast.success("Isócrona guardada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al guardar");
      }
    },
    [saveIsochrone],
  );

  const handleMapClick = useCallback(
    async (c: { lat: number; lng: number }) => {
      if (mode !== "isochrone") return;
      const minutes = [...isoMinutes].filter((n) => n > 0).sort((a, b) => a - b);
      if (!minutes.length) {
        toast.error("Define al menos un valor de minutos");
        return;
      }
      setIsoLoading(true);
      const tId = toast.loading("Calculando isócrona…");
      try {
        const features = await fetchIsochrone({ mode: isoMode, lat: c.lat, lng: c.lng, minutes });
        const id = `iso-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const color = isoColorPalette[isochrones.length % isoColorPalette.length];
        const newIso: Isochrone = {
          id,
          mode: isoMode,
          minutes,
          center: c,
          color,
          visible: true,
          createdAt: Date.now(),
          features,
        };
        setIsochrones((prev) => [...prev, newIso]);
        setFitIsoId(id);
        setSelectedIsoId(id);
        autoOpenPanel();
        toast.success("Isócrona añadida", { id: tId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(`No se pudo calcular: ${msg}`, { id: tId });
      } finally {
        setIsoLoading(false);
      }
    },
    [mode, isoMode, isoMinutes, isochrones.length, autoOpenPanel],
  );

  const handleViewportChange = useCallback(
    (bbox: [number, number, number, number], zoom: number) => {
      setViewport({ bbox, zoom });
    },
    []
  );

  const { data: manzanaData, loading: manzanaLoading, error: manzanaError } = useManzanas({
    enabled: layers.manzanas,
    bbox: viewport?.bbox ?? null,
    zoom: viewport?.zoom ?? 12,
    variable: manzanaVariable,
    minZoom: 12,
  });

  const { data: densityData } = useManzanas({
    enabled: layers.density,
    bbox: densityViewport?.bbox ?? null,
    zoom: densityViewport?.zoom ?? 12,
    variable: "density",
    minZoom: 12,
  });

  const gastoManzana = layers.gasto && gastoView === "manzana";
  const crimeManzana = layers.crime && crimeView === "manzana";
  const { data: gseData, error: gseError } = useGseManzanas({
    enabled: layers.nse || crimeManzana || gastoManzana,
    bbox: gseViewport?.bbox ?? null,
    zoom: gseViewport?.zoom ?? 12,
    variable: crimeManzana ? "crime" : gastoManzana ? "gasto" : gseVariable,
    minZoom: 11,
  });

  const handleGseViewportChange = useCallback(
    (bbox: [number, number, number, number], zoom: number) => {
      setGseViewport({ bbox, zoom });
    },
    [],
  );

  // ---------- Microzonas ----------
  const addMicrozone = useCallback(
    (
      kind: MicrozoneSubmode,
      geometry: Microzone["geometry"],
      name: string,
    ) => {
      const id = `mz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const color = MICRO_PALETTE[microzones.length % MICRO_PALETTE.length];
      const stats = computeMicrozoneStats(geometry, manzanaData);
      const mz: Microzone = {
        id,
        name,
        kind,
        color,
        visible: true,
        createdAt: Date.now(),
        geometry,
        stats,
      };
      setMicrozones((prev) => [...prev, mz]);
      setFitMicrozoneId(id);
      toast.success(
        stats.manzanaCount > 0
          ? `Microzona creada · ${stats.manzanaCount} manzanas · ${stats.pop.toLocaleString("es-CL")} hab.`
          : "Microzona creada (activa la capa Manzanas para análisis demográfico)",
      );
      return id;
    },
    [microzones.length, manzanaData],
  );

  const handleMicroAddVertex = useCallback(
    (c: { lat: number; lng: number }) => {
      setMicroDraft((prev) => [...prev, c]);
    },
    [],
  );

  const handleMicroClosePolygon = useCallback(() => {
    setMicroDraft((prev) => {
      if (prev.length < 3) {
        toast.error("Necesitas al menos 3 vértices");
        return prev;
      }
      const geom = polygonFromLatLngs(prev);
      if (!geom) {
        toast.error("Polígono inválido");
        return prev;
      }
      addMicrozone("polygon", geom, `Polígono ${microzones.length + 1}`);
      return [];
    });
  }, [addMicrozone, microzones.length]);

  const handleMicroBufferClick = useCallback(
    (c: { lat: number; lng: number }) => {
      const geom = bufferAroundPoint(c, microBufferRadius);
      if (!geom) {
        toast.error("No se pudo crear el buffer");
        return;
      }
      const radioLabel = microBufferRadius >= 1000
        ? `${(microBufferRadius / 1000).toFixed(1)} km`
        : `${microBufferRadius} m`;
      addMicrozone("buffer", geom, `Buffer ${radioLabel}`);
    },
    [microBufferRadius, addMicrozone],
  );

  const generateVoronoi = useCallback(() => {
    if (!savedPoisVisible) {
      toast.error("Activa 'Mostrar en mapa' para los POIs");
      return;
    }
    if (pois.length < 2) {
      toast.error("Se necesitan al menos 2 POIs visibles");
      return;
    }
    const cells = voronoiFromPois(pois.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })));
    if (cells.length === 0) {
      toast.error("No se pudieron calcular celdas Voronoi");
      return;
    }
    cells.forEach((cell, idx) => {
      const stats = computeMicrozoneStats(cell, manzanaData);
      const id = `mz-vor-${Date.now()}-${idx}`;
      const color = MICRO_PALETTE[(microzones.length + idx) % MICRO_PALETTE.length];
      setMicrozones((prev) => [
        ...prev,
        {
          id,
          name: `Voronoi #${idx + 1}`,
          kind: "voronoi",
          color,
          visible: true,
          createdAt: Date.now() + idx,
          geometry: cell,
          stats,
        },
      ]);
    });
    toast.success(`${cells.length} zonas Voronoi creadas`);
  }, [pois, manzanaData, microzones.length, savedPoisVisible]);

  const removeMicrozone = useCallback((id: string) => {
    setMicrozones((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const toggleMicrozone = useCallback((id: string) => {
    setMicrozones((prev) =>
      prev.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)),
    );
  }, []);

  const clearMicrozones = useCallback(() => {
    setMicrozones([]);
    setMicroDraft([]);
  }, []);

  // Recalcular stats cuando cambia manzanaData
  useEffect(() => {
    if (!manzanaData || microzones.length === 0) return;
    setMicrozones((prev) =>
      prev.map((m) => ({ ...m, stats: computeMicrozoneStats(m.geometry, manzanaData) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manzanaData]);

  // Limpiar borrador al salir del modo
  useEffect(() => {
    if (mode !== "microzone") setMicroDraft([]);
  }, [mode]);

  // ESC para cancelar borrador en modo polígono
  useEffect(() => {
    if (mode !== "microzone") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMicroDraft([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const toggleLayer = (key: keyof LayerState) => {
    setLayers((l) => ({ ...l, [key]: !l[key] }));
    if (key === "nse" && layers.nse) setNseFilter(null);
    if (key === "traffic" && layers.traffic) setTrafficFilter(null);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Header
        mode={mode}
        onToggleIsochrone={() => setMode((m) => (m === "isochrone" ? "none" : "isochrone"))}
        onToggleMicrozone={() => setMode((m) => (m === "microzone" ? "none" : "microzone"))}
        provider={mapProvider.provider}
      />

      <main className="flex flex-1 overflow-hidden">
        <Sidebar
          basemap={basemap}
          onBasemapChange={setBasemap}
          mode={mode}
          layers={layers}
          onToggleLayer={toggleLayer}
          manzanaVariable={manzanaVariable}
          onManzanaVariableChange={setManzanaVariable}
          manzanaLoading={manzanaLoading}
          manzanaCount={manzanaData?.features.length ?? 0}
          gseVariable={gseVariable}
          onGseVariableChange={setGseVariable}
          gseCount={gseData?.features.length ?? 0}
          activeCommercialCats={activeCommercialCats}
          onCommercialToggle={handleCommercialToggle}
          crimeView={crimeView}
          onCrimeViewChange={setCrimeView}
          crimeType={crimeType}
          onCrimeTypeChange={setCrimeType}
          activeRisk={activeRisk}
          onRiskToggle={handleRiskToggle}
          gastoView={gastoView}
          onGastoViewChange={setGastoView}
          chileCommunesVariable={chileCommunesVariable}
          onChileCommunesVariableChange={setChileCommunesVariable}
          userLayers={userLayers}
          onAddUserLayer={addUserLayer}
          onToggleUserLayer={toggleUserLayer}
          onRemoveUserLayer={removeUserLayer}
          onSavePoisFromLayer={savePoisFromLayer}
          getLayerPointCount={(id) => {
            const l = userLayers.find((x) => x.id === id);
            return l ? countPoints(l.data) : 0;
          }}
          isAuthenticated={!!user}
          isoMode={isoMode}
          onIsoModeChange={handleIsoModeChange}
          isoMinutes={isoMinutes}
          onIsoMinutesChange={setIsoMinutes}
          onSaveIsoMinutesDefault={saveIsoMinutesAsDefault}
          isochrones={isochrones}
          onToggleIsochrone={toggleIsochrone}
          onRemoveIsochrone={removeIsochrone}
          onClearIsochrones={clearIsochrones}
          onFocusIsochrone={(id) => { setFitIsoId(id); setSelectedIsoId(id); autoOpenPanel(); }}
          isoLoading={isoLoading}
          onToggleIsoMode={() => setMode((m) => (m === "isochrone" ? "none" : "isochrone"))}
          onAnalyzeIsochrone={(id) => { setSelectedIsoId(id); userOpenPanel(); }}
          onSaveIsochrone={(id) => setSaveIsoDialogId(id)}
          onReportIsochrone={(id) => setReportIsoDialogId(id)}
          savedIsochrones={savedIsos}
          isoFolders={isoFolders}
          loadedSavedIsoIds={loadedSavedIsoIds}
          onToggleSavedIsochrone={toggleSavedIso}
          onAnalyzeSavedIsochrone={analyzeSavedIso}
          onProjectSavedIsochrone={(id) => {
            // Seleccionar la isócrona guardada en el panel de análisis
            // y abrir el panel con la sección de proyección activa
            const savedIso = savedIsos.find((s) => s.id === id);
            if (savedIso) {
              // Asegurar que la isócrona esté cargada en el mapa
              if (!loadedSavedIsoIds.has(id)) toggleSavedIso(id);
              // Buscar la isócrona activa correspondiente para seleccionarla
              const activeIso = isochrones.find((i) => i.id === `saved:${id}`);
              if (activeIso) setSelectedIsoId(activeIso.id);
            }
            setProjectionIsoId(id);
            userOpenPanel();
          }}
          onFocusSavedIsochrone={focusSavedIso}
          onRenameSavedIsochrone={(id, name) => updateSavedIso(id, { name })}
          onMoveSavedIsochrone={(id, folder_id) => updateSavedIso(id, { folder_id })}
          onDeleteSavedIsochrone={removeSavedIso}
          onCreateIsoFolder={(name, parentId) => createIsoFolder(name, parentId)}
          onRenameIsoFolder={renameIsoFolder}
          onDeleteIsoFolder={deleteIsoFolder}
          savedPois={pois}
          onFocusPoi={(p) =>
            setFlyTarget({ id: Date.now(), lat: p.lat, lng: p.lng, bbox: null })
          }
          savedPoisVisible={savedPoisVisible}
          onToggleSavedPoisVisible={() => setSavedPoisVisible((v) => !v)}
          onRemoveSavedPoi={removePoi}
          onClearSavedPois={clearAllPois}
          onOpenPoiManager={() => setManagerOpen(true)}
          poiFolderCount={folders.length}
          poiFolders={folders}
          poiFolderCounts={poiFolderCounts}
          onMoveFolder={moveFolder}
          onMovePois={movePois}
          onImportFilesIntoFolder={importFilesIntoFolder}
          onCreateFolder={(name, parentId) => createFolder(name, parentId, null)}
          onDeleteFolder={deleteFolder}
          onRenameFolder={(id, name) => renameFolder(id, name)}
          onRenamePoi={(id, name) => updatePoi(id, { name })}
          onCreatePoi={(payload) => addOnePoi(payload)}
          onRequestCreatePoiInFolder={(folder) => openCreatePoiAt(null, folder?.id ?? null)}
          onEditPoi={(poi) => setPoiEditor({ mode: "edit", poi, defaultDraft: {} })}
          hiddenPoiFolders={hiddenPoiFolders}
          onHiddenPoiFoldersChange={handleHiddenPoiFoldersChange}
          trashedPois={trashedPois}
          trashedFolders={trashedFolders}
          onRestorePois={restorePois}
          onRestoreFolder={restoreFolder}
          onPurgePois={purgePois}
          onPurgeFolder={purgeFolder}
          microSubmode={microSubmode}
          onMicroSubmodeChange={setMicroSubmode}
          microBufferRadius={microBufferRadius}
          onMicroBufferRadiusChange={setMicroBufferRadius}
          microActive={mode === "microzone"}
          onToggleMicroMode={() => setMode((m) => (m === "microzone" ? "none" : "microzone"))}
          microzones={microzones}
          onToggleMicrozone={toggleMicrozone}
          onRemoveMicrozone={removeMicrozone}
          onClearMicrozones={clearMicrozones}
          onFocusMicrozone={setFitMicrozoneId}
          onGenerateVoronoi={generateVoronoi}
          onLoadOverpass={loadOverpass}
          onFlyToCommune={handleFlyToCommune}
          onOpenCommuneRangeResults={handleOpenCommuneRangeResults}
          compareCommunes={compareCommunes}
          onCompareCommunesChange={setCompareCommunes}
          onOpenCompareDialog={() => setCompareDialogOpen(true)}
          searchedCommunes={searchedCommunes}
          onSearchedCommunesChange={setSearchedCommunes}
          isAdmin={isAdmin}
          poiFolderSchemas={poiFolderSchemas}
          onImportToFolder={(folderId) => setImportDialogFolderId(folderId)}
          onConfigureFolderSchema={(folderId) => setSchemaDialogFolderId(folderId)}
          onConfigureAnalysis={(folderId) => setAnalysisConfigFolderId(folderId)}
          onComputeFeatures={(folderId) => setComputeFeaturesFolderId(folderId)}
          comercialLayers={comercialLayers}
          comercialCounts={comercialCounts}
          comercialHiddenBrands={comercialHiddenBrands}
          onComercialToggle={handleComercialToggle}
          onComercialBrandToggle={handleComercialBrandToggle}
          onSetComercialHiddenBrands={handleSetComercialHiddenBrands}
          onComercialManagedBrandsChange={handleComercialManagedBrandsChange}
          onRecomputePerformance={async (folderId) => {
            try {
              const r = await performanceBatch.run(folderId);
              toast.success(
                `Análisis recalculado · ${r.n_pois_processed} POIs · ` +
                  `Modelo A R²=${(r.model_a.r2 * 100).toFixed(0)}%` +
                  (r.model_b ? ` · Modelo B R²=${(r.model_b.r2 * 100).toFixed(0)}%` : ""),
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
        />

        <div
          className={[
            "relative flex-1 overflow-hidden",
            coordPicker && "[&_.leaflet-container]:cursor-crosshair",
            !coordPicker && mode === "isochrone" && "[&_.leaflet-container]:cursor-crosshair",
            !coordPicker && mode === "microzone" && "[&_.leaflet-container]:cursor-cell",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {(poisLoading || foldersLoading) && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2">
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-surface/95 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-apple-md backdrop-blur-xl">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                {poisLoading && foldersLoading
                  ? "Sincronizando POIs y carpetas…"
                  : poisLoading
                    ? "Sincronizando POIs…"
                    : "Sincronizando carpetas…"}
              </div>
            </div>
          )}
          <MapView
            basemap={basemap}
            provider={mapProvider.provider}
            onMouseMove={setCoords}
            layers={layers}
            nseFilter={nseFilter}
            trafficFilter={trafficFilter}
            manzanaData={manzanaData}
            manzanaVariable={manzanaVariable}
            onManzanaViewportChange={handleViewportChange}
            densityData={densityData}
            onDensityViewportChange={handleDensityViewportChange}
            gseData={gseData}
            gseVariable={crimeManzana ? "crime" : gastoManzana ? "gasto" : gseVariable}
            onGseViewportChange={handleGseViewportChange}
            crimeView={crimeView}
            crimeType={crimeType}
            gastoView={gastoView}
            agroplanetScoreMode={agroplanetScoreMode}
            activeRisk={activeRisk}
            activeCommercialCats={activeCommercialCats}
            isAdmin={isAdmin}
            chileCommunesVariable={chileCommunesVariable}
            userLayers={userLayers}
            fitUserLayerId={fitId}
            onFitUserLayerDone={handleFitDone}
            isochrones={isochrones}
            fitIsochroneId={fitIsoId}
            onFitIsochroneDone={handleFitIsoDone}
            isoMode={mode === "isochrone"}
            onMapClick={handleMapClick}
            savedPois={visiblePois}
            savedPoisVisible={savedPoisVisible}
            microzones={microzones}
            microActive={mode === "microzone"}
            microSubmode={microSubmode}
            microDraftVertices={microDraft}
            onMicroAddVertex={handleMicroAddVertex}
            onMicroClosePolygon={handleMicroClosePolygon}
            onMicroBufferClick={handleMicroBufferClick}
            fitMicrozoneId={fitMicrozoneId}
            onFitMicrozoneDone={() => setFitMicrozoneId(null)}
            flyTarget={flyTarget}
            onViewportChange={handleMapViewportChange}
            openCommunePopupFor={popupCommune}
            onCommunePopupOpened={() => setPopupCommune(null)}
            onAddCommuneToCompare={handleAddCommuneToCompare}
            outlinedCommuneNames={outlinedCommuneNames}
            highlightedCommuneName={highlightedCommuneName}
            onMapContextMenu={handleMapContextMenu}
            coordPickerActive={!!coordPicker}
            onPickCoord={handlePickCoord}
            onPoiClick={(poi) => {
              if (poiPickContext) return; // Si está en pick mode, no abrimos detalle.
              setDetailPoi(poi);
            }}
            poiPickMode={!!poiPickContext}
            onPoiPickSelect={(poi) => {
              if (!poiPickContext) return;
              setExternalManualSelection({ rowIndex: poiPickContext.rowIndex, poiId: poi.id });
              setPoiPickContext(null);
              toast.success(`POI "${poi.name}" asignado`);
            }}
            comercialLayers={comercialLayers}
            comercialHiddenBrands={comercialHiddenBrands}
            comercialManagedBrands={comercialManagedBrands}
            comercialBrandLogos={brandLogos}
            onComercialCountChange={handleComercialCountChange}
            customLayers={customMapLayers}
          />

          <SearchBar
            onSelect={(r: SearchResult) =>
              setFlyTarget({ id: Date.now(), lat: r.lat, lng: r.lng, bbox: r.bbox })
            }
            provider={mapProvider.provider}
          />
          <ApiUsagePanel
            provider={mapProvider.provider}
            onProviderChange={mapProvider.setProvider}
            usage={mapProvider.usage}
            hasGoogleKey={mapProvider.hasGoogleKey}
            isLimitReached={mapProvider.isLimitReached}
          />
          <Legend
            shifted={panelOpen}
            layers={layers}
            nseFilter={nseFilter}
            onNseFilterChange={setNseFilter}
            trafficFilter={trafficFilter}
            onTrafficFilterChange={setTrafficFilter}
            manzanaVariable={manzanaVariable}
            manzanaSource={manzanaData?.metadata.source ?? null}
            manzanaError={manzanaError}
            gseVariable={gseVariable}
            gseError={gseError}
            gseCount={gseData?.features.length ?? 0}
            chileCommunesActive={layers.communesGeo}
            chileCommunesVariable={chileCommunesVariable}
          />
          <CoordsBar coords={coords} />

          {/* Panel flotante inferior-izquierdo: controles de capas territoriales */}
          <TerritorialLayerFloatingPanel
            layers={layers}
            agroplanetScoreMode={agroplanetScoreMode}
            onAgroplanetScoreModeChange={setAgroplanetScoreMode}
            chileCommunesVariable={chileCommunesVariable}
            onChileCommunesVariableChange={setChileCommunesVariable}
            gseVariable={gseVariable}
            onGseVariableChange={setGseVariable}
            gseCount={gseData?.features.length ?? 0}
            activeCommercialCats={activeCommercialCats}
            onCommercialToggle={handleCommercialToggle}
            gastoView={gastoView}
            onGastoViewChange={setGastoView}
          />

          {/* Mode hint */}
          {mode !== "none" && (
            <div
              className={[
                "pointer-events-none absolute left-1/2 top-[68px] z-[700] -translate-x-1/2 rounded-full px-4 py-1.5 text-[12px] font-medium shadow-apple backdrop-blur-2xl",
                mode === "isochrone"
                  ? "bg-iso-1/90 text-background"
                  : "bg-brand-purple/90 text-background",
              ].join(" ")}
            >
              {mode === "isochrone"
                ? "Haz clic en el mapa para generar una isócrona"
                : microSubmode === "polygon"
                  ? "Clic para añadir vértice · Doble clic para cerrar · ESC para cancelar"
                  : microSubmode === "buffer"
                    ? `Clic para crear un buffer de ${microBufferRadius >= 1000 ? `${(microBufferRadius / 1000).toFixed(1)} km` : `${microBufferRadius} m`}`
                    : "Modo Voronoi · usa el botón en la barra lateral para generarlo"}
            </div>
          )}

          {/* Pestaña vertical pegada al panel de análisis (arriba, bajo zoom) */}
          <button
            onClick={() => (panelOpen ? userClosePanel() : userOpenPanel())}
            aria-label={panelOpen ? "Cerrar panel de análisis" : "Abrir panel de análisis"}
            style={{ right: panelOpen ? panelWidth : 0 }}
            className="absolute top-20 z-[700] flex h-28 w-8 items-center justify-center rounded-l-lg border border-r-0 border-border/60 bg-surface/90 text-foreground shadow-apple-lg backdrop-blur-xl transition-[right] duration-300 hover:bg-surface-2"
          >
            <span className="flex flex-col items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {panelOpen ? <path d="M9 6l6 6-6 6"/> : <path d="M15 6l-6 6 6 6"/>}
              </svg>
              <span className="text-[10px] font-medium tracking-wider uppercase [writing-mode:vertical-rl] rotate-180">
                Análisis
              </span>
            </span>
          </button>

          <AnalysisPanel
            open={panelOpen}
            onClose={userClosePanel}
            isochrone={(() => {
              // 1. Preferir la isócrona explícitamente seleccionada
              if (selectedIsoId) {
                const found = isochrones.find((i) => i.id === selectedIsoId);
                if (found) return found;
                // Si selectedIsoId está seteado pero aún no se cargó (race condition),
                // retornar null en lugar del fallback silencioso incorrecto.
                // El panel mostrará "Selecciona una isócrona" hasta que cargue.
                return null;
              }
              // 2. Sin selección explícita: usar la más reciente (createdAt mayor)
              return isochrones.length > 0
                ? [...isochrones].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
                : null;
            })()}
            manzanas={manzanaData ?? densityData ?? null}
            width={panelWidth}
            onWidthChange={handlePanelWidthChange}
            minWidth={PANEL_MIN_W}
            maxWidth={PANEL_MAX_W}
            projectionFolders={folders.filter(f => !f.parent_id).map(f => ({ id: f.id, name: f.name }))}
            autoOpenProjection={!!projectionIsoId}
            isochroneName={
              selectedIsoId
                ? savedIsos.find((s) => `saved:${s.id}` === selectedIsoId)?.name ?? null
                : null
            }
          />
        </div>
      </main>

      {mapMenu && (
        <MapContextMenu
          x={mapMenu.x}
          y={mapMenu.y}
          items={mapMenuItems}
          onClose={() => setMapMenu(null)}
        />
      )}

      {parqueInfo && (
        <ParqueHexInfoCard
          x={parqueInfo.x}
          y={parqueInfo.y}
          hex={parqueInfo.hex}
          onClose={() => setParqueInfo(null)}
        />
      )}

      <SaveIsochroneDialog
        open={!!saveIsoDialogId}
        onClose={() => setSaveIsoDialogId(null)}
        isochrone={isochrones.find((i) => i.id === saveIsoDialogId) ?? null}
        folders={isoFolders}
        onSave={handleSaveIsochronePayload}
        onCreateFolder={(name, parentId) => createIsoFolder(name, parentId)}
      />

      <IsochroneReportDialog
        open={!!reportIsoDialogId}
        onClose={() => setReportIsoDialogId(null)}
        isochrone={isochrones.find((i) => i.id === reportIsoDialogId) ?? null}
        manzanas={manzanaData ?? densityData ?? null}
        gse={gseData ?? null}
      />

      <PoiManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        pois={pois}
        folders={folders}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onMoveFolder={moveFolder}
        onUpdatePoi={updatePoi}
        onDeletePois={removePois}
        onMovePois={movePois}
      />

      {savePending && (
        <SavePoisDialog
          open={!!savePending}
          onOpenChange={(v) => { if (!v) setSavePending(null); }}
          defaultName={savePending.defaultName}
          pointCount={savePending.items.length}
          folders={folders}
          onCreateFolder={createFolder}
          onRefreshFolders={refreshFolders}
          onConfirm={confirmSavePois}
        />
      )}

      {communeRangeResults && (
        <CommuneSearchResultsDialog
          open={communeRangeOpen}
          onOpenChange={setCommuneRangeOpen}
          results={communeRangeResults.rows}
          min={communeRangeResults.min}
          max={communeRangeResults.max}
          onFlyToCommune={handleFlyToCommune}
          onHighlightCommune={setHighlightedCommuneName}
        />
      )}

      <CommuneCompareDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        communes={compareCommunes}
        onRemove={handleRemoveCommuneFromCompare}
        onFlyToCommune={handleFlyToCommune}
      />

      {poiEditor?.mode === "create" && (
        <PoiEditorDialog
          mode="create"
          open
          onOpenChange={(v) => { if (!v) setPoiEditor(null); }}
          folders={folders}
          allPois={pois}
          initialDraft={poiEditor.defaultDraft}
          onPickOnMap={handlePickOnMap}
          onSubmit={async (payload) => {
            await addOnePoi(payload);
          }}
        />
      )}
      {poiEditor?.mode === "edit" && (
        <PoiEditorDialog
          mode="edit"
          poi={poiEditor.poi}
          open
          onOpenChange={(v) => { if (!v) setPoiEditor(null); }}
          folders={folders}
          allPois={pois}
          initialDraft={poiEditor.defaultDraft}
          onPickOnMap={handlePickOnMap}
          onSubmit={async (id, patch) => {
            await updatePoi(id, patch);
          }}
        />
      )}

      {coordPicker && (
        <div className="pointer-events-none fixed left-1/2 top-[68px] z-[1200] -translate-x-1/2 rounded-full bg-primary/95 px-4 py-1.5 text-[12px] font-medium text-primary-foreground shadow-apple backdrop-blur-2xl">
          Haz click en el mapa para fijar la posición · ESC para cancelar
        </div>
      )}

      {/* Pick mode hint para asignar POI en una fila de import */}
      {poiPickContext && (
        <div className="pointer-events-auto fixed left-1/2 top-[68px] z-[1200] -translate-x-1/2 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-[12px] font-medium text-white shadow-apple backdrop-blur-2xl">
          Haz click sobre el POI correcto en el mapa
          <button
            onClick={() => setPoiPickContext(null)}
            className="ml-1 rounded-full bg-white/20 px-2 text-[10px]"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* POI sales import flow */}
      {importDialogFolderId && (
        <PoiImportDialog
          open
          hidden={!!poiPickContext || importViewing}
          onClose={() => setImportDialogFolderId(null)}
          folder={folders.find((f) => f.id === importDialogFolderId) ?? null}
          schema={poiFolderSchemas.find((s) => s.folder_id === importDialogFolderId) ?? null}
          folderPois={pois.filter((p) => p.folder_id === importDialogFolderId)}
          onPickPoiOnMap={(rowIndex) => {
            setPoiPickContext({ rowIndex });
            toast.info("Click en el mapa sobre el POI correcto");
          }}
          onViewOnMap={(t) => {
            setFlyTarget({ id: Date.now(), lat: t.lat, lng: t.lng, bbox: null });
            setImportViewing(true);
          }}
          externalManualSelection={externalManualSelection}
          onConsumeExternalSelection={() => setExternalManualSelection(null)}
          onCommitSuccess={() => {
            void refreshSchemas();
          }}
        />
      )}
      {importViewing && (
        <button
          onClick={() => setImportViewing(false)}
          className="fixed bottom-6 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground shadow-lg hover:opacity-90"
        >
          ← Volver al importador
        </button>
      )}

      {/* POI detail dialog */}
      {detailPoi && (
        <PoiDetailDialog
          open
          onClose={() => setDetailPoi(null)}
          poi={detailPoi}
          schema={
            poiFolderSchemas.find((s) => s.folder_id === detailPoi.folder_id) ?? null
          }
          onRename={async (id, name) => {
            await updatePoi(id, { name });
            setDetailPoi((curr) => (curr && curr.id === id ? { ...curr, name } : curr));
          }}
          onKpiOrderChange={async (folderId, order) => {
            const { error } = await supabase.rpc("set_poi_folder_kpi_order", {
              _folder_id: folderId,
              _order: order,
            });
            if (error) {
              toast.error("No se pudo guardar el orden: " + error.message);
              return;
            }
            await refreshSchemas();
          }}
          chainPois={detailPoi ? pois.filter((p) => p.folder_id === detailPoi.folder_id) : []}
          isAdmin={isAdmin}
          onRecomputeAnalysis={async () => {
            if (!detailPoi?.folder_id) return;
            try {
              const r = await performanceBatch.run(detailPoi.folder_id);
              toast.success(
                `Análisis recalculado · ${r.n_pois_processed} POIs · ` +
                  `Modelo A R²=${(r.model_a.r2 * 100).toFixed(0)}%` +
                  (r.model_b ? ` · Modelo B R²=${(r.model_b.r2 * 100).toFixed(0)}%` : ""),
              );
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
          recomputingAnalysis={performanceBatch.running}
        />
      )}

      {/* Folder schema config (admin) */}
      {schemaDialogFolderId && (
        <PoiFolderSchemaDialog
          open
          onClose={() => setSchemaDialogFolderId(null)}
          folder={folders.find((f) => f.id === schemaDialogFolderId) ?? null}
          schema={
            poiFolderSchemas.find((s) => s.folder_id === schemaDialogFolderId) ?? null
          }
          onSave={async (s) => {
            await upsertSchema(s);
          }}
        />
      )}

      {/* Analysis config (admin) */}
      {analysisConfigFolderId && (
        <AnalysisConfigDialog
          open
          onClose={() => setAnalysisConfigFolderId(null)}
          folder={folders.find((f) => f.id === analysisConfigFolderId) ?? null}
          allFolders={folders}
          allLayers={userLayers.map((l) => ({ id: l.id, name: l.name }))}
        />
      )}

      {/* Compute territorial features (admin) */}
      {computeFeaturesFolderId && (
        <ComputeFeaturesWrapper
          folderId={computeFeaturesFolderId}
          onClose={() => setComputeFeaturesFolderId(null)}
          allFolders={folders}
          allPois={pois}
          allUserLayers={userLayers}
        />
      )}

      {/* Panel de afluencia BestTime */}
      <FootTrafficPanel
        target={footTrafficTarget}
        onClose={() => setFootTrafficTarget(null)}
      />

    </div>
  );
};

/**
 * Wrapper que resuelve dependencias de ComputeFeaturesDialog (settings de
 * la carpeta + segregación de POIs/layers en internos/competencia/otros)
 * sin hacer 4 hooks adicionales en el componente principal.
 */
interface ComputeFeaturesWrapperProps {
  folderId: string;
  onClose: () => void;
  allFolders: PoiFolder[];
  allPois: SavedPoi[];
  allUserLayers: UserLayer[];
}

const ComputeFeaturesWrapper = ({
  folderId,
  onClose,
  allFolders,
  allPois,
  allUserLayers,
}: ComputeFeaturesWrapperProps) => {
  const { settings } = useAnalysisSettings(folderId);

  const folder = allFolders.find((f) => f.id === folderId) ?? null;
  const folderPois = allPois.filter((p) => p.folder_id === folderId);

  const externalCompetitorFolderIds = new Set(
    settings?.external_competition_folder_ids ?? [],
  );
  const externalCompetitorLayerIds = new Set(
    settings?.external_competition_layer_ids ?? [],
  );

  // Bug fix: allPois solo contiene los POIs de carpetas que el usuario expandió
  // en el sidebar (lazy load). Si las carpetas de competencia externa no fueron
  // expandidas, externalCompetitors sería [] aunque estén configuradas.
  // Solución: cargar activamente desde Supabase las carpetas marcadas.
  const [externalFromDb, setExternalFromDb] = useState<SavedPoi[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);

  useEffect(() => {
    const folderIds = settings?.external_competition_folder_ids ?? [];
    if (folderIds.length === 0) { setExternalFromDb([]); return; }

    setLoadingExternal(true);
    import("@/integrations/supabase/client")
      .then(({ supabase }) =>
        supabase
          .from("pois")
          .select("id, name, lat, lng, folder_id")
          .in("folder_id", folderIds)
          .is("deleted_at", null)
      )
      .then(({ data }) => {
        setExternalFromDb((data ?? []) as SavedPoi[]);
      })
      .catch((e) => console.warn("[ComputeFeaturesWrapper] external competitors fetch:", e))
      .finally(() => setLoadingExternal(false));
  }, [settings?.external_competition_folder_ids?.join(",")]);

  // Combinar: POIs en memoria (pueden estar ya cargados) + los recién traídos de BD
  const allExternalIds = new Set(externalFromDb.map((p) => p.id));
  const externalFromMemory = allPois.filter(
    (p) => p.folder_id && externalCompetitorFolderIds.has(p.folder_id) && !allExternalIds.has(p.id),
  );
  const externalCompetitors = [...externalFromDb, ...externalFromMemory];

  // POIs en otras carpetas distintas a esta y a las marcadas competencia
  const otherPois = allPois.filter(
    (p) =>
      p.folder_id !== folderId &&
      (!p.folder_id || !externalCompetitorFolderIds.has(p.folder_id)),
  );

  // De las user layers: separar features competencia vs complementarias.
  // UserLayer.data es un FeatureCollection. Extraemos puntos.
  const flattenLayer = (l: UserLayer) => {
    const out: Array<{ id: string; lng: number; lat: number; name: string; category?: string }> = [];
    const features = l.data?.features ?? [];
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Point") {
        const [lng, lat] = g.coordinates as [number, number];
        out.push({
          id: `${l.id}:${(f.properties as { id?: string })?.id ?? Math.random().toString(36).slice(2)}`,
          lng,
          lat,
          name: (f.properties as { name?: string })?.name ?? l.name,
          category: l.name,
        });
      }
    }
    return out;
  };

  const externalCompetitorLayerFeatures = allUserLayers
    .filter((l) => externalCompetitorLayerIds.has(l.id))
    .flatMap(flattenLayer);

  const complementaryLayerFeatures = allUserLayers
    .filter((l) => !externalCompetitorLayerIds.has(l.id))
    .flatMap(flattenLayer);

  return (
    <ComputeFeaturesDialog
      open
      onClose={onClose}
      folder={folder}
      pois={folderPois}
      externalCompetitors={externalCompetitors}
      otherPois={otherPois}
      externalCompetitorLayerFeatures={externalCompetitorLayerFeatures}
      complementaryLayerFeatures={complementaryLayerFeatures}
    />
  );
};

export default Index;

// (ProjectionWrapper eliminado — la proyección vive dentro de AnalysisPanel)

const ParqueHexInfoCard = ({
  x,
  y,
  hex,
  onClose,
}: {
  x: number;
  y: number;
  hex: ParqueHexProps;
  onClose: () => void;
}) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(x, vw - 260);
  const top = Math.min(y, vh - 280);
  const marcas = Array.isArray(hex.top_marcas) ? hex.top_marcas : [];
  return (
    <div
      className="fixed z-[9999] w-[240px] overflow-hidden rounded-lg border border-border/60 bg-surface/95 shadow-apple-lg backdrop-blur-xl"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div className="text-[13px] font-semibold text-foreground">
          {hex.count.toLocaleString("es-CL")} vehículos
        </div>
        <button
          onClick={onClose}
          className="rounded-full px-2 py-0.5 text-[14px] leading-none text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        Edad: {hex.edad_p25.toFixed(0)} / {hex.edad_med.toFixed(0)} / {hex.edad_p75.toFixed(0)} años
      </div>
      {marcas.length > 0 && (
        <div className="border-t border-border/40 px-3 py-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            Top marcas
          </div>
          <ol className="space-y-0.5 pl-4 text-[11px] text-foreground">
            {marcas.map((m) => (
              <li key={m.marca} className="list-decimal">
                <span className="font-medium">{m.marca}</span>{" "}
                <span className="text-muted-foreground">
                  ({m.count.toLocaleString("es-CL")})
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};
