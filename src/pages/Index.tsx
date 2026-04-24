import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { MapView } from "@/components/map/MapView";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { Legend } from "@/components/ui-overlays/Legend";
import { SearchBar } from "@/components/ui-overlays/SearchBar";
import { CoordsBar } from "@/components/ui-overlays/CoordsBar";

type Mode = "none" | "isochrone" | "microzone";

const Index = () => {
  const [mode, setMode] = useState<Mode>("none");
  const [basemap, setBasemap] = useState<"dark" | "light" | "satellite">("dark");
  const [panelOpen, setPanelOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Header
        mode={mode}
        onToggleIsochrone={() => setMode((m) => (m === "isochrone" ? "none" : "isochrone"))}
        onToggleMicrozone={() => setMode((m) => (m === "microzone" ? "none" : "microzone"))}
      />

      <main className="flex flex-1 overflow-hidden">
        <Sidebar basemap={basemap} onBasemapChange={setBasemap} mode={mode} />

        <div
          className={[
            "relative flex-1 overflow-hidden",
            mode === "isochrone" && "[&_.leaflet-container]:cursor-crosshair",
            mode === "microzone" && "[&_.leaflet-container]:cursor-cell",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <MapView basemap={basemap} onMouseMove={setCoords} />

          <SearchBar />
          <Legend shifted={panelOpen} />
          <CoordsBar coords={coords} />

          {/* Mode hint */}
          {mode !== "none" && (
            <div
              className={[
                "pointer-events-none absolute left-1/2 top-[60px] z-[700] -translate-x-1/2 rounded-full px-4 py-1.5 font-mono text-[11px] backdrop-blur",
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

          {/* Demo: open panel button (since analysis isn't wired yet) */}
          <button
            onClick={() => setPanelOpen(true)}
            className="absolute bottom-12 right-4 z-[500] rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            Vista previa del panel ▸
          </button>

          <AnalysisPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
        </div>
      </main>
    </div>
  );
};

export default Index;
