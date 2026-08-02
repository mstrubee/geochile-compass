import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseCsvRows, toCsv } from "@/utils/csv";
import { checkCacheStatus, geocodeBatch, normalizeAddressKey, type GeocodeResult } from "@/services/geocodeService";
import { supabase } from "@/integrations/supabase/client";
import type { TerritorialSourceFile } from "@/types/territorial";

type Phase = "upload" | "loading-preset" | "mapping" | "processing" | "done";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Si se pasa, el diálogo carga este archivo del Historial en vez de pedir uno local. */
  presetFile?: TerritorialSourceFile | null;
  /** Se llama tras subir un archivo local al Historial, para refrescar la lista. */
  onSaved?: () => void;
}

// Nominatim (OpenStreetMap) limita a 1 solicitud/seg y prohíbe concurrencia.
// El edge function normaliza cada dirección (../../../supabase/functions/
// _shared/address-normalizer) y prueba, en orden, hasta 8 candidatos
// estructurados (original, normalizada, variantes, sinónimos, sin tildes,
// sin número) + 1 búsqueda libre. Si todo eso falla, como último recurso
// consulta ../../../supabase/functions/_shared/address-resolver (alias +
// fuzzy matching contra el callejero real de la comuna vía Overpass) antes
// de darla por no encontrada. BATCH_SIZE debe coincidir con MAX_BATCH del
// edge function (supabase/functions/geocode-addresses/index.ts) o la
// llamada falla con 400.
const BATCH_SIZE = 3;
const NONE = "__none__";
const SECONDS_PER_ADDRESS = 10; // estimado conservador (peor caso: ~10 intentos + Overpass en comunas nuevas); varía según carga de Nominatim/Overpass

const estimateDuration = (n: number): string => {
  if (n <= 0) return "0 min";
  const totalSeconds = n * SECONDS_PER_ADDRESS;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);
  return hours === 0 ? `~${minutes} min` : `~${hours} h ${minutes} min`;
};

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

export const GeocodeAddressesDialog = ({ open, onOpenChange, presetFile, onSaved }: Props) => {
  const [phase, setPhase] = useState<Phase>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [colCalle, setColCalle] = useState("");
  const [colNumero, setColNumero] = useState(NONE);
  const [colComuna, setColComuna] = useState("");
  const [retryNotFound, setRetryNotFound] = useState(false);
  const [checkingCache, setCheckingCache] = useState(false);
  const [cachePreview, setCachePreview] = useState<{ cachedFound: number; cachedNotFound: number; toGeocode: number } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [liveStats, setLiveStats] = useState({ found: 0, notFound: 0, newlyFound: 0, newlyNotFound: 0 });
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
    setRetryNotFound(false);
    setCachePreview(null);
    setProgress({ done: 0, total: 0 });
    setLiveStats({ found: 0, notFound: 0, newlyFound: 0, newlyNotFound: 0 });
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

  const applyParsedCsv = (name: string, hs: string[], rs: string[][]) => {
    if (!hs.length || !rs.length) {
      toast.error("El CSV está vacío o no se pudo leer");
      return;
    }
    setFileName(name);
    setHeaders(hs);
    setRows(rs);
    const lower = hs.map((h) => h.toLowerCase());
    const idx = (h: string | null) => (h ? hs[lower.indexOf(h.toLowerCase())] : "");
    setColCalle(idx(guessColumn(lower, [/calle/, /direcci/, /street/, /address/])) || hs[0]);
    setColNumero(idx(guessColumn(lower, [/numeraci/, /n[uú]mero/, /\bnum\b/, /number/])) || NONE);
    setColComuna(idx(guessColumn(lower, [/comuna/, /ciudad/, /city/, /commune/])) || hs[hs.length - 1]);
    setPhase("mapping");
  };

  /** Sube el archivo local al Historial (territorial-sources) en segundo plano, sin bloquear la UI. */
  const saveToHistory = async (file: File) => {
    try {
      const path = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage.from("territorial-sources").upload(path, file, {
        contentType: "text/csv",
        upsert: false,
      });
      if (up.error) throw up.error;
      const { error: insErr } = await supabase.from("territorial_source_files").insert({
        original_filename: file.name,
        size_bytes: file.size,
        storage_path: path,
        status: "pending",
        file_type: "csv",
      } as never);
      if (insErr) throw insErr;
      toast.success("Guardado en Historial de archivos");
      onSaved?.();
    } catch (e) {
      toast.error(`No se pudo guardar en el Historial: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const { headers: hs, rows: rs } = parseCsvRows(text);
      applyParsedCsv(file.name, hs, rs);
      void saveToHistory(file);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Si se abrió desde el Historial (icono en una fila), descargar y parsear
  // ese archivo directamente — no hace falta volver a subirlo. useLayoutEffect
  // (no useEffect) para evitar que se vea un parpadeo de la pantalla "subir
  // archivo" antes de pasar a "cargando".
  useLayoutEffect(() => {
    if (!open || !presetFile) return;
    setPhase("loading-preset");
    (async () => {
      try {
        const dl = await supabase.storage.from("territorial-sources").download(presetFile.storage_path);
        if (dl.error || !dl.data) throw dl.error ?? new Error("No se pudo descargar el archivo");
        const text = await dl.data.text();
        const { headers: hs, rows: rs } = parseCsvRows(text);
        applyParsedCsv(presetFile.original_filename, hs, rs);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        onOpenChange(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetFile]);

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

  // Vista previa: cuántas de estas direcciones ya están geocodificadas de
  // una corrida anterior (clave para corridas periódicas, donde la mayoría
  // de las direcciones se repiten mes a mes) vs. cuántas son nuevas.
  useEffect(() => {
    if (phase !== "mapping" || uniqueAddresses.length === 0) {
      setCachePreview(null);
      return;
    }
    let cancelled = false;
    setCheckingCache(true);
    checkCacheStatus(uniqueAddresses.map((a) => a.key))
      .then(({ cachedKeys, cachedFoundKeys }) => {
        if (cancelled) return;
        const cachedFound = cachedFoundKeys.size;
        const cachedNotFound = cachedKeys.size - cachedFoundKeys.size;
        const toGeocode = uniqueAddresses.length - cachedKeys.size + (retryNotFound ? cachedNotFound : 0);
        setCachePreview({ cachedFound, cachedNotFound, toGeocode });
      })
      .catch(() => { if (!cancelled) setCachePreview(null); })
      .finally(() => { if (!cancelled) setCheckingCache(false); });
    return () => { cancelled = true; };
  }, [phase, uniqueAddresses, retryNotFound]);

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
    const stats = { found: 0, notFound: 0, newlyFound: 0, newlyNotFound: 0 };

    for (let i = 0; i < uniqueAddresses.length; i += BATCH_SIZE) {
      if (cancelRef.current) return;
      const chunk = uniqueAddresses.slice(i, i + BATCH_SIZE);
      try {
        const { results, from_cache } = await geocodeBatch(chunk, retryNotFound);
        for (const r of results) {
          resultMap.set(r.key, r);
          if (r.found) { stats.found++; if (!r.cached) stats.newlyFound++; }
          else { stats.notFound++; if (!r.cached) stats.newlyNotFound++; }
        }
        fromCache += from_cache;
      } catch (e) {
        toast.error(`Lote falló (dirección ${i + 1}–${i + chunk.length}): ${e instanceof Error ? e.message : String(e)}`);
        for (const a of chunk) {
          resultMap.set(a.key, { key: a.key, lat: null, lng: null, found: false, confidence: null, full_address: null, cached: false });
          stats.notFound++;
          stats.newlyNotFound++;
        }
      }
      setProgress({ done: Math.min(i + BATCH_SIZE, total), total });
      setLiveStats({ ...stats });
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

        {phase === "loading-preset" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">Cargando archivo del Historial…</div>
          </div>
        )}

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
            <p className="text-center text-[11px] text-muted-foreground">
              Se guarda automáticamente en el Historial de archivos, así puedes volver a
              geocodificarlo (o reintentar lo que faltó) sin subirlo de nuevo.
            </p>
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

            <div className="space-y-1.5 rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
              <div>
                <strong>{uniqueAddresses.length.toLocaleString()}</strong> direcciones únicas de{" "}
                <strong>{rows.length.toLocaleString()}</strong> filas totales.
              </div>

              {checkingCache && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Revisando cuáles ya están geocodificadas…
                </div>
              )}

              {!checkingCache && cachePreview && (
                <>
                  <div className="text-muted-foreground">
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {(cachePreview.cachedFound + (retryNotFound ? 0 : cachePreview.cachedNotFound)).toLocaleString()}
                    </strong>{" "}
                    ya están geocodificadas de una corrida anterior (no se vuelven a consultar) ·{" "}
                    <strong className="text-foreground">{cachePreview.toGeocode.toLocaleString()}</strong> son
                    nuevas y se enviarán a OpenStreetMap.
                  </div>
                  <div className="text-muted-foreground">
                    Tiempo estimado: <strong className="text-foreground">{estimateDuration(cachePreview.toGeocode)}</strong>{" "}
                    aproximado. Si el proceso es largo, mantén esta pestaña abierta y la computadora
                    sin suspenderse; si se interrumpe, puedes retomarlo subiendo el mismo archivo de
                    nuevo.
                  </div>
                </>
              )}
            </div>

            {cachePreview && cachePreview.cachedNotFound > 0 && (
              <label className="flex items-start gap-2 rounded-lg border border-border/60 p-2.5 text-xs">
                <Checkbox checked={retryNotFound} onCheckedChange={(v) => setRetryNotFound(!!v)} className="mt-0.5" />
                <span>
                  Reintentar las <strong>{cachePreview.cachedNotFound.toLocaleString()}</strong> direcciones que
                  en una corrida anterior no se encontraron (útil si corregiste errores de tipeo en el archivo).
                </span>
              </label>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={runGeocode} disabled={checkingCache}>
                <MapPin className="h-4 w-4" /> Geocodificar
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "processing" && (() => {
          const processed = liveStats.found + liveStats.notFound;
          const successRate = processed ? Math.round((100 * liveStats.found) / processed) : null;
          return (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">
                  Geocodificando {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…
                </div>
              </div>
              <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="h-2" />

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {liveStats.found.toLocaleString()}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Encontradas</div>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {liveStats.notFound.toLocaleString()}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sin encontrar</div>
                </div>
              </div>
              {successRate !== null && (
                <p className="text-center text-xs text-muted-foreground">
                  <strong className="text-foreground">{successRate}%</strong> de éxito hasta ahora
                  ({processed.toLocaleString()} procesadas)
                </p>
              )}

              <p className="text-center text-[11px] text-muted-foreground">
                Estimado restante: {estimateDuration(progress.total - progress.done)}. Si cierras esta
                ventana no pasa nada: lo ya geocodificado queda guardado, y puedes retomarlo subiendo el
                mismo archivo de nuevo — no se vuelve a consultar lo que ya se resolvió.
              </p>
            </div>
          );
        })()}

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
