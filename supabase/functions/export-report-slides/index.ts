/**
 * export-report-slides
 * ====================
 * Entrega a leaseflow-pro las 2 láminas del informe de directorio de una
 * isócrona, en PNG, para que las inserte como slides de su Informe Directorio.
 *
 * Por qué PNG y no un .pptx: leaseflow arma su presentación con pptxgenjs, que
 * solo GENERA — no sabe leer un .pptx ni importar láminas de otro archivo. Con
 * imágenes el problema desaparece: las coloca a sangre completa en dos láminas
 * que crea él.
 *
 * ── Semántica de consumo ─────────────────────────────────────────────────────
 * La extracción MARCA `consumed_at`, no borra. Borrar acá haría que un corte de
 * red a mitad de la descarga perdiera las láminas, y regenerarlas obliga al
 * analista a repetir toda la captura de mapas en Geochile. La fila la borra
 * después `cleanup_report_slides()`, que corre por pg_cron a diario:
 *   · consumidas   → se borran a las 48 h (margen para reintentar)
 *   · sin consumir → se borran a los 30 d (a esa altura el informe está viejo)
 *
 * O sea: pedir la misma isócrona dos veces dentro de la ventana devuelve lo
 * mismo. `alreadyConsumed` avisa que no es la primera vez.
 */

import { getAdminClient } from "../_shared/gemini-keys.ts";
import { corsHeaders, json, requireApiKey } from "../_shared/export-auth.ts";

const NO_SLIDES_MSG =
  "Esta isócrona no tiene láminas guardadas. Ábrela en Geochile Compass y usa \"Guardar láminas para leaseflow\".";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const denied = await requireApiKey(req);
  if (denied) return denied;

  let savedIsochroneId: string | undefined;
  try {
    const body = await req.json();
    savedIsochroneId = typeof body?.savedIsochroneId === "string"
      ? body.savedIsochroneId.trim()
      : undefined;
  } catch {
    return json({ error: "body inválido: se espera JSON" }, 400);
  }
  if (!savedIsochroneId) {
    return json({ error: "savedIsochroneId es requerido" }, 400);
  }

  const admin = getAdminClient();
  if (!admin) return json({ error: "service role no configurado" }, 500);

  // Admin client: la tabla tiene RLS por dueño de la isócrona y el caller no es
  // un usuario autenticado de este proyecto.
  const { data: row, error } = await admin
    .from("isochrone_report_slides")
    .select("isochrone_id, slide1_png, slide2_png, generated_at, consumed_at")
    .eq("isochrone_id", savedIsochroneId)
    .maybeSingle();

  if (error) {
    console.error("[export-report-slides] consulta falló", error);
    return json({ error: "error consultando las láminas" }, 500);
  }
  if (!row || !row.slide1_png) {
    return json({ error: NO_SLIDES_MSG }, 422);
  }

  const alreadyConsumed = !!row.consumed_at;

  // Se marca DESPUÉS de tener el contenido en mano, y solo la primera vez para
  // que el TTL se cuente desde la primera entrega y un reintento no lo corra
  // hacia adelante indefinidamente.
  if (!alreadyConsumed) {
    const { error: upErr } = await admin
      .from("isochrone_report_slides")
      .update({ consumed_at: new Date().toISOString() })
      .eq("isochrone_id", savedIsochroneId);
    // Si el marcado falla, igual se entregan: perder la entrega por no poder
    // anotarla sería el peor de los dos resultados. Lo paga el TTL de 30 días.
    if (upErr) console.error("[export-report-slides] no se pudo marcar consumed_at", upErr);
  }

  // Nombre de la isócrona, para que leaseflow titule las láminas.
  const { data: iso } = await admin
    .from("saved_isochrones")
    .select("name")
    .eq("id", savedIsochroneId)
    .maybeSingle();

  return json({
    savedIsochroneId,
    locationName: iso?.name ?? null,
    /** PNG 1920×1080 como data URL. */
    slide1: row.slide1_png,
    /** null si la isócrona no tenía proyección al generarlas. */
    slide2: row.slide2_png ?? null,
    generatedAt: row.generated_at,
    alreadyConsumed,
    consumedAt: row.consumed_at ?? new Date().toISOString(),
  });
});
