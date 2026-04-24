import { useCallback, useState } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MapView } from "@/components/map/MapView";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { Legend } from "@/components/ui-overlays/Legend";
import { SearchBar } from "@/components/ui-overlays/SearchBar";
import { CoordsBar } from "@/components/ui-overlays/CoordsBar";
import { useManzanas } from "@/hooks/useManzanas";
import type { NSE } from "@/data/communes";
import type { TrafficLevel } from "@/utils/traffic";
import type { LayerState } from "@/types/layers";
import type { ManzanaVariable } from "@/types/manzanas";
import type { UserLayer } from "@/types/userLayers";

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
    </div>
  );
};

export default Index;
