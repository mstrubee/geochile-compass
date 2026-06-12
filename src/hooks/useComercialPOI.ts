/**
 * useComercialPOI
 * ────────────────
 * Carga POIs de la tabla comercio_poi filtrando por categoría.
 * Paginación automática (igual que useAgroplanetCompetitors) para no
 * quedar limitado por el default de 1000 rows de PostgREST.
 *
 * El hook solo carga datos cuando `enabled = true` y usa un viewport
 * opcional (bbox) para cargar solo los POIs visibles en el mapa.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ComercialCategoria, ComercialPOI } from "@/types/comercial";

interface Options {
  /** Bbox del viewport actual: [sur, oeste, norte, este] */
  bbox?: [number, number, number, number] | null;
  /** Limitar a esta marca normalizada */
  marca?: string | null;
  /** Página máxima de registros (para evitar cargas masivas) */
  maxRecords?: number;
}

interface UseComercialPOIReturn {
  data: ComercialPOI[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  reload: () => void;
}

const PAGE = 1000;

async function fetchPOIs(
  categoria: ComercialCategoria,
  options: Options,
  signal: AbortSignal,
): Promise<ComercialPOI[]> {
  const all: ComercialPOI[] = [];
  let from = 0;
  const max = options.maxRecords ?? 20_000;

  while (all.length < max) {
    let q = supabase
      .from("comercio_poi")
      .select(
        "id,osm_id,nombre,marca,marca_estandar,categoria,subcategoria,cadena," +
        "direccion,comuna,region,latitud,longitud,fuente,fecha_actualizacion",
      )
      .eq("categoria", categoria)
      .eq("eliminado", false)
      .range(from, from + PAGE - 1)
      .order("id");

    if (options.marca) {
      q = q.eq("marca_estandar", options.marca);
    }

    if (options.bbox) {
      const [s, w, n, e] = options.bbox;
      q = q
        .gte("latitud", s)
        .lte("latitud", n)
        .gte("longitud", w)
        .lte("longitud", e);
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    if (!rows?.length) break;

    all.push(...(rows as unknown as ComercialPOI[]));
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

export function useComercialPOI(
  categoria: ComercialCategoria,
  enabled: boolean,
  options: Options = {},
): UseComercialPOIReturn {
  const [data, setData]         = useState<ComercialPOI[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [version, reload]       = useReducer((x: number) => x + 1, 0);

  // Serializar opciones para detectar cambios reales
  const optKey = JSON.stringify([
    options.bbox ?? null,
    options.marca ?? null,
    options.maxRecords ?? null,
  ]);
  const optKeyRef = useRef(optKey);
  optKeyRef.current = optKey;

  useEffect(() => {
    if (!enabled) {
      setData([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchPOIs(categoria, options, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setData(rows);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError" && !controller.signal.aborted) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, categoria, optKey, version]);

  return { data, loading, error, totalCount: data.length, reload };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: logos por marca (para iconos en el mapa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carga un Map<marca_estandar, logo_url> con todas las marcas que tienen logo.
 * Se usa en ComercialPOILayer para reemplazar el emoji por el logo en el marcador.
 */
export function useBrandLogos(): Map<string, string> {
  const [logos, setLogos] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("brand_catalog")
        .select("marca_estandar, logo_url")
        .not("logo_url", "is", null);
      if (cancelled || !data) return;
      const map = new Map<string, string>();
      for (const row of data as { marca_estandar: string; logo_url: string }[]) {
        if (row.logo_url) map.set(row.marca_estandar, row.logo_url);
      }
      setLogos(map);
    })();
    return () => { cancelled = true; };
  }, []);

  return logos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook para resumen por marca (para el panel flotante)
// ─────────────────────────────────────────────────────────────────────────────

interface MarcaCount { marca_estandar: string; n: number }

export function useComercialMarcas(
  categoria: ComercialCategoria,
  enabled: boolean,
): { marcas: MarcaCount[]; loading: boolean } {
  const [marcas, setMarcas]   = useState<MarcaCount[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setMarcas([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // fn_marcas_categoria: devuelve catálogo + conteos en una sola query
        // (catálogo como base → marcas con 0 POIs aparecen; POIs sin catálogo → también)
        const { data, error } = await supabase
          .rpc("fn_marcas_categoria", { p_categoria: categoria });

        if (cancelled) return;

        if (error) {
          // Fallback: solo POIs reales si la función nueva no existe aún
          console.warn("fn_marcas_categoria no disponible, usando fallback:", error.message);
          const { data: fallback, error: fbErr } = await supabase
            .rpc("fn_participacion_marcas", { p_categoria: categoria });
          if (cancelled) return;
          if (fbErr) { console.error(fbErr); return; }
          setMarcas(
            (fallback as Array<{ marca_estandar: string; total_locales: number }> ?? [])
              .map((r) => ({ marca_estandar: r.marca_estandar, n: r.total_locales })),
          );
          return;
        }

        // Resultado de fn_marcas_categoria: ya viene ordenado por total desc
        // Solo mover "Otros" al final por convención visual
        const rows = (data as Array<{ marca_estandar: string; total_locales: number }> ?? [])
          .map((r) => ({ marca_estandar: r.marca_estandar, n: Number(r.total_locales) }));

        const otros   = rows.filter((r) => r.marca_estandar === "Otros");
        const normales = rows.filter((r) => r.marca_estandar !== "Otros");
        setMarcas([...normales, ...otros]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, categoria]);

  return { marcas, loading };
}
