import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, Upload, RefreshCw, FileText } from "lucide-react";
import {
  StorageFile, MANAGED_BUCKETS, ManagedBucket, listFiles, uploadFile,
  downloadFile, deleteFile, fmtSize,
} from "@/services/storageAdminService";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

export const StorageAdminSection = () => {
  const [bucket, setBucket] = useState<ManagedBucket>("territorial-sources");
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<StorageFile | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const refresh = async (b: string = bucket) => {
    setLoading(true);
    try {
      setFiles(await listFiles(b));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error listando archivos");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(bucket); /* eslint-disable-next-line */ }, [bucket]);

  const onUpload = async (file: File, path?: string) => {
    setBusy("upload");
    try {
      await uploadFile(bucket, path ?? file.name, file);
      toast.success(`Subido: ${path ?? file.name}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error subiendo");
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async (f: StorageFile) => {
    setBusy(f.name);
    try { await downloadFile(bucket, f.name); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Error descargando"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Archivos en Supabase Storage. Sube, descarga, reemplaza o elimina los archivos fuente
        (capas territoriales, geodata, logos). Solo administradores.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Bucket:</span>
        <div className="flex flex-wrap gap-1">
          {MANAGED_BUCKETS.map((b) => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                bucket === b ? "bg-primary text-primary-foreground" : "bg-surface-2/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Recargar
          </Button>
          <Button size="sm" onClick={() => uploadRef.current?.click()} disabled={busy === "upload"}>
            <Upload className="mr-1 h-3.5 w-3.5" /> {busy === "upload" ? "Subiendo…" : "Subir archivo"}
          </Button>
        </div>
      </div>

      <input
        ref={uploadRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
      />
      <input
        ref={replaceRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f && replaceTarget.current) onUpload(f, replaceTarget.current); replaceTarget.current = null; e.target.value = ""; }}
      />

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Cargando…</div>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No hay archivos en <span className="font-mono">{bucket}</span>. Usa "Subir archivo".
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.name} className="flex items-center gap-3 rounded-lg border border-border/50 bg-surface/60 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm text-foreground">{f.name}</div>
                <div className="text-[11px] text-muted-foreground">{fmtSize(f.size)} · {fmtDate(f.updated_at)}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => onDownload(f)} disabled={busy === f.name}>
                <Download className="mr-1 h-3.5 w-3.5" /> Descargar
              </Button>
              <Button variant="outline" size="sm" onClick={() => { replaceTarget.current = f.name; replaceRef.current?.click(); }}>
                <Upload className="mr-1 h-3.5 w-3.5" /> Reemplazar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setToDelete(f)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar archivo</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará "{toDelete?.name}" del bucket "{bucket}" permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!toDelete) return;
                try { await deleteFile(bucket, toDelete.name); toast.success("Eliminado"); refresh(); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Error"); }
                finally { setToDelete(null); }
              }}
            >Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StorageAdminSection;
