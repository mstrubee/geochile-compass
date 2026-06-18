import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFootTraffic } from "@/hooks/useFootTraffic";
import type { FootTrafficTarget } from "@/hooks/useFootTraffic";

const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_H = 60; // px, barra máxima
const MAX_H_HOUR = 72; // px, detalle horario

function barColor(val: number) {
  if (val >= 75) return "#EF4444";
  if (val >= 50) return "#F97316";
  if (val >= 25) return "#FBBF24";
  return "#D1D5DB";
}

interface Props {
  target: FootTrafficTarget | null;
  onClose: () => void;
}

export function FootTrafficPanel({ target, onClose }: Props) {
  const { data, loading, error, noData, load, clear } = useFootTraffic();
  const [selectedDayInt, setSelectedDayInt] = useState<number>(0);

  useEffect(() => {
    if (!target) { clear(); return; }
    // Seleccionar el día actual (JS: 0=Dom → BestTime: 6; JS: 1=Lun → BestTime: 0)
    const jsDay = new Date().getDay();
    setSelectedDayInt((jsDay + 6) % 7);
    load(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const selectedDay = data?.week.find((d) => d.day_int === selectedDayInt);
  // Horas 6am – 11pm (índices 6..22)
  const dayHours = selectedDay?.hours.slice(6, 23) ?? [];
  const HOUR_LABELS = Array.from({ length: 17 }, (_, i) => i + 6); // 6..22

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[300px] overflow-y-auto pb-8">
        <SheetHeader className="pr-6">
          <SheetTitle className="text-sm font-semibold leading-tight">
            {target?.venue_name ?? "Afluencia de público"}
          </SheetTitle>
          {target?.venue_address && (
            <p className="text-[11px] text-muted-foreground leading-tight">
              {target.venue_address}
            </p>
          )}
        </SheetHeader>

        <div className="mt-5 space-y-5">

          {/* ── Loading ───────────────────────────────────────── */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-sm text-muted-foreground">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              <span>Consultando datos de afluencia…</span>
            </div>
          )}

          {/* ── Sin datos ─────────────────────────────────────── */}
          {noData && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground px-2">
              <p className="text-3xl mb-3">📍</p>
              <p className="font-medium">Sin datos de afluencia</p>
              <p className="text-xs mt-2 leading-relaxed">
                Este local no tiene suficientes datos en Google Maps Popular Times o no cuenta con ficha verificada.
              </p>
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────── */}
          {error && !loading && (
            <div className="py-6 text-center text-sm text-destructive px-2">
              <p className="font-medium">Error al obtener datos</p>
              <p className="text-xs mt-1 text-muted-foreground">{error}</p>
            </div>
          )}

          {/* ── Datos ─────────────────────────────────────────── */}
          {data && !loading && (
            <>
              {/* Resumen semanal */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                  Afluencia por día
                </p>
                <div className="flex items-end gap-1.5" style={{ height: MAX_H + 20 }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((dayInt) => {
                    const day = data.week.find((d) => d.day_int === dayInt);
                    const val = day?.avg ?? 0;
                    const isSelected = dayInt === selectedDayInt;
                    const barH = Math.max((val / 100) * MAX_H, 3);
                    return (
                      <button
                        key={dayInt}
                        onClick={() => setSelectedDayInt(dayInt)}
                        className="flex flex-1 flex-col items-center gap-1 group"
                        title={DAYS_SHORT[dayInt]}
                      >
                        <div
                          className={[
                            "w-full rounded-sm transition-all",
                            isSelected
                              ? "ring-2 ring-primary ring-offset-1"
                              : "opacity-70 hover:opacity-100",
                          ].join(" ")}
                          style={{ height: barH, backgroundColor: barColor(val) }}
                        />
                        <span
                          className={[
                            "text-[10px]",
                            isSelected
                              ? "font-bold text-foreground"
                              : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {DAYS_SHORT[dayInt]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Detalle por hora */}
              {selectedDay && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {DAYS_SHORT[selectedDayInt]} · horario
                    </p>
                    {selectedDay.peak.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        Pico: {selectedDay.peak.map((h) => `${h}h`).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-end gap-px" style={{ height: MAX_H_HOUR }}>
                    {dayHours.map((val, i) => {
                      const hour = HOUR_LABELS[i];
                      const barH = Math.max((val / 100) * MAX_H_HOUR, 2);
                      return (
                        <div
                          key={hour}
                          className="flex-1 rounded-sm"
                          style={{ height: barH, backgroundColor: barColor(val) }}
                          title={`${hour}:00 — ${val}%`}
                        />
                      );
                    })}
                  </div>
                  {/* Etiquetas de hora cada 3h */}
                  <div className="flex mt-1">
                    {HOUR_LABELS.map((h, i) => (
                      <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground">
                        {i % 3 === 0 ? `${h}h` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Leyenda de colores */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
                {[
                  { color: "#D1D5DB", label: "Bajo" },
                  { color: "#FBBF24", label: "Moderado" },
                  { color: "#F97316", label: "Alto" },
                  { color: "#EF4444", label: "Pico" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-border/40">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Fuente: Google Maps Popular Times vía BestTime.app. Los valores son relativos al momento más concurrido del local (100 = máxima afluencia histórica).
                </p>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
