import MapaComunas from "@/components/MapaComunas";

const valoresDemo: Record<string, number> = {
  "13101": 80,
  "13102": 45,
  "5101": 60,
  "8101": 30,
  "9101": 15,
  "10101": 90,
};

const MapaComunasPage = () => {
  const handleComunaClick = (codComuna: string, nombre: string) => {
    console.log("Comuna seleccionada:", codComuna, nombre);
  };

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="px-6 py-3 border-b bg-background">
        <h1 className="text-lg font-semibold">Comunas de Chile</h1>
        <p className="text-xs text-muted-foreground">
          346 comunas — fuente: SUBDERE + IGM + INE 2018
        </p>
      </header>
      <div className="flex-1">
        <MapaComunas
          valoresPorComuna={valoresDemo}
          onComunaClick={handleComunaClick}
        />
      </div>
    </div>
  );
};

export default MapaComunasPage;
