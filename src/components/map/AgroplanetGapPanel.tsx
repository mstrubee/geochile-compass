import { useMemo } from "react";
import type { AgroplanetComuna } from "@/hooks/useAgroplanetData";
import type { AgroplanetCompetitor } from "@/hooks/useAgroplanetCompetitors";

interface Props {
  comunas:     Map<string, AgroplanetComuna>;
  competitors: AgroplanetCompetitor[];
  visible:     boolean;
}

// ── Haversine ──────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Aproximación de centroide por CUT (región → coordenada aproximada)
// Solo se usa si no hay GeoJSON disponible en cliente
const REGION_CENTROIDS: Record<string, [number, number]> = {
  "01": [-20.2, -69.9], "02": [-23.6, -68.5], "03": [-27.4, -70.0],
  "04": [-30.0, -71.0], "05": [-33.1, -71.3], "06": [-34.5, -71.1],
  "07": [-35.4, -71.6], "08": [-37.1, -72.1], "09": [-38.7, -72.6],
  "10": [-40.9, -73.2], "11": [-45.6, -72.1], "12": [-52.0, -71.5],
  "13": [-33.5, -70.7], "14": [-39.8, -73.2], "15": [-18.5, -70.2],
  "16": [-36.8, -71.8],
};

function getCentroid(cut: string): [number, number] | null {
  const regionId = cut.substring(0, 2);
  return REGION_CENTROIDS[regionId] ?? null;
}

const COBERTURA_PLENA = 35;
const SIN_COBERTURA   = 90;

function coverageGapFactor(minDistKm: number): number {
  if (minDistKm <= COBERTURA_PLENA) return 0;
  if (minDistKm >= SIN_COBERTURA)   return 1;
  return (minDistKm - COBERTURA_PLENA) / (SIN_COBERTURA - COBERTURA_PLENA);
}

interface OportunidadRow {
  cut:               string;
  nombre:            string;
  region:            string;
  score_combined:    number;
  quintil_combined:  number;
  distKm:            number;
  nearestDealer:     string;
  oportunidad:       number;
  oportunidadNorm:   number;
}

// ── Colores ────────────────────────────────────────────────────────────────
function oportunidadColor(norm: number): string {
  if (norm >= 80) return "#15803d";
  if (norm >= 60) return "#65a30d";
  if (norm >= 40) return "#ca8a04";
  if (norm >= 20) return "#ea580c";
  return "#9ca3af";
}

const STAR = "⭐";

export function AgroplanetGapPanel({ comunas, competitors, visible }: Props) {
  const ranking = useMemo<OportunidadRow[]>(() => {
    if (!visible || comunas.size === 0 || competitors.length === 0) return [];

    const rows: OportunidadRow[] = [];

    comunas.forEach((c) => {
      const centroid = getCentroid(c.cut);
      if (!centroid) return;
      const [clat, clng] = centroid;

      let minDist = Infinity;
      let nearestName = "—";

      for (const comp of competitors) {
        if (!comp.lat || !comp.lng) continue;
        const d = haversineKm(clat, clng, comp.lat, comp.lng);
        if (d < minDist) {
          minDist     = d;
          nearestName = comp.nombre;
        }
      }

      const gap        = coverageGapFactor(minDist);
      const oportunidad = c.score_combined * gap;

      rows.push({
        cut:              c.cut,
        nombre:           c.nombre,
        region:           c.region,
        score_combined:   c.score_combined,
        quintil_combined: c.quintil_combined,
        distKm:           Math.round(minDist),
        nearestDealer:    nearestName,
        oportunidad,
        oportunidadNorm:  0, // se calcula abajo
      });
    });

    const maxOp = Math.max(...rows.map((r) => r.oportunidad), 0.001);
    rows.forEach((r) => {
      r.oportunidadNorm = Math.round((r.oportunidad / maxOp) * 100);
    });

    return rows.sort((a, b) => b.oportunidad - a.oportunidad).slice(0, 20);
  }, [comunas, competitors, visible]);

  if (!visible) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-950/40 border-b border-border">
        <span className="text-base">🎯</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11.5px] font-semibold text-foreground leading-tight">
            Top 20 — Comunas sin cobertura
          </p>
          <p className="text-[9.5px] text-muted-foreground leading-tight mt-0.5">
            IDPA alto · lejos de dealer · {COBERTURA_PLENA}–{SIN_COBERTURA} km modelo
          </p>
        </div>
      </div>

      {/* Lista */}
      <div className="divide-y divide-border/50 max-h-[480px] overflow-y-auto">
        {ranking.length === 0 ? (
          <p className="text-[11px] text-muted-foreground px-3 py-3">
            Activa ambas capas (AGROPLANET + Competidores) para ver el análisis.
          </p>
        ) : (
          ranking.map((row, i) => {
            const color = oportunidadColor(row.oportunidadNorm);
            const stars = row.oportunidadNorm >= 80 ? 3 : row.oportunidadNorm >= 50 ? 2 : 1;
            return (
              <div key={row.cut} className="flex items-center gap-2 px-2.5 py-2 hover:bg-surface-2/40 transition-colors">
                {/* Rank */}
                <span className="text-[10px] text-muted-foreground w-4 flex-shrink-0 text-right">
                  {i + 1}
                </span>
                {/* Bar */}
                <div className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ background: color }} />
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold text-foreground truncate">
                      {row.nombre}
                      {stars >= 3 && <span className="ml-1 text-[9px]">{STAR}{STAR}{STAR}</span>}
                      {stars === 2 && <span className="ml-1 text-[9px]">{STAR}{STAR}</span>}
                    </span>
                    <span
                      className="text-[10px] font-bold flex-shrink-0"
                      style={{ color }}
                    >
                      {row.oportunidadNorm}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9.5px] text-muted-foreground truncate">
                      {row.region.replace("Libertador General Bernardo OHiggins", "O'Higgins")}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">·</span>
                    <span className="text-[9.5px] text-muted-foreground">
                      IDPA {row.score_combined.toFixed(0)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">·</span>
                    <span className="text-[9.5px] text-orange-400">
                      {row.distKm} km
                    </span>
                  </div>
                  <div className="text-[9px] text-muted-foreground/70 truncate mt-0.5">
                    más cercano: {row.nearestDealer}
                  </div>
                </div>
                {/* Mini progress */}
                <div className="w-12 flex-shrink-0">
                  <div className="h-1 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.oportunidadNorm}%`, background: color }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border bg-surface-2/30">
        <p className="text-[9px] text-muted-foreground">
          Oportunidad = IDPA × brecha cobertura · distancia euclidiana (proxy isócrona 45 min)
        </p>
      </div>
    </div>
  );
}
