import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DayTraffic {
  day_int:  number;
  day_short: string;
  hours:    number[]; // 24 valores 0-100
  avg:      number;
  peak:     number[];
}

export interface FootTrafficData {
  venue_name: string;
  week:       DayTraffic[];
}

export interface FootTrafficTarget {
  poi_id:        number;
  venue_name:    string;
  venue_address: string;
}

export function useFootTraffic() {
  const [data,    setData]    = useState<FootTrafficData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [noData,  setNoData]  = useState(false);

  const load = useCallback(async (target: FootTrafficTarget) => {
    setLoading(true);
    setData(null);
    setError(null);
    setNoData(false);

    try {
      const { data: res, error: err } = await supabase.functions.invoke("foot-traffic", {
        body: {
          poi_id:        target.poi_id,
          venue_name:    target.venue_name,
          venue_address: target.venue_address,
        },
      });

      if (err) throw new Error(err.message);
      if (res?.error === "not_found") { setNoData(true); return; }
      if (!res?.data) throw new Error("Respuesta inválida del servidor");

      setData(res.data as FootTrafficData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
    setNoData(false);
  }, []);

  return { data, loading, error, noData, load, clear };
}
