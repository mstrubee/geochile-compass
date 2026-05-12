// ============================================================================
// scripts/inject-parque-features.ts
// 
// Carga los features de parque generados por preprocess_parque.py
// (archivo parque_features_por_poi.json) y los inyecta dentro del campo
// `features` JSONB de cada fila correspondiente en poi_features_cache.
// 
// Uso (desde la app, en un botón de admin o desde consola):
//   import { injectParqueFeatures } from "@/scripts/inject-parque-features";
//   await injectParqueFeatures();
// 
// El JSON está en /public/parque/parque_features_por_poi.json y debe subirse
// allí como parte del deploy.
// ============================================================================
import { supabase } from "@/integrations/supabase/client";

export async function injectParqueFeatures() {
  console.log("[inject-parque] Iniciando inyección de features de parque…");

  // 1) Bajar el archivo de features
  const res = await fetch("/parque/parque_features_por_poi.json");
  if (!res.ok) throw new Error(`No se pudo leer parque_features_por_poi.json (HTTP ${res.status})`);
  const parqueByPoi: Record<string, Record<string, number | string | null>> = await res.json();
  console.log(`[inject-parque] Cargados features para ${Object.keys(parqueByPoi).length} POIs`);

  // 2) Para cada poi_id en el JSON, leer su fila actual de poi_features_cache,
  //    fusionar el JSONB features y persistir.
  const poiIds = Object.keys(parqueByPoi);
  let updated = 0, notFound = 0, errors = 0;

  // En chunks de 100 para evitar saturar
  const CHUNK = 100;
  for (let i = 0; i < poiIds.length; i += CHUNK) {
    const slice = poiIds.slice(i, i + CHUNK);
    const { data: rows, error } = await supabase
      .from("poi_features_cache")
      .select("poi_id, features")
      .in("poi_id", slice);
    if (error) { console.error(error); errors += slice.length; continue; }

    const found = new Set((rows ?? []).map(r => r.poi_id));
    for (const pid of slice) if (!found.has(pid)) notFound++;

    const updates = (rows ?? []).map(r => {
      const merged = { ...(r.features ?? {}), ...parqueByPoi[r.poi_id] };
      return { poi_id: r.poi_id, features: merged };
    });

    for (const u of updates) {
      const { error: upErr } = await supabase
        .from("poi_features_cache")
        .update({ features: u.features })
        .eq("poi_id", u.poi_id);
      if (upErr) { console.error(upErr); errors++; } else { updated++; }
    }
    console.log(`[inject-parque] Procesados ${Math.min(i + CHUNK, poiIds.length)}/${poiIds.length}`);
  }

  const result = { updated, notFound, errors, total: poiIds.length };
  console.log("[inject-parque] Resumen:", result);
  return result;
}
