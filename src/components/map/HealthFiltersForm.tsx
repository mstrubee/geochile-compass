import { AMBITO_ESTABLECIMIENTO, type HealthAltaDef, type HealthClase, type HealthComplejidad, type HealthFilters, type HealthTipoRow } from "@/types/health";
import { ALTA_LABEL, CLASE_LABEL, COMPLEJIDAD_LABEL, DEPENDENCIA_LABEL, DEPENDENCIA_OPTIONS } from "@/utils/healthScale";

const sel = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

interface Props { filters: HealthFilters; onFilters: (f: HealthFilters) => void; tipos?: HealthTipoRow[] }

/** Filtros de las dos capas de salud. Un select vacío = sin filtro (viaja como null a la RPC). */
export const HealthFiltersForm = ({ filters, onFilters, tipos }: Props) => {
  const one = <T extends string>(v: T[] | null): string => (v && v.length ? v[0] : "");
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="health-filters">
      <label className="col-span-2 space-y-1"><span className="font-medium">Alta complejidad</span>
        <select aria-label="Definición de alta complejidad" className={sel} value={filters.alta ?? ""}
          onChange={(e) => onFilters({ ...filters, alta: (e.target.value || null) as HealthAltaDef | null })}>
          <option value="">Sin filtro</option>
          <option value="hospital">{ALTA_LABEL.hospital}</option>
          <option value="ampliada">{ALTA_LABEL.ampliada}</option>
        </select></label>
      <label className="space-y-1"><span className="font-medium">Dependencia</span>
        <select aria-label="Dependencia" className={sel} value={one(filters.dependencia)}
          onChange={(e) => onFilters({ ...filters, dependencia: e.target.value ? [e.target.value] : null })}>
          <option value="">Todas</option>
          {DEPENDENCIA_OPTIONS.map((d) => <option key={d} value={d}>{DEPENDENCIA_LABEL[d]}</option>)}
        </select></label>
      <label className="space-y-1"><span className="font-medium">Complejidad</span>
        <select aria-label="Complejidad" className={sel} value={one(filters.complejidad)}
          onChange={(e) => onFilters({ ...filters, complejidad: e.target.value ? [e.target.value as HealthComplejidad] : null })}>
          <option value="">Todas</option>
          {(Object.keys(COMPLEJIDAD_LABEL) as HealthComplejidad[]).map((c) => <option key={c} value={c}>{COMPLEJIDAD_LABEL[c]}</option>)}
        </select></label>
      <label className="col-span-2 space-y-1"><span className="font-medium">Tipo de establecimiento</span>
        <select aria-label="Tipo de establecimiento" className={sel} value={one(filters.tipo)}
          onChange={(e) => onFilters({ ...filters, tipo: e.target.value ? [e.target.value] : null })}>
          <option value="">Todos los tipos</option>
          {(tipos ?? []).map((t) => <option key={t.tipo_norm} value={t.tipo_norm}>{t.tipo_label}</option>)}
        </select></label>
      <label className="col-span-2 space-y-1"><span className="font-medium">Clase de atención</span>
        <select aria-label="Clase de atención" className={sel} value={one(filters.clase)}
          onChange={(e) => onFilters({ ...filters, clase: e.target.value ? [e.target.value as HealthClase] : null })}>
          <option value="">Todas</option>
          {(Object.keys(CLASE_LABEL) as HealthClase[]).map((c) => <option key={c} value={c}>{CLASE_LABEL[c]}</option>)}
        </select></label>
      <label className="col-span-2 inline-flex items-center gap-1">
        <input type="checkbox" aria-label="Incluir unidades de atención y programas" checked={filters.ambito == null}
          onChange={(e) => onFilters({ ...filters, ambito: e.target.checked ? null : [AMBITO_ESTABLECIMIENTO] })} />
        Incluir unidades de atención y programas
      </label>
      <label className="col-span-2 inline-flex items-center gap-1">
        <input type="checkbox" aria-label="Incluir cerrados" checked={filters.includeClosed} onChange={(e) => onFilters({ ...filters, includeClosed: e.target.checked })} />
        Incluir establecimientos cerrados
      </label>
    </div>
  );
};
