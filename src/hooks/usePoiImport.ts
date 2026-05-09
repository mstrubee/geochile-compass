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
import { supabase } from "@/integrations/supabase/client";
import { normalizeAddress } from "@/utils/addressNormalize";

const skipKeyForRow = (row: ImportRow): string => {
  const name = (
    row.identity["Nombre Local"] ??
    row.identity["Local"] ??
    row.identity["Nombre"] ??
    ""
  ).toString().trim().toLowerCase();
  const addr = normalizeAddress(row.rawAddress ?? "");
  return `${name}::${addr}`;
};

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
  const [sourceFilePath, setSourceFilePath] = useState<string | null>(null);
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
    setSourceFilePath(null);
  }, []);

  /** Etapa 1: parsea el Excel y lo sube a storage para poder retomarlo después. */
  const parse = useCallback(
    async (file: File, options?: { existingPath?: string | null }) => {
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

        // Subir el archivo en background si todavía no estaba en storage.
        if (folderId && !options?.existingPath) {
          const path = `${folderId}/${crypto.randomUUID()}-${file.name}`;
          supabase.storage
            .from("poi-imports")
            .upload(path, file, { upsert: true, contentType: file.type })
            .then(({ error: upErr }) => {
              if (upErr) console.warn("[poi-imports upload]", upErr.message);
              else setSourceFilePath(path);
            });
        } else if (options?.existingPath) {
          setSourceFilePath(options.existingPath);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al parsear");
        setPhase("error");
      }
    },
    [schema, folderId],
  );

  /** Retoma un import previo descargando el archivo desde storage. */
  const resumeFromStorage = useCallback(
    async (path: string, fileName: string) => {
      try {
        setPhase("parsing");
        setError(null);
        const { data, error: dlErr } = await supabase.storage
          .from("poi-imports")
          .download(path);
        if (dlErr || !data) {
          throw new Error(
            dlErr?.message ?? "No se pudo descargar el archivo original",
          );
        }
        const file = new File([data], fileName, {
          type:
            data.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        await parse(file, { existingPath: path });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al retomar el import");
        setPhase("error");
      }
    },
    [parse],
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
        const poiIds = folderPois.map((p) => p.id);
        const [aliasList, attrsRes, identityRes] = await Promise.all([
          fetchAliasesForPois(poiIds),
          poiIds.length > 0
            ? supabase.from("poi_attributes").select("*").in("poi_id", poiIds)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("poi_import_identity_memory")
            .select("key_type,key_value,poi_id")
            .eq("folder_id", folderId),
        ]);
        setAliases(aliasList);
        const poiAttributes = (attrsRes.data ?? []) as Array<{
          poi_id: string;
          attr_key: string;
          attr_value: string | null;
          source_import_id: string | null;
          updated_at: string;
        }>;
        const identityMemory = (identityRes.data ?? []) as Array<{
          key_type: string;
          key_value: string;
          poi_id: string;
        }>;
        const result = await matchImportRows({
          rows: parsed.rows,
          pois: folderPois,
          aliases: aliasList,
          poiAttributes,
          identityMemory,
          thresholdMeters,
          onProgress: (done, total) => {
            setProgressMsg(`Reconociendo filas ${done}/${total}…`);
            setProgressFrac(done / Math.max(1, total));
          },
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setMatches(result);
        // Auto-omitir filas que en imports anteriores fueron marcadas como omitidas.
        try {
          const { data: skipMem } = await supabase
            .from("poi_import_skip_memory")
            .select("normalized_key")
            .eq("folder_id", folderId);
          if (skipMem && skipMem.length > 0) {
            const memSet = new Set(skipMem.map((r) => r.normalized_key));
            const auto = new Set<number>();
            for (const row of parsed.rows) {
              if (memSet.has(skipKeyForRow(row))) auto.add(row.rowIndex);
            }
            if (auto.size > 0) {
              setSkippedRows((prev) => {
                const next = new Set(prev);
                auto.forEach((i) => next.add(i));
                return next;
              });
            }
          }
        } catch {
          /* ignorar error de memoria de omisiones */
        }
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
        sourceFilePath,
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
  }, [parsed, folderId, filename, matches, manualAssignments, skippedRows, sourceFilePath]);

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
