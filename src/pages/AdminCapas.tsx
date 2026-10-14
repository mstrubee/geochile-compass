import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Upload, ArrowLeft, Trash2, ExternalLink, FileUp, Layers as LayersIcon, ChevronDown, Users as UsersIcon, Map as MapIcon, KeyRound, MapPin, TrendingUp, Store, Car } from "lucide-react";
import { GeminiKeysAdminSection } from "@/components/admin/GeminiKeysAdminSection";
import { SecretsAdminSection } from "@/components/admin/SecretsAdminSection";
import { StorageAdminSection } from "@/components/admin/StorageAdminSection";
import { MaturationCurveAdminSection } from "@/components/admin/MaturationCurveAdminSection";
import { ExpressAdjustAdminSection } from "@/components/admin/ExpressAdjustAdminSection";
import { DriveSpeedsAdminSection } from "@/components/admin/DriveSpeedsAdminSection";
import { IMPORT_ACCEPT, importFormatOf } from "@/utils/importParser";
import { UsersAdminSection } from "@/components/admin/UsersAdminSection";
import { Button } from "@/components/ui/button";
import { GeocodeAddressesDialog } from "@/components/admin/GeocodeAddressesDialog";
import { ConfirmDeleteDialog } from "@/components/admin/ConfirmDeleteDialog";
import { ImportWizard } from "@/components/layerImport/ImportWizard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { LAYER_TREE_QUERY_KEY, useLayerTreeData } from "@/hooks/useLayerTree";
import { TERRITORIAL_LAYERS_QUERY_KEY } from "@/hooks/useTerritorialLayers";
import type { TerritorialSourceFile } from "@/types/territorial";
import { injectParqueFeatures } from "@/scripts/inject-parque-features";

const AdminCapas = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  // Los nodos del árbol sirven para elegir el destino dentro del asistente.
  const { data: tree } = useLayerTreeData();
  const [files, setFiles] = useState<TerritorialSourceFile[]>([]);
  const [importing, setImporting] = useState<{ file: File; nonce: number } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [geocodeOpen, setGeocodeOpen] = useState(false);
  const [geocodeTarget, setGeocodeTarget] = useState<TerritorialSourceFile | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<TerritorialSourceFile | null>(null);

  const refreshFiles = useCallback(async () => {
    const { data } = await supabase
      .from("territorial_source_files")
      .select("*")
      .order("uploaded_at", { ascending: false })
      .limit(20);
    setFiles((data ?? []) as unknown as TerritorialSourceFile[]);
  }, []);

  useEffect(() => {
    if (isAdmin) void refreshFiles();
  }, [isAdmin, refreshFiles]);

  if (authLoading || roleLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!user) {
    navigate("/auth");
    return null;
  }
  if (!isAdmin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Acceso denegado</h1>
        <p className="text-sm text-muted-foreground">
          Tu usuario no tiene rol <code>admin</code>.
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>Volver</Button>
      </div>
    );
  }

  const performDeleteFile = async (f: TerritorialSourceFile) => {
    if (f.storage_path) {
      await supabase.storage.from("territorial-sources").remove([f.storage_path]);
    }
    const { error } = await supabase
      .from("territorial_source_files")
      .delete()
      .eq("id", f.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Archivo eliminado");
    void refreshFiles();
  };

  return (
    <div className="h-screen overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          <h1 className="flex-1 text-base font-semibold">Admin</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <AdminCollapsible
          id="users"
          title="Usuarios y permisos"
          icon={<UsersIcon className="h-4 w-4" />}
          description="Roles personalizados y asignación de permisos por sección."
        >
          <UsersAdminSection />
        </AdminCollapsible>

        <AdminCollapsible
          id="capas"
          title="Capas territoriales"
          icon={<MapIcon className="h-4 w-4" />}
          description="Carga archivos al árbol de capas y revisa el historial de archivos."
        >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInput}
            type="file"
            accept={IMPORT_ACCEPT}
            aria-label="Archivo a importar"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (!importFormatOf(f.name)) {
                toast.error("Formato no soportado", { description: "Usa un archivo KMZ, KML, GeoJSON, CSV o HTML." });
                return;
              }
              setImporting({ file: f, nonce: Date.now() });
            }}
          />
          <Button onClick={() => importInput.current?.click()}>
            <Upload className="h-4 w-4" /> Cargar capa
          </Button>
          <Button variant="outline" onClick={() => setGeocodeOpen(true)}>
            <MapPin className="h-4 w-4" /> Georreferenciar direcciones
          </Button>
        </div>

        <div className="space-y-2.5 rounded-lg border border-border/40 bg-muted/30 p-3.5 text-xs">
          <div className="flex gap-2.5">
            <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">Cargar capa</strong> — abre el asistente de importación: lee el
              archivo en tu equipo, muestra sus carpetas y capas en un mapa de vista previa y deja elegir si crear
              capas nuevas, reemplazar una existente o agregarle puntos. Acepta{" "}
              <span className="font-mono">.kmz</span> · <span className="font-mono">.kml</span> ·{" "}
              <span className="font-mono">.geojson</span> · <span className="font-mono">.csv</span> ·{" "}
              <span className="font-mono">.html</span>. También puedes arrastrar el archivo al panel de capas del mapa.
            </p>
          </div>

          <div className="flex gap-2.5">
            <LayersIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">Ordenar, renombrar, mover o eliminar</strong> carpetas y capas se
              hace en el panel <strong className="text-foreground">Capas</strong> del mapa (arrastrando, con clic
              derecho o con la papelera, que guarda lo eliminado 30 días).{" "}
              <button type="button" className="text-primary underline" onClick={() => navigate("/")}>
                Ir al mapa
              </button>
            </p>
          </div>

          <div className="flex gap-2.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">Georreferenciar direcciones</strong> — si tu CSV
              tiene direcciones de texto (calle, número, comuna) mas no coordenadas, esta herramienta
              las convierte a <span className="font-mono">lat</span>/<span className="font-mono">lng</span>{" "}
              y descarga un CSV listo para <strong className="text-foreground">Cargar capa</strong>.
            </p>
          </div>

          <div className="border-t border-border/40 pt-2.5 text-[11px] text-muted-foreground">
            <strong className="text-foreground">CSV:</strong> requiere columnas de coordenadas{" "}
            <span className="font-mono">lat</span> y <span className="font-mono">lng</span> (también
            sirven <span className="font-mono">latitud</span>/<span className="font-mono">longitud</span>,{" "}
            <span className="font-mono">x</span>/<span className="font-mono">y</span>). Si incluyes una
            columna <span className="font-mono">category</span>, <span className="font-mono">folder</span>,{" "}
            <span className="font-mono">group</span> o <span className="font-mono">layer</span>, cada
            valor distinto se convierte en una capa separada. El resto de las columnas se guardan como
            datos del punto. Una columna <span className="font-mono">id</span> o{" "}
            <span className="font-mono">external_id</span> permite actualizar la capa sin duplicar puntos.
          </div>
        </div>

        <GeocodeAddressesDialog
          open={geocodeOpen || !!geocodeTarget}
          onOpenChange={(v) => {
            if (!v) { setGeocodeOpen(false); setGeocodeTarget(null); }
            else setGeocodeOpen(true);
          }}
          presetFile={geocodeTarget}
          onSaved={() => void refreshFiles()}
        />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Historial de archivos
          </h2>
          <p className="text-xs text-muted-foreground">
            Archivos guardados al georreferenciar. Los archivos que se cargan con el asistente ya no se guardan
            aquí: se leen en tu equipo y la importación queda registrada en la base (con opción de deshacer).
          </p>
          <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
            {files.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">Sin archivos.</li>
            )}
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{f.original_filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(f.uploaded_at).toLocaleString()} · {f.status}
                    {f.error && <span className="text-destructive"> · {f.error}</span>}
                  </div>
                </div>
                {f.gdrive_file_id && (
                  <a
                    href={`https://drive.google.com/file/d/${f.gdrive_file_id}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="inline h-3 w-3" /> Drive
                  </a>
                )}
                {f.file_type === "csv" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Georreferenciar direcciones de este CSV"
                    onClick={() => setGeocodeTarget(f)}
                  >
                    <MapPin className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  title="Eliminar del historial"
                  onClick={() => setDeleteFileTarget(f)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
        </AdminCollapsible>

        <AdminCollapsible
          id="parque"
          title="Parque automotor"
          icon={<MapIcon className="h-4 w-4" />}
          description="Inyectar features de parque automotor al cache de POIs (one-shot)."
        >
          <ParqueInjectButton />
        </AdminCollapsible>

        <AdminCollapsible
          id="definiciones-comerciales"
          title="Definiciones Comerciales"
          icon={<TrendingUp className="h-4 w-4" />}
          description="Parámetros de negocio que alimentan la proyección de venta y no se derivan de los datos."
        >
          <AdminCollapsible
            id="maturation-curve"
            title="Curva de maduración"
            icon={<TrendingUp className="h-4 w-4" />}
            description="Cuánto rinde un local nuevo en cada año hasta alcanzar su régimen. Define desde qué nivel parte la proyección de venta."
          >
            <MaturationCurveAdminSection />
          </AdminCollapsible>

          <AdminCollapsible
            id="express-adjust"
            title="Ajuste de local Express"
            icon={<Store className="h-4 w-4" />}
            description="Porcentaje que aplica el botón Express sobre la proyección. Por defecto -20%."
          >
            <ExpressAdjustAdminSection />
          </AdminCollapsible>

          <AdminCollapsible
            id="drive-speeds"
            title="Velocidades de desplazamiento"
            icon={<Car className="h-4 w-4" />}
            description="Ritmo supuesto en ciudad y en autopista para el tiempo en auto hasta los locales de la red."
          >
            <DriveSpeedsAdminSection />
          </AdminCollapsible>
        </AdminCollapsible>

        <AdminCollapsible
          id="gemini-keys"
          title="Gemini API Keys"
          icon={<KeyRound className="h-4 w-4" />}
          description="Administra las API Keys de Gemini con fallback automático y enlaces para obtener nuevas."
        >
          <GeminiKeysAdminSection />
        </AdminCollapsible>

        <AdminCollapsible
          id="secrets"
          title="API Keys y Secrets"
          icon={<KeyRound className="h-4 w-4" />}
          description="Claves de servicios externos (OpenRouteService, GitHub, Google Drive) que usan las funciones del sistema. Pega aquí los valores."
        >
          <SecretsAdminSection />
        </AdminCollapsible>

        <AdminCollapsible
          id="storage"
          title="Archivos (Storage)"
          icon={<FileUp className="h-4 w-4" />}
          description="Sube, descarga, reemplaza o elimina archivos fuente (capas territoriales, geodata, logos) en Supabase Storage."
        >
          <StorageAdminSection />
        </AdminCollapsible>
      </main>

      <ConfirmDeleteDialog
        open={!!deleteFileTarget}
        onOpenChange={(v) => !v && setDeleteFileTarget(null)}
        title="¿Eliminar el archivo?"
        description="Se borrará también el archivo del almacenamiento. Esta acción no se puede deshacer."
        resourceName={deleteFileTarget?.original_filename}
        onConfirm={async () => {
          if (deleteFileTarget) await performDeleteFile(deleteFileTarget);
        }}
      />

      {importing && (
        <ImportWizard
          key={importing.nonce}
          file={importing.file}
          nodes={tree?.nodes ?? []}
          onClose={() => setImporting(null)}
          onImported={() => {
            void queryClient.invalidateQueries({ queryKey: LAYER_TREE_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: TERRITORIAL_LAYERS_QUERY_KEY });
          }}
        />
      )}
    </div>
  );
};

const ADMIN_COLLAPSED_KEY = "admin_sections_open_v1";
const readAdminMap = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_COLLAPSED_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

const AdminCollapsible = ({
  id,
  title,
  description,
  icon,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) => {
  // Default cerrado, según pedido del usuario
  const [open, setOpen] = useState<boolean>(() => {
    const m = readAdminMap();
    return m[id] === true;
  });
  useEffect(() => {
    const m = readAdminMap();
    m[id] = open;
    localStorage.setItem(ADMIN_COLLAPSED_KEY, JSON.stringify(m));
  }, [id, open]);
  return (
    <section className="rounded-xl border border-border/60 bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        aria-expanded={open}
      >
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {description && (
            <div className="text-xs text-muted-foreground">{description}</div>
          )}
        </div>
        <ChevronDown
          className={["h-4 w-4 text-muted-foreground transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto overscroll-contain border-t border-border/40 p-4">{children}</div>
      )}
    </section>
  );
};

const ParqueInjectButton = () => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ updated: number; notFound: number; errors: number; total: number } | null>(null);
  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await injectParqueFeatures();
      setResult(r);
      toast.success(`Inyección OK: ${r.updated}/${r.total} actualizados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={running}>
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Inyectar features de parque
      </Button>
      {result && (
        <pre className="rounded-md bg-muted/40 p-2 text-xs">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">
        Verificar con: <code>SELECT count(*) FROM poi_features_cache WHERE features ? 'parque_n_vehiculos';</code> (~68 esperados)
      </p>
    </div>
  );
};

export default AdminCapas;

