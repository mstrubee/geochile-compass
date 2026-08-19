import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, FileText, Loader2, Search } from "lucide-react";
import {
  fetchLocalMetrics, statsOf, type LocalMetrics,
} from "@/services/analyticsMetricsService";
import {
  exportAnalyticsToPdf, exportAnalyticsToXlsx, type ExportColumn,
} from "@/utils/analyticsExport";

/**
 * "Datos analíticos": métricas de eficiencia de los locales.
 *
 * El modelo de proyección no discrimina (explica 2,5% de la varianza), así que
 * esta sección no intenta predecir: expone la dispersión para que el equipo
 * comercial vea qué locales rinden por encima de su territorio y formule la
 * hipótesis que a los datos les falta.
 */

/** Columnas del Grupo 1. `key` debe existir en LocalMetrics. */
const COLUMNS: Array<ExportColumn & { hint: string; group: "id" | "eficiencia" }> = [
  { key: "name", label: "Local", hint: "", group: "id" },
  { key: "zona", label: "Zona", hint: "", group: "id" },
  { key: "ufMonth", label: "UF/mes", hint: "Venta real promedio", decimals: 0, group: "id" },
  { key: "ufPer1000Pop", label: "UF/1.000 hab", hint: "Penetración: venta por cada mil habitantes de la isócrona", decimals: 1, group: "eficiencia" },
  { key: "captureRatePct", label: "% gasto capturado", hint: "Share of wallet: venta sobre el gasto endógeno del área", decimals: 1, group: "eficiencia" },
  { key: "ufPerSqm", label: "UF/m²", hint: "Productividad de sala (superficie asumida)", decimals: 2, group: "eficiencia" },
  { key: "ufPer1000Vehicles", label: "UF/1.000 veh", hint: "Venta por cada mil vehículos del parque en la isócrona", decimals: 1, group: "eficiencia" },
  { key: "zoneIndex", label: "Índice zona", hint: "100 = mediana de su Zona. Aísla el efecto regional", decimals: 0, group: "eficiencia" },
  { key: "residualUf", label: "Residual UF", hint: "Venta menos la predicha por el modelo. Positivo = rinde más de lo explicable", decimals: 0, group: "eficiencia" },
  { key: "exclusivePopPct", label: "% pob. exclusiva", hint: "100 = sin canibalización con locales propios", decimals: 0, group: "eficiencia" },
  { key: "vehiclesPerCapita", label: "Veh/hab", hint: "Control de calidad del dato de parque: bajo 0,10 la capa no cubre la zona y UF/1.000 veh queda vacío", decimals: 2, group: "eficiencia" },
];

const DEFAULT_COLS = [
  "name", "zona", "ufMonth", "ufPer1000Pop", "captureRatePct", "ufPerSqm",
  "ufPer1000Vehicles", "zoneIndex", "residualUf",
];

type SortKey = keyof LocalMetrics;

const fmtCell = (v: unknown, decimals = 1): string => {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  return String(v);
};

export const AnalyticsDataSection = ({
  folders,
}: {
  folders: Array<{ id: string; name: string }>;
}) => {
  const [folderId, setFolderId] = useState<string>("");
  const [rows, setRows] = useState<LocalMetrics[]>([]);
  const [loading, setLoading] = useState(false);

  // Estado de la tabla. `excluded` replica el patrón del informe de patentes de
  // leaseflow: se desmarcan filas y el export respeta exactamente lo que quedó.
  const [query, setQuery] = useState("");
  const [onlyWithSales, setOnlyWithSales] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COLS);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("ufMonth");
  const [sortDesc, setSortDesc] = useState(true);
  const [openGroup, setOpenGroup] = useState<"actuales" | "estudiados" | null>("actuales");

  useEffect(() => {
    if (folders.length > 0 && !folders.some((f) => f.id === folderId)) {
      setFolderId(folders.find((f) => /autoplanet/i.test(f.name))?.id ?? folders[0].id);
    }
  }, [folders, folderId]);

  useEffect(() => {
    if (!folderId) { setRows([]); return; }
    let cancel = false;
    setLoading(true);
    fetchLocalMetrics(folderId)
      .then((r) => { if (!cancel) { setRows(r); setExcluded(new Set()); } })
      .catch((e) => console.warn("[analytics] error", e))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [folderId]);

  // ── Filtrado y orden ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (onlyWithSales) out = out.filter((r) => r.ufMonth != null);
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || (r.zona ?? "").toLowerCase().includes(q));
    return [...out].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      // Los nulos al final SIEMPRE, en cualquier dirección: si migraran arriba al
      // invertir el orden, taparían justo las filas que se quiere comparar.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "es");
      return sortDesc ? -cmp : cmp;
    });
  }, [rows, query, onlyWithSales, sortKey, sortDesc]);

  /** Lo que realmente se exporta: filtrado menos lo desmarcado. */
  const selected = useMemo(
    () => filtered.filter((r) => !excluded.has(r.poiId)),
    [filtered, excluded],
  );

  const cols = useMemo(
    () => COLUMNS.filter((c) => visibleCols.includes(c.key as string)),
    [visibleCols],
  );

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    parts.push(onlyWithSales ? "solo con venta real" : "todos los locales");
    if (query.trim()) parts.push(`búsqueda "${query.trim()}"`);
    if (excluded.size > 0) parts.push(`${excluded.size} desmarcado(s)`);
    parts.push(`orden por ${COLUMNS.find((c) => c.key === sortKey)?.label ?? sortKey} ${sortDesc ? "desc" : "asc"}`);
    return parts.join(" · ");
  }, [onlyWithSales, query, excluded.size, sortKey, sortDesc]);

  const folderName = folders.find((f) => f.id === folderId)?.name ?? "red";
  const ctx = { folderName, filterLabel, totalRows: rows.length };

  const toggleRow = useCallback((id: string) => {
    setExcluded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  // Referencia de cada columna, para que un valor suelto sea interpretable.
  const colStats = useMemo(() => {
    const m = new Map<string, ReturnType<typeof statsOf>>();
    for (const c of COLUMNS) {
      if (c.group !== "eficiencia") continue;
      m.set(c.key as string, statsOf(filtered.map((r) => r[c.key as keyof LocalMetrics] as number | null)));
    }
    return m;
  }, [filtered]);

  return (
    <div className="space-y-2">
      {/* Selector de red */}
      {folders.length > 1 && (
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="w-full rounded-lg border border-border/40 bg-surface-2/60 px-2 py-1.5 text-[11px] text-foreground"
        >
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}

      {/* ── Grupo: locales actuales ───────────────────────────────────────── */}
      <div className="rounded-lg border border-border/30">
        <button
          onClick={() => setOpenGroup(openGroup === "actuales" ? null : "actuales")}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-2/40"
        >
          {openGroup === "actuales" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Locales actuales
          <span className="ml-auto text-[10px] text-muted-foreground">
            {loading ? "…" : `${selected.length}/${rows.length}`}
          </span>
        </button>

        {openGroup === "actuales" && (
          <div className="space-y-2 border-t border-border/30 px-2 py-2">
            {/* Filtros */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Local o zona…"
                  className="w-full rounded border border-border/40 bg-surface-2/60 pl-6 pr-2 py-1 text-[10px]"
                />
              </div>
              <button
                onClick={() => setShowColPicker((v) => !v)}
                className="rounded border border-border/40 px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                title="Elegir columnas"
              >
                Columnas
              </button>
            </div>

            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <input type="checkbox" checked={onlyWithSales} onChange={(e) => setOnlyWithSales(e.target.checked)} />
              Solo locales con venta real cargada
            </label>

            {showColPicker && (
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 rounded bg-surface-2/40 p-1.5">
                {COLUMNS.map((c) => (
                  <label key={c.key as string} className="flex items-center gap-1 text-[9px] text-muted-foreground" title={c.hint}>
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.key as string)}
                      onChange={(e) =>
                        setVisibleCols((prev) =>
                          e.target.checked
                            ? [...prev, c.key as string]
                            : prev.filter((k) => k !== c.key),
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}

            {/* Tabla */}
            {loading ? (
              <div className="flex items-center justify-center gap-1.5 py-4 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Calculando métricas…
              </div>
            ) : (
              <div className="max-h-[320px] overflow-auto scrollbar-thin">
                <table className="w-full text-[9px]">
                  <thead className="sticky top-0 bg-surface-1">
                    <tr>
                      <th className="w-5" />
                      {cols.map((c) => (
                        <th
                          key={c.key as string}
                          title={c.hint}
                          onClick={() => {
                            if (sortKey === c.key) setSortDesc((v) => !v);
                            else { setSortKey(c.key as SortKey); setSortDesc(true); }
                          }}
                          className="cursor-pointer whitespace-nowrap px-1 py-1 text-left font-medium text-muted-foreground hover:text-foreground"
                        >
                          {c.label}{sortKey === c.key ? (sortDesc ? " ↓" : " ↑") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const off = excluded.has(r.poiId);
                      return (
                        <tr key={r.poiId} className={off ? "opacity-40" : "hover:bg-surface-2/40"}>
                          <td className="px-1">
                            <input type="checkbox" checked={!off} onChange={() => toggleRow(r.poiId)} />
                          </td>
                          {cols.map((c) => (
                            <td key={c.key as string} className="whitespace-nowrap px-1 py-0.5 text-foreground">
                              {c.key === "name" || c.key === "zona"
                                ? fmtCell(r[c.key as keyof LocalMetrics])
                                : fmtCell(r[c.key as keyof LocalMetrics], c.decimals ?? 1)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr><td colSpan={cols.length + 1} className="py-3 text-center text-muted-foreground">Sin locales que cumplan el filtro.</td></tr>
                    )}
                  </tbody>
                  {/* Mediana de la red como pie: un valor suelto no dice nada sin referencia. */}
                  {filtered.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-surface-1">
                      <tr>
                        <td />
                        {cols.map((c) => {
                          const st = colStats.get(c.key as string);
                          return (
                            <td key={c.key as string} className="whitespace-nowrap px-1 py-1 text-[8px] text-muted-foreground" title="Mediana de las filas filtradas">
                              {c.key === "name" ? "mediana →" : st ? fmtCell(st.median, c.decimals ?? 1) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {/* Export */}
            <div className="flex gap-1.5">
              <button
                onClick={() => exportAnalyticsToXlsx(selected, cols, ctx)}
                disabled={selected.length === 0}
                className="flex-1 rounded-lg bg-green-600/10 px-2 py-1.5 text-[10px] font-medium text-green-400 hover:bg-green-600/20 disabled:opacity-40"
              >
                <FileSpreadsheet className="mr-1 inline h-3 w-3" /> Excel ({selected.length})
              </button>
              <button
                onClick={() => exportAnalyticsToPdf(selected, cols, ctx)}
                disabled={selected.length === 0}
                className="flex-1 rounded-lg bg-brand-red/10 px-2 py-1.5 text-[10px] font-medium text-brand-red hover:bg-brand-red/20 disabled:opacity-40"
              >
                <FileText className="mr-1 inline h-3 w-3" /> PDF ({selected.length})
              </button>
            </div>

            <p className="text-[8px] leading-snug text-muted-foreground">
              El modelo de comparables explica ~2,5% de la varianza de ventas: el
              residual mide desvío contra una referencia débil, no una meta.
              Superficie asumida 425 m² (Express la mitad) mientras no exista el dato real.
              UF/1.000 veh queda vacío donde la capa de parque no cubre la zona
              (veh/hab bajo 0,10): 7 locales, entre ellos Ovalle y Casablanca.
            </p>
          </div>
        )}
      </div>

      {/* ── Grupo: locales estudiados ─────────────────────────────────────── */}
      <div className="rounded-lg border border-border/30">
        <button
          onClick={() => setOpenGroup(openGroup === "estudiados" ? null : "estudiados")}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-2/40"
        >
          {openGroup === "estudiados" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Locales estudiados
        </button>
        {openGroup === "estudiados" && (
          <div className="border-t border-border/30 px-2 py-2 text-[10px] text-muted-foreground">
            Próximo: percentiles del candidato contra la red y dispersión población vs venta.
          </div>
        )}
      </div>
    </div>
  );
};
