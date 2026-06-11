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

const COLS = "id,nombre,lat,lng,marca,categoria,cut,region,direccion,telefono,url,fuente,verified";
const PAGE = 1000; // tamaño de página de PostgREST

/** Trae TODOS los registros paginando automáticamente hasta agotar la tabla. */
async function fetchAll(): Promise<AgroplanetCompetitor[]> {
  const all: AgroplanetCompetitor[] = [];
  let from = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("agroplanet_competitors")
      .select(COLS)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);

    all.push(...((rows ?? []) as AgroplanetCompetitor[]));

    // Si vino menos de PAGE registros ya llegamos al final
    if ((rows?.length ?? 0) < PAGE) break;

    from += PAGE;
  }

  return all;
}

export function useAgroplanetCompetitors(enabled: boolean): UseCompetitorsReturn {
  const [data, setData]       = useState<AgroplanetCompetitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchAll()
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled]);

  return { data, loading, error };
}
