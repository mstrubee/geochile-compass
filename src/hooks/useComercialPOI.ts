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
        // 1. Marcas registradas en el catálogo para esta categoría
        const { data: catalogData } = await supabase
          .from("brand_catalog")
          .select("marca_estandar")
          .eq("categoria", categoria)
          .eq("activo", true);

        // 2. Conteos reales desde comercio_poi
        const { data: countData, error } = await supabase
          .rpc("fn_participacion_marcas", { p_categoria: categoria });

        if (cancelled) return;
        if (error) { console.error(error); return; }

        // 3. Mapa de conteos desde POIs
        const countMap = new Map<string, number>();
        for (const r of (countData as Array<{ marca_estandar: string; total_locales: number }> ?? [])) {
          countMap.set(r.marca_estandar, r.total_locales);
        }

        // 4. Base = todas las marcas del catálogo (distintas, sin duplicados)
        const allBrands = new Set<string>();
        for (const r of (catalogData ?? [])) {
          if (r.marca_estandar) allBrands.add(r.marca_estandar);
        }
        // Agregar también marcas que vienen de POIs pero no están en el catálogo (ej. "Otros")
        for (const [m] of countMap) {
          allBrands.add(m);
        }

        // 5. Construir lista final: orden descendente por conteo, "Otros" siempre al final
        const merged: MarcaCount[] = Array.from(allBrands)
          .map((m) => ({ marca_estandar: m, n: countMap.get(m) ?? 0 }))
          .sort((a, b) => {
            if (a.marca_estandar === "Otros") return 1;
            if (b.marca_estandar === "Otros") return -1;
            return b.n - a.n;
          });

        setMarcas(merged);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, categoria]);

  return { marcas, loading };
}
