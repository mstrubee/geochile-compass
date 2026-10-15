import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commitImport,
  createImport,
  discardImport,
  fetchImportLimits,
  previewImport,
  revertImport,
  uploadStaging,
  type ImportLimits,
  type ImportMode,
  type ImportPreview,
  type ImportResult,
} from "@/services/layerImport";
import { clearTerritorialFeaturesCache } from "@/hooks/useTerritorialLayers";
import { parseImportFile, type ImportDocument } from "@/utils/importParser";
import { applyInclusion, newImportSummary } from "@/utils/importWizard";
import type { ImportStage } from "@/utils/importErrorReport";

export type WizardPhase = "parsing" | "ready" | "working" | "done" | "error";

/** Un fallo: en qué paso ocurrió y lo que se lanzó (el asistente lo convierte en un informe legible). */
export interface WizardFailure {
  stage: ImportStage;
  error: unknown;
}

interface Args {
  /** Archivo elegido o soltado; `null` = asistente cerrado. */
  file: File | null;
  initialMode?: ImportMode;
  /** Carpeta (modo nueva) o capa (reemplazar/agregar) sobre la que se soltó el archivo. */
  initialTargetId?: string | null;
  onCommitted?: (result: ImportResult) => void;
}

const PREVIEW_DEBOUNCE_MS = 350;

/** Una importación nueva va DENTRO de una carpeta; reemplazar y agregar actualizan una CAPA. */
const targetKind = (m: ImportMode) => (m === "new" ? "folder" : "layer");

/**
 * Estado del asistente de importación. Nada se sube hasta que hace falta: una carga NUEVA
 * se ve con lo que ya está en el navegador; al REEMPLAZAR o AGREGAR hay que subir los
 * puntos (staging) para que la base calcule el diff. Lo subido y no confirmado se descarta
 * al cerrar o al abrir otro archivo.
 */
export const useImportWizard = ({ file, initialMode = "new", initialTargetId = null, onCommitted }: Args) => {
  const [phase, setPhase] = useState<WizardPhase>("parsing");
  const [doc, setDoc] = useState<ImportDocument | null>(null);
  const [failure, setFailure] = useState<WizardFailure | null>(null);
  /** El límite de la base no se pudo leer: no impide importar (lo valida la base al confirmar) pero no se calla. */
  const [limitsWarning, setLimitsWarning] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [mode, setModeState] = useState<ImportMode>(initialMode);
  const [target, setTarget] = useState<string | null>(initialTargetId);
  const [limits, setLimits] = useState<ImportLimits | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reverted, setReverted] = useState(false);

  const batchRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const stagingRef = useRef<Promise<string> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewSeq = useRef(0);

  /** Descarta el lote subido (si no se confirmó) y olvida lo preparado. */
  const discard = useCallback(() => {
    abortRef.current?.abort();
    const id = batchRef.current;
    const committed = committedRef.current;
    batchRef.current = null;
    stagingRef.current = null;
    committedRef.current = false;
    setBatchId(null);
    setPreview(null);
    // Si no se puede descartar no hay nada que el usuario deba hacer: la limpieza horaria lo borra. Pero queda a la vista.
    if (id && !committed) void discardImport(id).catch((e) => console.warn("[importador] no se pudo descartar el lote", id, e));
  }, []);

  // ── Abrir un archivo ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    discard();
    setPhase("parsing");
    setDoc(null);
    setFailure(null);
    setLimitsWarning(null);
    setExcluded(new Set());
    setModeState(initialMode);
    setTarget(initialTargetId);
    setResult(null);
    setReverted(false);
    // Un respiro para que se pinte "Leyendo el archivo…" antes de que el parseo ocupe el hilo.
    const t = setTimeout(() => {
      parseImportFile(file)
        .then((d) => {
          if (cancelled) return;
          setDoc(d);
          setPhase("ready");
        })
        .catch((e) => {
          if (cancelled) return;
          setFailure({ stage: "read", error: e });
          setPhase("error");
        });
    }, 30);
    fetchImportLimits()
      .then((l) => !cancelled && setLimits(l))
      .catch((e) => {
        if (cancelled) return;
        console.warn("[importador] no se pudo leer el límite de la base", e);
        setLimitsWarning("No se pudo leer el límite de tamaño de la base; se validará recién al confirmar.");
      });
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // Cambiar el modo o el destino iniciales no debe reabrir el archivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Al desmontar (cerrar) se descarta lo que quedó subido sin confirmar.
  useEffect(() => () => discard(), [discard]);

  // ── Subir los puntos (una sola vez por archivo) ──────────────────────────
  const stage = useCallback((): Promise<string> => {
    if (!doc) return Promise.reject(new Error("No hay archivo"));
    if (stagingRef.current) return stagingRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const p = (async () => {
      const id = await createImport(doc);
      batchRef.current = id;
      try {
        setProgress({ done: 0, total: doc.counts.features });
        await uploadStaging(id, doc, (done, total) => setProgress({ done, total }), ctrl.signal);
      } catch (e) {
        batchRef.current = null;
        void discardImport(id).catch((err) => console.warn("[importador] no se pudo descartar el lote", id, err));
        throw e;
      } finally {
        setProgress(null);
      }
      setBatchId(id);
      return id;
    })();
    stagingRef.current = p;
    p.catch(() => {
      if (stagingRef.current === p) stagingRef.current = null;
    });
    return p;
  }, [doc]);

  // ── Vista previa ─────────────────────────────────────────────────────────
  const localSummary = useMemo(() => (doc ? newImportSummary(doc, excluded) : null), [doc, excluded]);

  // Reemplazar / agregar: el diff lo calcula la base sobre los puntos subidos.
  useEffect(() => {
    if (!doc || phase !== "ready" || mode === "new" || !target || !localSummary?.layers) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      setPreviewing(true);
      setFailure(null);
      let step: ImportStage = "upload";
      try {
        const id = await stage();
        step = "preview";
        const p = await previewImport(id, mode, target, excluded);
        if (seq === previewSeq.current) setPreview(p);
      } catch (e) {
        if (seq === previewSeq.current) {
          setPreview(null);
          setFailure({ stage: step, error: e });
        }
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [doc, phase, mode, target, excluded, localSummary?.layers, stage]);

  // ── Acciones ─────────────────────────────────────────────────────────────
  const setMode = useCallback(
    (next: ImportMode) => {
      // El destino de una importación nueva (carpeta) no sirve para actualizar (capa), y al revés.
      if (targetKind(next) !== targetKind(mode)) setTarget(targetKind(next) === targetKind(initialMode) ? initialTargetId : null);
      setModeState(next);
      setPreview(null);
      setFailure(null);
    },
    [mode, initialMode, initialTargetId],
  );

  const toggleLayers = useCallback((keys: readonly string[], include: boolean) => {
    setExcluded((prev) => applyInclusion(prev, keys, include));
  }, []);

  /** Puntos que se escribirán y cuántos admite la base de una vez. */
  const rowsToWrite = mode === "new" ? (localSummary?.features ?? 0) : (preview?.diff?.rows_to_write ?? 0);
  const maxRows = preview?.max_rows ?? limits?.max_rows ?? null;
  const fits = maxRows == null ? true : mode === "new" ? rowsToWrite <= maxRows : preview ? preview.fits : true;

  const canConfirm =
    phase === "ready" && !!doc && (localSummary?.layers ?? 0) > 0 && fits && (mode === "new" || (!!target && !!preview && !previewing));

  const confirm = useCallback(async () => {
    if (!doc) return;
    setPhase("working");
    setFailure(null);
    let step: ImportStage = "upload";
    try {
      const id = await stage();
      step = "commit";
      const res = await commitImport(id, mode, target, excluded);
      committedRef.current = true;
      // El mapa guarda en memoria los puntos de cada capa: si cambió su contenido hay que volver a pedirlos.
      clearTerritorialFeaturesCache();
      setResult(res);
      setPhase("done");
      onCommitted?.(res);
    } catch (e) {
      setFailure({ stage: step, error: e });
      setPhase("ready");
    }
  }, [doc, stage, mode, target, excluded, onCommitted]);

  const undo = useCallback(async () => {
    const id = batchRef.current;
    if (!id) return false;
    try {
      await revertImport(id);
      clearTerritorialFeaturesCache();
      setReverted(true);
      return true;
    } catch (e) {
      setFailure({ stage: "undo", error: e });
      return false;
    }
  }, []);

  return {
    phase, doc, failure, limitsWarning, excluded, mode, target, limits, batchId, progress, preview, previewing, result, reverted,
    localSummary, rowsToWrite, maxRows, fits, canConfirm,
    setMode, setTarget, toggleLayers, confirm, undo, discard,
  };
};
