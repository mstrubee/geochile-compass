import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AgroplanetComuna {
  cut: string;
  nombre: string;
  region: string;
  region_id: string;
  score_combined: number;
  score_grandes: number;
  score_indap: number;
  quintil_combined: number;
  quintil_grandes: number;
  quintil_indap: number;
  ha_frutales_riego: number;
  ha_cereales_total: number;
  ha_vinas_riego: number;
  ha_forrajeras_total: number;
  ha_forestal_total: number | null;   // v2.0 — CAF 2021 §9
  diversidad_especies: number;
  total_explotaciones: number | null; // v2.0 — CAF 2021 §9
  tractores_total: number | null;     // v2.0 — CAF 2021 §13
  macrozona: string | null;
  tipologia: string | null;
}

interface UseAgroplanetDataReturn {
  data: Map<string, AgroplanetComuna>;
  loading: boolean;
  error: string | null;
}

export function useAgroplanetData(enabled: boolean): UseAgroplanetDataReturn {
  const [data, setData] = useState<Map<string, AgroplanetComuna>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    supabase
      .from("agroplanet_comunas")
      .select(
        "cut,nombre,region,region_id,score_combined,score_grandes,score_indap," +
        "quintil_combined,quintil_grandes,quintil_indap," +
        "ha_frutales_riego,ha_cereales_total,ha_vinas_riego,ha_forrajeras_total," +
        "ha_forestal_total,diversidad_especies," +
        "total_explotaciones,tractores_total," +
        "macrozona,tipologia"
      )
      .then(({ data: rows, error: err }) => {
        if (err) {
          setError(err.message);
        } else {
          const m = new Map<string, AgroplanetComuna>();
          for (const r of (rows ?? []) as unknown as Array<Partial<AgroplanetComuna>>) {
            // Normalizar CUT a 5 dígitos con ceros a la izquierda
            const cut = String(r.cut).padStart(5, "0");
            m.set(cut, {
              cut,
              nombre: r.nombre ?? "",
              region: r.region ?? "",
              region_id: r.region_id ?? "",
              score_combined: r.score_combined ?? 0,
              score_grandes: r.score_grandes ?? 0,
              score_indap: r.score_indap ?? 0,
              quintil_combined: r.quintil_combined ?? 0,
              quintil_grandes: r.quintil_grandes ?? 0,
              quintil_indap: r.quintil_indap ?? 0,
              ha_frutales_riego: r.ha_frutales_riego ?? 0,
              ha_cereales_total: r.ha_cereales_total ?? 0,
              ha_vinas_riego: r.ha_vinas_riego ?? 0,
              ha_forrajeras_total: r.ha_forrajeras_total ?? 0,
              ha_forestal_total:   r.ha_forestal_total   ?? null,
              diversidad_especies: r.diversidad_especies ?? 0,
              total_explotaciones: r.total_explotaciones ?? null,
              tractores_total:     r.tractores_total     ?? null,
              macrozona: r.macrozona ?? null,
              tipologia: r.tipologia ?? null,
            });
          }
          setData(m);
        }
        setLoading(false);
      });
  }, [enabled]);

  return { data, loading, error };
}
