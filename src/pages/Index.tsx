import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MapView } from "@/components/map/MapView";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { PoiManagerDialog } from "@/components/panels/PoiManagerDialog";
import { SavePoisDialog } from "@/components/panels/SavePoisDialog";
import { CommuneSearchResultsDialog } from "@/components/panels/CommuneSearchResultsDialog";
import { CommuneCompareDialog } from "@/components/panels/CommuneCompareDialog";
import { Legend } from "@/components/ui-overlays/Legend";
import { SearchBar, type SearchResult } from "@/components/ui-overlays/SearchBar";
import { CoordsBar } from "@/components/ui-overlays/CoordsBar";
import { useManzanas } from "@/hooks/useManzanas";
import { useGseManzanas } from "@/hooks/useGseManzanas";
import { useSavedPois } from "@/hooks/useSavedPois";
import { usePoiFolders } from "@/hooks/usePoiFolders";
import { useAuth } from "@/hooks/useAuth";
import { fetchIsochrone } from "@/services/isochroneService";
import { fetchOverpassPreset, fetchOverpassFreeText, bboxAreaDegSq } from "@/services/overpassService";
import { extractPointPois, countPoints, type PoiInsert } from "@/types/pois";
import { parseFile, getExtension } from "@/utils/fileParsers";
import type { NSE, Commune } from "@/data/communes";
import type { TrafficLevel } from "@/utils/traffic";
import type { LayerState } from "@/types/layers";
import type { ManzanaVariable } from "@/types/manzanas";
import type { GseVariable } from "@/types/gse";
import type { UserLayer } from "@/types/userLayers";
import type { IsoMode, Isochrone } from "@/types/isochrones";
import type { Microzone, MicrozoneSubmode } from "@/types/microzones";
import { MICRO_PALETTE } from "@/types/microzones";
import {
  polygonFromLatLngs,
  bufferAroundPoint,
  voronoiFromPois,
  computeMicrozoneStats,
} from "@/utils/microzones";
import { useNavigate } from "react-router-dom";

type Mode = "none" | "isochrone" | "microzone";

const Index = () => {
  const [mode, setMode] = useState<Mode>("none");
  const [basemap, setBasemap] = useState<"dark" | "light" | "satellite" | "hybrid">("hybrid");
  const [panelOpen, setPanelOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    communes: false,
    communesGeo: false,
    nse: false,
    traffic: false,
    density: false,
    manzanas: false,
  });
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
  // Capa GSE por manzana (Censo 2012)
  const [gseVariable, setGseVariable] = useState<GseVariable>("gse");
  const [gseViewport, setGseViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [userLayers, setUserLayers] = useState<UserLayer[]>([]);
  const [fitId, setFitId] = useState<string | null>(null);

  // Isócronas
  const [isoMode, setIsoMode] = useState<IsoMode>("driving-car");
  const [isoMinutes, setIsoMinutes] = useState<number[]>([5, 7, 10]);
  const [isochrones, setIsochrones] = useState<Isochrone[]>([]);
  const [fitIsoId, setFitIsoId] = useState<string | null>(null);
  const [isoLoading, setIsoLoading] = useState(false);

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

  const handleFlyToCommune = useCallback((c: Commune) => {
    setLayers((prev) => (prev.communes ? prev : { ...prev, communes: true }));
    setFlyTarget({ id: Date.now(), lat: c.lat, lng: c.lng, bbox: null });
    setPopupCommune(c.name);
    setOutlinedCommuneNames([c.name]);
    setHighlightedCommuneName(c.name);
  }, []);

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

  // Microzonas
  const [microSubmode, setMicroSubmode] = useState<MicrozoneSubmode>("polygon");
  const [microBufferRadius, setMicroBufferRadius] = useState<number>(500); // metros
  const [microzones, setMicrozones] = useState<Microzone[]>([]);
  const [microDraft, setMicroDraft] = useState<Array<{ lat: number; lng: number }>>([]);
  const [fitMicrozoneId, setFitMicrozoneId] = useState<string | null>(null);

  // POIs guardados
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    pois,
    trashedPois,
    addMany,
    update: updatePoi,
    moveMany: movePois,
    remove: removePoi,
    removeMany: removePois,
    restore: restorePois,
    purgePermanently: purgePois,
    clearAll: clearAllPois,
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
  } = usePoiFolders();
  const [savedPoisVisible, setSavedPoisVisible] = useState(true);
  // Por defecto TODAS las carpetas (y los POIs huérfanos) arrancan ocultas:
  // el usuario decide qué activar. Marcamos también las carpetas nuevas que
  // aparezcan después como ocultas, sin tocar las que el usuario ya cambió.
  const [hiddenPoiFolders, setHiddenPoiFolders] = useState<Set<string>>(
    () => new Set(["__orphan__"]),
  );
  const seenFolderIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const seen = seenFolderIdsRef.current;
    const newOnes: string[] = [];
    for (const f of folders) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        newOnes.push(f.id);
      }
    }
    if (newOnes.length === 0) return;
    setHiddenPoiFolders((prev) => {
      const next = new Set(prev);
      for (const id of newOnes) next.add(id);
      return next;
    });
  }, [folders]);

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
        toast.success("Isócrona añadida", { id: tId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(`No se pudo calcular: ${msg}`, { id: tId });
      } finally {
        setIsoLoading(false);
      }
    },
    [mode, isoMode, isoMinutes, isochrones.length],
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

  const { data: gseData, error: gseError } = useGseManzanas({
    enabled: layers.nse,
    bbox: gseViewport?.bbox ?? null,
    zoom: gseViewport?.zoom ?? 12,
    variable: gseVariable,
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
          onIsoModeChange={setIsoMode}
          isoMinutes={isoMinutes}
          onIsoMinutesChange={setIsoMinutes}
          isochrones={isochrones}
          onToggleIsochrone={toggleIsochrone}
          onRemoveIsochrone={removeIsochrone}
          onClearIsochrones={clearIsochrones}
          onFocusIsochrone={setFitIsoId}
          isoLoading={isoLoading}
          onToggleIsoMode={() => setMode((m) => (m === "isochrone" ? "none" : "isochrone"))}
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
          onMoveFolder={moveFolder}
          onMovePois={movePois}
          onImportFilesIntoFolder={importFilesIntoFolder}
          onCreateFolder={(name, parentId) => createFolder(name, parentId, null)}
          onDeleteFolder={deleteFolder}
          hiddenPoiFolders={hiddenPoiFolders}
          onHiddenPoiFoldersChange={setHiddenPoiFolders}
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
        />

        <div
          className={[
            "relative flex-1 overflow-hidden",
            mode === "isochrone" && "[&_.leaflet-container]:cursor-crosshair",
            mode === "microzone" && "[&_.leaflet-container]:cursor-cell",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <MapView
            basemap={basemap}
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
            gseVariable={gseVariable}
            onGseViewportChange={handleGseViewportChange}
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
          />

          <SearchBar
            onSelect={(r: SearchResult) =>
              setFlyTarget({ id: Date.now(), lat: r.lat, lng: r.lng, bbox: r.bbox })
            }
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
          />
          <CoordsBar coords={coords} />

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

          <button
            onClick={() => setPanelOpen(true)}
            aria-label="Abrir panel de análisis"
            className="absolute bottom-14 right-4 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-apple-lg transition-transform hover:scale-105 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M13 6l6 6-6 6"/></svg>
          </button>

          <AnalysisPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
        </div>
      </main>

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
    </div>
  );
};

export default Index;
