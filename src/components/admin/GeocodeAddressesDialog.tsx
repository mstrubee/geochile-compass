import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MapPin, Upload, Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseCsvRows, toCsv } from "@/utils/csv";
import { geocodeBatch, normalizeAddressKey, type GeocodeResult } from "@/services/geocodeService";

type Phase = "upload" | "mapping" | "processing" | "done";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const BATCH_SIZE = 150;
const NONE = "__none__";

// Heurística de auto-detección de columnas por nombre de header.
const guessColumn = (headers: string[], patterns: RegExp[]): string | null => {
  for (const p of patterns) {
    const found = headers.find((h) => p.test(h));
    if (found) return found;
  }
  return null;
};

const downloadCsv = (filename: string, headers: string[], rows: Array<Record<string, unknown>>) => {
  const csv = toCsv(headers, rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const GeocodeAddressesDialog = ({ open, onOpenChange }: Props) => {
  const [phase, setPhase] = useState<Phase>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [colCalle, setColCalle] = useState("");
  const [colNumero, setColNumero] = useState(NONE);
  const [colComuna, setColComuna] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{
    totalRows: number;
    unique: number;
    found: number;
    notFound: number;
    fromCache: number;
  } | null>(null);
  const [outputRows, setOutputRows] = useState<Array<Record<string, unknown>>>([]);
  const [notFoundRows, setNotFoundRows] = useState<Array<Record<string, unknown>>>([]);
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setColCalle("");
    setColNumero(NONE);
    setColComuna("");
    setProgress({ done: 0, total: 0 });
    setSummary(null);
    setOutputRows([]);
    setNotFoundRows([]);
    cancelRef.current = false;
  };

  const close = () => {
    if (phase === "processing") cancelRef.current = true;
    reset();
    onOpenChange(false);
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const { headers: hs, rows: rs } = parseCsvRows(text);
      if (!hs.length || !rs.length) {
        toast.error("El CSV está vacío o no se pudo leer");
        return;
      }
      setFileName(file.name);
      setHeaders(hs);
      setRows(rs);
      const lower = hs.map((h) => h.toLowerCase());
      const idx = (h: string | null) => (h ? hs[lower.indexOf(h.toLowerCase())] : "");
      setColCalle(idx(guessColumn(lower, [/calle/, /direcci/, /street/, /address/])) || hs[0]);
      setColNumero(idx(guessColumn(lower, [/numeraci/, /n[uú]mero/, /\bnum\b/, /number/])) || NONE);
      setColComuna(idx(guessColumn(lower, [/comuna/, /ciudad/, /city/, /commune/])) || hs[hs.length - 1]);
      setPhase("mapping");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const uniqueAddresses = useMemo(() => {
    if (phase !== "mapping" && phase !== "processing") return [];
    const calleIdx = headers.indexOf(colCalle);
    const numeroIdx = colNumero === NONE ? -1 : headers.indexOf(colNumero);
    const comunaIdx = headers.indexOf(colComuna);
    const map = new Map<string, { key: string; calle: string; numero: string; comuna: string }>();
    for (const row of rows) {
      const calle = (row[calleIdx] ?? "").trim();
      const numero = numeroIdx >= 0 ? (row[numeroIdx] ?? "").trim() : "";
      const comuna = (row[comunaIdx] ?? "").trim();
      if (!calle || !comuna) continue;
      const key = normalizeAddressKey(calle, numero, comuna);
      if (!map.has(key)) map.set(key, { key, calle, numero, comuna });
    }
    return [...map.values()];
  }, [phase, headers, rows, colCalle, colNumero, colComuna]);

  const runGeocode = async () => {
    if (!colCalle || !colComuna) {
      toast.error("Selecciona al menos las columnas de calle y comuna");
      return;
    }
    cancelRef.current = false;
    setPhase("processing");
    const total = uniqueAddresses.length;
    setProgress({ done: 0, total });

    const resultMap = new Map<string, GeocodeResult>();
    let fromCache = 0;

    for (let i = 0; i < uniqueAddresses.length; i += BATCH_SIZE) {
      if (cancelRef.current) return;
      const chunk = uniqueAddresses.slice(i, i + BATCH_SIZE);
      try {
        const { results, from_cache } = await geocodeBatch(chunk);
        for (const r of results) resultMap.set(r.key, r);
        fromCache += from_cache;
      } catch (e) {
        toast.error(`Lote falló (dirección ${i + 1}–${i + chunk.length}): ${e instanceof Error ? e.message : String(e)}`);
        for (const a of chunk) {
          resultMap.set(a.key, { key: a.key, lat: null, lng: null, found: false, confidence: null, full_address: null, cached: false });
        }
      }
      setProgress({ done: Math.min(i + BATCH_SIZE, total), total });
    }

    // Reconstruir TODAS las filas originales (no solo las únicas) agregando lat/lng.
    const calleIdx = headers.indexOf(colCalle);
    const numeroIdx = colNumero === NONE ? -1 : headers.indexOf(colNumero);
    const comunaIdx = headers.indexOf(colComuna);
    const outRows: Array<Record<string, unknown>> = [];
    const notFound: Array<Record<string, unknown>> = [];
    let found = 0;

    for (const row of rows) {
      const calle = (row[calleIdx] ?? "").trim();
      const numero = numeroIdx >= 0 ? (row[numeroIdx] ?? "").trim() : "";
      const comuna = (row[comunaIdx] ?? "").trim();
      const key = calle && comuna ? normalizeAddressKey(calle, numero, comuna) : "";
      const r = resultMap.get(key);
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
      obj.lat = r?.lat ?? "";
      obj.lng = r?.lng ?? "";
      obj.geocode_found = r?.found ? "si" : "no";
      obj.geocode_confidence = r?.confidence ?? "";
      outRows.push(obj);
      if (r?.found) found++;
      else notFound.push(obj);
    }

    setOutputRows(outRows);
    setNotFoundRows(notFound);
    setSummary({
      totalRows: rows.length,
      unique: uniqueAddresses.length,
      found,
      notFound: notFound.length,
      fromCache,
    });
    setPhase("done");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? close() : onOpenChange(v))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Georreferenciar direcciones</DialogTitle>
              <DialogDescription>
                Convierte un CSV de direcciones de texto (calle, número, comuna) en un CSV con
                coordenadas lat/lng, listo para cargar como capa.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {phase === "upload" && (
          <div className="space-y-4">
            <label
              htmlFor="geocode-file-input"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/60 hover:bg-muted/50"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm font-medium">Haz clic para seleccionar un CSV</div>
              <div className="text-xs text-muted-foreground">
                Debe tener columnas de calle, número (opcional) y comuna
              </div>
              <input
                id="geocode-file-input"
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleFile(f);
                }}
              />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
            </DialogFooter>
          </div>
        )}

        {phase === "mapping" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Archivo</div>
              <div className="truncate font-medium">{fileName}</div>
              <div className="mt-1 text-xs text-muted-foreground">{rows.length.toLocaleString()} filas</div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Columna de calle / dirección</Label>
              <Select value={colCalle} onValueChange={setColCalle}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Columna de número (opcional si ya viene en la calle)</Label>
              <Select value={colNumero} onValueChange={setColNumero}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Ninguna —</SelectItem>
                  {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Columna de comuna</Label>
              <Select value={colComuna} onValueChange={setColComuna}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
              <strong>{uniqueAddresses.length.toLocaleString()}</strong> direcciones únicas de{" "}
              <strong>{rows.length.toLocaleString()}</strong> filas totales se enviarán a geocodificar.
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={runGeocode}>
                <MapPin className="h-4 w-4" /> Geocodificar
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "processing" && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-sm text-muted-foreground">
                Geocodificando {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…
              </div>
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="h-2" />
            <p className="text-center text-[11px] text-muted-foreground">
              Puede tardar varios minutos según la cantidad de direcciones. No cierres esta ventana.
            </p>
          </div>
        )}

        {phase === "done" && summary && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-base font-semibold">Geocodificación completada</div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-lg font-semibold">{summary.totalRows.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Filas totales</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-lg font-semibold">{summary.unique.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Direcciones únicas</div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{summary.found.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Encontradas</div>
              </div>
              <div className={`rounded-lg border p-3 ${summary.notFound > 0 ? "border-amber-500/30 bg-amber-500/10" : "border-border bg-muted/30"}`}>
                <div className={`text-lg font-semibold ${summary.notFound > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                  {summary.notFound.toLocaleString()}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sin coordenadas</div>
              </div>
            </div>

            {summary.fromCache > 0 && (
              <p className="text-center text-[11px] text-muted-foreground">
                {summary.fromCache.toLocaleString()} ya estaban en caché de geocodificaciones anteriores.
              </p>
            )}

            {summary.notFound > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-muted-foreground">
                  {summary.notFound.toLocaleString()} direcciones no se pudieron ubicar (dirección
                  incompleta, mal escrita, o la comuna no coincide). Descárgalas para revisarlas.
                </p>
              </div>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                className="w-full"
                onClick={() => downloadCsv(fileName.replace(/\.csv$/i, "") + "-geocodificado.csv", [...headers, "lat", "lng", "geocode_found", "geocode_confidence"], outputRows)}
              >
                <Download className="h-4 w-4" /> Descargar CSV con coordenadas ({summary.totalRows.toLocaleString()} filas)
              </Button>
              {summary.notFound > 0 && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => downloadCsv(fileName.replace(/\.csv$/i, "") + "-sin-encontrar.csv", [...headers, "lat", "lng", "geocode_found", "geocode_confidence"], notFoundRows)}
                >
                  <Download className="h-4 w-4" /> Descargar direcciones sin encontrar ({summary.notFound.toLocaleString()})
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={close}>Cerrar</Button>
            </DialogFooter>

            <p className="text-center text-[11px] text-muted-foreground">
              Usa <strong>Cargar capa</strong> con el CSV descargado para importarlo al mapa.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GeocodeAddressesDialog;
