import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AgroplanetCompetitor {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  marca: string | null;
  categoria: string;
  cut: string | null;
  region: string | null;
  direccion: string | null;
  telefono: string | null;
  url: string | null;
  fuente: string;
  verified: boolean;
}

interface UseCompetitorsReturn {
  data: AgroplanetCompetitor[];
  loading: boolean;
  error: string | null;
}

export function useAgroplanetCompetitors(enabled: boolean): UseCompetitorsReturn {
  const [data, setData]       = useState<AgroplanetCompetitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    supabase
      .from("agroplanet_competitors")
      .select("id,nombre,lat,lng,marca,categoria,cut,region,direccion,telefono,url,fuente,verified")
      .then(({ data: rows, error: err }) => {
        if (err) {
          setError(err.message);
        } else {
          setData((rows ?? []) as AgroplanetCompetitor[]);
        }
        setLoading(false);
      });
  }, [enabled]);

  return { data, loading, error };
}
