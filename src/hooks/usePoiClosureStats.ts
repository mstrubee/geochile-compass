import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchClosureStats,
  type PoiClosureStats,
} from "@/services/poiClosureService";

/**
 * Estadísticas de meses sin operación de los POIs indicados.
 * Ver `poiClosureService` para el criterio (solo los ceros posteriores a la
 * primera venta cuentan como cierre).
 */
export const usePoiClosureStats = (poiIds: string[], enabled = true) => {
  const [stats, setStats] = useState<Map<string, PoiClosureStats>>(new Map());
  const [loading, setLoading] = useState(false);

  // Los arrays cambian de referencia en cada render: la clave estable evita
  // que el efecto se dispare en bucle.
  const idsKey = useMemo(() => [...poiIds].sort().join(","), [poiIds]);

  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (!enabled || ids.length === 0) {
      setStats(new Map());
      return;
    }
    setLoading(true);
    try {
      setStats(await fetchClosureStats(ids));
    } catch {
      setStats(new Map());
    } finally {
      setLoading(false);
    }
  }, [idsKey, enabled]);

  useEffect(() => { void load(); }, [load]);

  return { stats, loading, reload: load };
};
