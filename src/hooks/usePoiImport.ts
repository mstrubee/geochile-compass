import { useCallback, useMemo, useRef, useState } from "react";
import type { SavedPoi } from "@/types/pois";
import type {
  ImportRow,
  PoiAddressAlias,
  PoiFolderSchema,
  RowMatchResult,
} from "@/types/poiMetrics";
import { parseAutoPlanetSheet, type ParsedSheet } from "@/services/poiImportParser";
import {
  matchImportRows,
  DEFAULT_THRESHOLD_METERS,
} from "@/services/poiImportMatcher";
import { fetchAliasesForPois } from "@/hooks/usePoiMetrics";
import { commitImport, type CommitResult } from "@/services/poiImportCommit";

export type ImportPhase =
  | "idle"
  | "parsing"
  | "parsed"
  | "matching"
  | "review"
  | "committing"
  | "done"
  | "error";

interface UseImportParams {
  schema: PoiFolderSchema | null;
  folderId: string | null;
  folderPois: SavedPoi[];
}

/**
 * Orquesta:
 *  parse → match (geocode + nearest POI) → review (manual fixes) → commit
 *
 * Estado clave:
 *  - `parsed`: filas tal cual vienen del Excel
 *  - `matches`: resultado del matching automático por fila
 *  - `manualAssignments`: rowIndex → poiId (override admin)
 *  - `skippedRows`: rowIndex set (filas a omitir)
 */
export const usePoiImport = ({ schema, folderId, folderPois }: UseImportParams) => {
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [filename, setFilename] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [matches, setMatches] = useState<RowMatchResult[]>([]);
  const [manualAssignments, setManualAssignments] = useState<Record<number, string>>({});
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [progressFrac, setProgressFrac] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [aliases, setAliases] = useState<PoiAddressAlias[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setFilename("");
    setParsed(null);
    setMatches([]);
    setManualAssignments({});
    setSkippedRows(new Set());
    setProgressMsg("");
    setProgressFrac(0);
    setError(null);
    setCommitResult(null);
    setAliases([]);
  }, []);

  /** Etapa 1: parsea el Excel. */
  const parse = useCallback(
    async (file: File) => {
      if (!schema) {
        setError("Esta carpeta no tiene esquema de importación configurado.");
        setPhase("error");
        return;
      }
      try {
        setPhase("parsing");
        setFilename(file.name);
        setError(null);
        const result = await parseAutoPlanetSheet(file, schema);
        if (result.missingIdentityColumns.length > 0) {
          throw new Error(
            `Faltan columnas requeridas: ${result.missingIdentityColumns.join(", ")}`,
          );
        }
        setParsed(result);
        setPhase("parsed");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al parsear");
        setPhase("error");
      }
    },
    [schema],
  );

  /** Etapa 2: geocodifica y matchea. */
  const runMatching = useCallback(
    async (thresholdMeters: number = DEFAULT_THRESHOLD_METERS) => {
      if (!parsed || !folderId) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        setPhase("matching");
        setProgressFrac(0);
        const aliasList = await fetchAliasesForPois(folderPois.map((p) => p.id));
        setAliases(aliasList);
        const result = await matchImportRows({
          rows: parsed.rows,
          pois: folderPois,
          aliases: aliasList,
          thresholdMeters,
          onProgress: (done, total) => {
            setProgressMsg(`Geocodificando ${done}/${total}…`);
            setProgressFrac(done / Math.max(1, total));
          },
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setMatches(result);
        setPhase("review");
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          setPhase("parsed");
          return;
        }
        setError(e instanceof Error ? e.message : "Error en matching");
        setPhase("error");
      }
    },
    [parsed, folderId, folderPois],
  );

  /** Etapa 3: el admin asigna manualmente un poi a una fila. */
  const assignManual = useCallback((rowIndex: number, poiId: string) => {
    setManualAssignments((prev) => ({ ...prev, [rowIndex]: poiId }));
  }, []);

  const clearManual = useCallback((rowIndex: number) => {
    setManualAssignments((prev) => {
      const next = { ...prev };
      delete next[rowIndex];
      return next;
    });
  }, []);

  const toggleSkip = useCallback((rowIndex: number) => {
    setSkippedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);

  /** Etapa 4: commit. */
  const commit = useCallback(async () => {
    if (!parsed || !folderId) return;
    try {
      setPhase("committing");
      setProgressFrac(0);
      const res = await commitImport({
        folderId,
        filename,
        rows: parsed.rows,
        matches,
        manualAssignments,
        skippedRowIndices: skippedRows,
        onProgress: (msg, frac) => {
          setProgressMsg(msg);
          setProgressFrac(frac);
        },
      });
      setCommitResult(res);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
      setPhase("error");
    }
  }, [parsed, folderId, filename, matches, manualAssignments, skippedRows]);

  // Estadísticas para la UI
  const stats = useMemo(() => {
    const total = parsed?.rows.length ?? 0;
    let auto = 0;
    let alias = 0;
    let needsReview = 0;
    let noGeo = 0;
    let manualAssigned = 0;
    for (const m of matches) {
      if (manualAssignments[m.rowIndex]) {
        manualAssigned++;
        continue;
      }
      if (m.status === "auto_matched") auto++;
      else if (m.status === "alias_matched") alias++;
      else if (m.status === "needs_review") needsReview++;
      else if (m.status === "no_geocode") noGeo++;
    }
    return {
      total,
      auto,
      alias,
      manualAssigned,
      needsReview: needsReview - Object.keys(manualAssignments).filter((idx) => {
        const m = matches.find((mm) => mm.rowIndex === Number(idx));
        return m?.status === "needs_review";
      }).length,
      noGeo: noGeo - Object.keys(manualAssignments).filter((idx) => {
        const m = matches.find((mm) => mm.rowIndex === Number(idx));
        return m?.status === "no_geocode";
      }).length,
      pending: matches.filter(
        (m) => !manualAssignments[m.rowIndex] && (m.status === "needs_review" || m.status === "no_geocode"),
      ).length,
      skipped: skippedRows.size,
    };
  }, [parsed, matches, manualAssignments, skippedRows]);

  return {
    phase,
    error,
    filename,
    parsed,
    matches,
    manualAssignments,
    skippedRows,
    aliases,
    progressMsg,
    progressFrac,
    commitResult,
    stats,
    parse,
    runMatching,
    assignManual,
    clearManual,
    toggleSkip,
    commit,
    reset,
  };
};
