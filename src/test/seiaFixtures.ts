/** Fixtures SINTÉTICOS de «Proyectos SEIA» (no son datos del SEA). Los nombres de campo son los de las RPC. */
import type { LayerProvenanceRow } from "@/types/permits";
import type { SeiaFacets, SeiaProjectDetail, SeiaProjectRow } from "@/types/seia";

export const FACETS: SeiaFacets = {
  total: 120, with_point: 118, by_source: { seia_proyectos_dia: 100, seia_proyectos_eia: 20 },
  geo_status: { inside: 100, near_border: 10, outside_declared: 4, comuna_unmatched: 4, no_geometry: 2 },
  // el mismo código con DOS nombres (g.1), como en el servicio real; h.2 es industrial y no entra por defecto; «c.» trae punto final
  typologies: [
    { letter: "g.1", name: "g.1) Conjuntos habitacionales SINTÉTICO", n: 20 }, { letter: "g.1", name: "g.1) Desarrollo urbano SINTÉTICO", n: 10 },
    { letter: "g.2", name: "g.2) Equipamiento SINTÉTICO", n: 5 }, { letter: "h.1", name: "h.1) Proyectos inmobiliarios", n: 60 },
    { letter: "h.2", name: "h.2) Proyectos industriales SINTÉTICO", n: 15 }, { letter: "c.", name: "c.) Centrales generadoras SINTÉTICO", n: 10 },
  ],
  statuses: [{ value: "Aprobado", n: 80 }, { value: "En Calificación", n: 30 }, { value: "Rechazado", n: 10 }],
  year_min: 2018, year_max: 2024,
};

export const ROW = (over: Partial<SeiaProjectRow> = {}): SeiaProjectRow => ({
  id: 1, source_key: "seia_proyectos_dia", kind: "DIA", external_id: "2000000001", name: "Proyecto SINTÉTICO 1",
  typology_letter: "h.1", typology_name: "h.1) Proyectos inmobiliarios SINTÉTICO", status_declared: "Aprobado",
  submitted_at: "2020-03-02", qualified_at: null, investment_usd: 1000000, lon: -70.5, lat: -33.35,
  geo_check_status: "inside", review_decision: null, review_lon: null, review_lat: null, total_matching: 1, ...over,
});

export const PROV = (key = "seia_proyectos_dia", over: Partial<LayerProvenanceRow> = {}): LayerProvenanceRow => ({
  source_key: key, name: "SEA — Proyectos SEIA SINTÉTICO", publisher: "SEA", landing_url: "https://example.test/seia", attribution: "Fuente: Servicio de Evaluación Ambiental (SEA), e-SEIA",
  license_label: null, verification_status: "comprobado", scope_note: null, access_mode: "automatic", freshness_status: "fresh", check_overdue: false,
  overdue_since: null, last_checked_at: null, snapshot_id: "s", origin_url: "https://example.test/MapServer/2", sha256: "00", captured_at: "2026-10-16T10:00:00Z",
  period_start: "2026-10-16", period_end: "2026-10-16", load_from: null, declared_date: null, definitive_until: null, quality_note: null, ...over,
});

export const DETAIL = (over: Partial<SeiaProjectDetail["project"]> = {}, rest: Partial<SeiaProjectDetail> = {}): SeiaProjectDetail => ({
  project: {
    id: 1, source_key: "seia_proyectos_dia", kind: "DIA", external_id: "2000000001", name: "Proyecto SINTÉTICO 1", submission_form_declared: "Declaración de Impacto Ambiental",
    typology_letter: "h.1", typology_name: "h.1) Proyectos inmobiliarios SINTÉTICO", region_declared: "Región Metropolitana", comunas_declared: "Lo Barnechea",
    comuna_cuts: ["13115"], comunas_unresolved: [], titular: "Titular SINTÉTICO", status_declared: "Aprobado", submitted_at: "2020-03-02", qualified_at: "2020-09-15",
    investment_usd: 12345678, expediente_url: null, lon: -70.5, lat: -33.35, geo_check_status: "inside", geo_check_distance_m: 0, geo_check_detail: { tolerance_m: 500 }, ...over,
  },
  raw: { OBJECTID: 77, X: -70.5, Y: -33.35, MODIFICADO: 1700000000000 },
  source: { name: "SEA — Proyectos SEIA SINTÉTICO", publisher: "SEA", landing_url: "https://example.test/seia", attribution: "Fuente: Servicio de Evaluación Ambiental (SEA), e-SEIA",
            verification_status: "comprobado", scope_note: "Solo proyectos que ingresan al SEIA." },
  snapshot: { id: "snap", origin_url: "https://example.test/MapServer/2", captured_at: "2026-10-16T10:00:00Z", declared_date: null, sha256: "abcdef0123456789abcdef" },
  reviews: [], ...rest,
});
