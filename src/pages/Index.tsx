import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MapView } from "@/components/map/MapView";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { PoiManagerDialog } from "@/components/panels/PoiManagerDialog";
import { SavePoisDialog } from "@/components/panels/SavePoisDialog";
import { Legend } from "@/components/ui-overlays/Legend";
import { SearchBar } from "@/components/ui-overlays/SearchBar";
import { CoordsBar } from "@/components/ui-overlays/CoordsBar";
import { useManzanas } from "@/hooks/useManzanas";
import { useSavedPois } from "@/hooks/useSavedPois";
import { usePoiFolders } from "@/hooks/usePoiFolders";
import { useAuth } from "@/hooks/useAuth";
import { fetchIsochrone } from "@/services/isochroneService";
import { extractPointPois, countPoints, type PoiInsert } from "@/types/pois";
import type { NSE } from "@/data/communes";
import type { TrafficLevel } from "@/utils/traffic";
import type { LayerState } from "@/types/layers";
import type { ManzanaVariable } from "@/types/manzanas";
import type { UserLayer } from "@/types/userLayers";
import type { IsoMode, Isochrone } from "@/types/isochrones";
import { useNavigate } from "react-router-dom";

type Mode = "none" | "isochrone" | "microzone";

const Index = () => {
  const [mode, setMode] = useState<Mode>("none");
  const [basemap, setBasemap] = useState<"dark" | "light" | "satellite">("dark");
  const [panelOpen, setPanelOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    communes: true,
    nse: false,
    traffic: false,
    density: false,
    manzanas: false,
  });
  const [nseFilter, setNseFilter] = useState<NSE | null>(null);
  const [trafficFilter, setTrafficFilter] = useState<TrafficLevel | null>(null);
  const [manzanaVariable, setManzanaVariable] = useState<ManzanaVariable>("density");
  const [viewport, setViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [userLayers, setUserLayers] = useState<UserLayer[]>([]);
  const [fitId, setFitId] = useState<string | null>(null);

  // Isócronas
  const [isoMode, setIsoMode] = useState<IsoMode>("foot-walking");
  const [isoMinutes, setIsoMinutes] = useState<number[]>([5, 10, 15]);
  const [isochrones, setIsochrones] = useState<Isochrone[]>([]);
  const [fitIsoId, setFitIsoId] = useState<string | null>(null);
  const [isoLoading, setIsoLoading] = useState(false);

  // POIs guardados
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    pois,
    addMany,
    update: updatePoi,
    moveMany: movePois,
    remove: removePoi,
    removeMany: removePois,
    clearAll: clearAllPois,
  } = useSavedPois();
  const { folders, create: createFolder, rename: renameFolder, remove: deleteFolder } = usePoiFolders();
  const [savedPoisVisible, setSavedPoisVisible] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [savePending, setSavePending] = useState<{ items: PoiInsert[]; defaultName: string } | null>(null);

  const savePoisFromLayer = useCallback(
    (layerId: string) => {
      if (!user) {
        toast.error("Inicia sesión para guardar POIs");
        navigate("/auth");
        return;
      }
      const layer = userLayers.find((l) => l.id === layerId);
      if (!layer) return;
      const items = extractPointPois(layer.data, layer.name, { color: layer.color });
      if (!items.length) {
        toast.error("Esta capa no contiene puntos");
        return;
      }
      setSavePending({ items, defaultName: layer.name });
    },
    [user, userLayers, navigate],
  );

  const confirmSavePois = useCallback(
    async (
      folderId: string | null,
      opts: { newFolderName?: string; parentId?: string | null },
    ) => {
      if (!savePending) return;
      try {
        let targetFolderId = folderId;
        if (opts.newFolderName) {
          const created = await createFolder(opts.newFolderName, opts.parentId ?? null);
          targetFolderId = created.id;
        }
        const n = await addMany(savePending.items, targetFolderId);
        toast.success(`${n} POIs guardados`);
        setSavePending(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(`No se pudieron guardar: ${msg}`);
      }
    },
    [savePending, addMany, createFolder],
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
          savedPoisVisible={savedPoisVisible}
          onToggleSavedPoisVisible={() => setSavedPoisVisible((v) => !v)}
          onRemoveSavedPoi={removePoi}
          onClearSavedPois={clearAllPois}
          onOpenPoiManager={() => setManagerOpen(true)}
          poiFolderCount={folders.length}
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
            userLayers={userLayers}
            fitUserLayerId={fitId}
            onFitUserLayerDone={handleFitDone}
            isochrones={isochrones}
            fitIsochroneId={fitIsoId}
            onFitIsochroneDone={handleFitIsoDone}
            isoMode={mode === "isochrone"}
            onMapClick={handleMapClick}
            savedPois={pois}
            savedPoisVisible={savedPoisVisible}
          />

          <SearchBar />
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
                : "Clic para añadir vértice · Doble clic para cerrar · ESC para cancelar"}
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
          onConfirm={confirmSavePois}
        />
      )}
    </div>
  );
};

export default Index;
