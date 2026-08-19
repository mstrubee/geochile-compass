/**
 * scripts/validate-potential-model.ts
 * ──────────────────────────────────
 * Entrena el modelo de potencial en dos pasos con los datos vivos y reporta su
 * exactitud, a qué locales se aplicó y cómo se comporta en los casos conocidos.
 *
 * Vale correrlo cuando entren locales nuevos o meses nuevos: si `looR2` se
 * degrada, el modelo hay que revisarlo antes de seguir usándolo.
 *
 *   npm run validar:potencial
 */
import { createClient } from "@supabase/supabase-js";
import {
  fitPotentialModel,
  estimatePotential,
  distanceKm,
  DEFAULT_POTENTIAL_CONFIG,
  type TrainingStore,
} from "@/services/salesPotentialModel";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}`);
  return v;
};
const MM = (v: number) => `${(v / 1e6).toFixed(1)} MM`;

const main = async (): Promise<void> => {
  const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pois } = await admin
    .from("pois")
    .select("id, name, lat, lng, folder_id")
    .is("deleted_at", null);

  // Ventas: últimos 12 meses por local (paginado).
  const metrics: Array<{ poi_id: string; period: string; value: number }> = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("poi_metrics")
      .select("poi_id, period, value")
      .eq("metric_key", "ventas")
      .order("period", { ascending: false })
      .range(from, from + 999);
    const page = (data ?? []) as typeof metrics;
    metrics.push(...page);
    if (page.length < 1000) break;
  }
  const ventas = new Map<string, number[]>();
  for (const m of metrics) {
    const arr = ventas.get(m.poi_id) ?? [];
    if (arr.length < 12) arr.push(Number(m.value));
    ventas.set(m.poi_id, arr);
  }

  const { data: feats } = await admin.from("poi_features_cache").select("poi_id, features");
  const fById = new Map(
    ((feats ?? []) as Array<{ poi_id: string; features: Record<string, number> | null }>).map((f) => [
      f.poi_id,
      f.features ?? {},
    ]),
  );

  const stores: TrainingStore[] = ((pois ?? []) as Array<{ id: string; name: string; lat: number; lng: number; folder_id: string }>)
    .map((p) => {
      const v = ventas.get(p.id) ?? [];
      const f = fById.get(p.id) ?? {};
      return {
        poiId: p.id,
        name: p.name,
        chainId: p.folder_id,
        lat: Number(p.lat),
        lng: Number(p.lng),
        sales: v.length === 12 ? v.reduce((s, x) => s + x, 0) / 12 : 0,
        vehicles: Number(f.parque_n_vehiculos ?? 0),
        population: Number(f.pop_total ?? 0),
        // Share exclusivo REAL medido por compute-poi-features
        // (pop_exclusive / pop_total). Es lo que en producción llega desde el
        // solape de isócronas; usar 1/(1+vecinos) como proxy castiga demasiado.
        exclusiveShare: Number(f.cannibalization_factor ?? 1),
      };
    })
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)) as Array<
    TrainingStore & { exclusiveShare: number }
  >;

  console.log(`locales con coordenadas: ${stores.length}`);
  console.log(`con 12 meses de venta:   ${stores.filter((s) => s.sales > 0).length}\n`);

  const model = fitPotentialModel(stores, DEFAULT_POTENTIAL_CONFIG);
  if (!model) {
    console.log("No se pudo entrenar: no hay suficientes locales aislados con dato creíble.");
    return;
  }

  console.log("=".repeat(68));
  console.log("PASO 1 — MODELO DE POTENCIAL (entrenado solo con locales aislados)");
  console.log("=".repeat(68));
  console.log(`  locales de entrenamiento:      ${model.accuracy.n}`);
  console.log(`  excluidos por no estar aislados: ${model.excluded.notIsolated.length}`);
  console.log(`  excluidos por parque incompleto: ${model.excluded.brokenParque.length}  [${model.excluded.brokenParque.join(", ")}]`);
  console.log(`  rango de parque entrenado:     ${Math.round(model.vehiclesMin).toLocaleString("es-CL")} a ${Math.round(model.vehiclesMax).toLocaleString("es-CL")} vehículos`);
  console.log(`\n  EXACTITUD (fuera de muestra, leave-one-out):`);
  console.log(`    varianza explicada:  ${(model.accuracy.looR2 * 100).toFixed(1)}%`);
  console.log(`    error medio:         ${MM(model.accuracy.looMae)}`);
  console.log(`    error del promedio:  ${MM(model.accuracy.baselineMae)}  (referencia)`);
  const mejora = (1 - model.accuracy.looMae / model.accuracy.baselineMae) * 100;
  console.log(`    mejora sobre el promedio: ${mejora.toFixed(1)}%`);

  // ── Comportamiento en los casos conocidos ────────────────────────────────
  console.log(`\n${"=".repeat(68)}`);
  console.log("PASO 2 — CASOS CONOCIDOS");
  console.log("=".repeat(68));

  const casos = ["Ovalle", "Santa Rosa", "Departamental", "Buin", "Quilicura"];
  for (const nombre of casos) {
    const s = stores.find((x) => x.name.toLowerCase().includes(nombre.toLowerCase()) && x.sales > 0);
    if (!s) {
      console.log(`\n  ${nombre}: sin datos suficientes`);
      continue;
    }
    // Vecinos propios dentro del radio → cuánto mercado comparte
    const vecinos = stores.filter(
      (o) => o.poiId !== s.poiId && distanceKm(s, o) <= DEFAULT_POTENTIAL_CONFIG.isolationRadiusKm,
    );
    // Share exclusivo medido (pop_exclusive / pop_total), no un reparto en
    // partes iguales: los locales de un cluster no se llevan 1/N cada uno.
    const share = s.exclusiveShare;
    const est = estimatePotential(model, s.vehicles, share);

    console.log(`\n  ${s.name}`);
    console.log(`    parque: ${Math.round(s.vehicles).toLocaleString("es-CL")} vehículos · vecinos propios a <5km: ${vecinos.length}${vecinos.length ? ` (${vecinos.map((v) => v.name).join(", ")})` : ""}`);
    console.log(`    potencial del territorio (paso 1): ${MM(est.potentialUncannibalized)}`);
    console.log(`    tras descontar canibalización:     ${MM(est.estimate)}   (share ${(share * 100).toFixed(0)}%)`);
    console.log(`    VENTA REAL:                        ${MM(s.sales)}`);
    const err = ((est.estimate - s.sales) / s.sales) * 100;
    console.log(`    desvío: ${err >= 0 ? "+" : ""}${err.toFixed(0)}%`);
    if (est.extrapolationNote) console.log(`    ⚠ ${est.extrapolationNote}`);
  }

  // ── El caso Ovalle del reporte: ubicación nueva junto al local existente ──
  console.log(`\n${"=".repeat(68)}`);
  console.log("CASO REAL: ubicación nueva en Ovalle (la que proyectó 170 MM)");
  console.log("=".repeat(68));
  const ovalle = stores.find((x) => x.name.includes("AP0036"));
  if (ovalle) {
    // Una ubicación nueva ahí comparte el mercado con AP0036 y AG Ovalle
    const vecinos = stores.filter((o) => o.poiId !== ovalle.poiId && distanceKm(ovalle, o) <= 5);
    // Una ubicación nueva ahí tendría, como mucho, el share exclusivo que hoy
    // tiene el local existente — y en rigor menos, porque agrega un competidor.
    const share = ovalle.exclusiveShare;
    const est = estimatePotential(model, ovalle.vehicles, share);
    console.log(`  parque de la zona: ${Math.round(ovalle.vehicles).toLocaleString("es-CL")} (⚠ dato incompleto conocido)`);
    console.log(`  locales propios que compartirían el mercado: ${vecinos.length}`);
    console.log(`  potencial del territorio:      ${MM(est.potentialUncannibalized)}`);
    console.log(`  estimación en dos pasos:       ${MM(est.estimate)}`);
    console.log(`  el modelo viejo daba:          170,0 MM`);
    console.log(`  venta real del local que ya opera ahí: ${MM(ovalle.sales)}`);
    if (est.extrapolationNote) console.log(`  ⚠ ${est.extrapolationNote}`);
  }
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
