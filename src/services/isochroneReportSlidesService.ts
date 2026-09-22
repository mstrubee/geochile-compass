import { supabase } from "@/integrations/supabase/client";

/**
 * Caché de las 2 láminas del informe de directorio, en PNG, para que
 * leaseflow-pro las extraiga por API y las use como slides propias.
 *
 * Es una caché deliberadamente efímera: leaseflow las borra al consumirlas.
 * Por eso la tabla es un `upsert` por isócrona —regenerar pisa lo anterior en
 * vez de acumular— y por eso el panel muestra siempre si hay algo guardado:
 * sin esa señal el analista no tendría cómo saber si leaseflow ya se las llevó.
 */

const TABLE = "isochrone_report_slides";

export interface StoredReportSlides {
  isochroneId: string;
  /** PNG como data URL. */
  slide1: string;
  slide2: string | null;
  generatedAt: string;
}

const toStored = (r: any): StoredReportSlides => ({
  isochroneId: r.isochrone_id,
  slide1: r.slide1_png,
  slide2: r.slide2_png ?? null,
  generatedAt: r.generated_at,
});

/** Láminas guardadas de una isócrona, o null si no hay. */
export const fetchReportSlides = async (
  isochroneId: string,
): Promise<StoredReportSlides | null> => {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select("*")
    .eq("isochrone_id", isochroneId)
    .maybeSingle();
  if (error) throw error;
  return data ? toStored(data) : null;
};

/**
 * Metadatos sin el contenido, para saber si hay láminas sin traerse ~1 MB de
 * base64 cada vez que se abre el panel.
 */
export const fetchReportSlidesMeta = async (
  isochroneId: string,
): Promise<{ generatedAt: string; hasSlide2: boolean } | null> => {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select("generated_at, slide2_png")
    .eq("isochrone_id", isochroneId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return { generatedAt: r.generated_at, hasSlide2: !!r.slide2_png };
};

/** true si el error es de sesión vencida/RLS, no un problema real de datos. */
const isAuthError = (e: unknown): boolean => {
  const err = e as { code?: string; status?: number } | null;
  return err?.code === "42501" || err?.status === 401;
};

/**
 * Guarda (o reemplaza) las láminas de una isócrona.
 *
 * Generar un informe implica calibrar el mapa y revisar la vista previa, que
 * puede tomar varios minutos — tiempo suficiente para que el token de sesión
 * venza. El cliente lo renueva solo en segundo plano, pero un tab en background
 * puede atrasarse, y entonces el guardado fallaba con un genérico "no se pudo
 * guardar" sin explicar por qué. Ahora, si el primer intento falla por sesión
 * vencida, se refresca y se reintenta una vez antes de darlo por fallado.
 */
export const saveReportSlides = async (params: {
  isochroneId: string;
  slide1: string;
  slide2: string | null;
}): Promise<StoredReportSlides> => {
  const write = () =>
    supabase
      .from(TABLE as never)
      .upsert(
        {
          isochrone_id: params.isochroneId,
          slide1_png: params.slide1,
          slide2_png: params.slide2,
          generated_at: new Date().toISOString(),
        } as never,
        { onConflict: "isochrone_id" },
      )
      .select()
      .single();

  let { data, error } = await write();
  if (error && isAuthError(error)) {
    await supabase.auth.refreshSession();
    ({ data, error } = await write());
  }
  if (error) {
    if (isAuthError(error)) {
      throw new Error("Tu sesión venció mientras preparabas el informe. Vuelve a iniciar sesión e inténtalo de nuevo.");
    }
    throw error;
  }
  return toStored(data);
};

/** Borra las láminas guardadas de una isócrona. */
export const deleteReportSlides = async (isochroneId: string): Promise<void> => {
  const { error } = await supabase
    .from(TABLE as never)
    .delete()
    .eq("isochrone_id", isochroneId);
  if (error) throw error;
};
