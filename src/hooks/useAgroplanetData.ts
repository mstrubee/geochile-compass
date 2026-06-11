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
          for (const r of rows ?? []) {
            // Normalizar CUT a 5 dígitos con ceros a la izquierda
            const cut = String(r.cut).padStart(5, "0");
            m.set(cut, { ...r, cut } as AgroplanetComuna);
          }
          setData(m);
        }
        setLoading(false);
      });
  }, [enabled]);

  return { data, loading, error };
}
