#!/usr/bin/env node
/**
 * Pre-procesa el GeoJSON de Grupos Socioeconómicos por manzana.
 *
 * Compatible con dos fuentes:
 *   A) Censo 2012 AMS  → .cache/gse_2012.geojson  (fuente original)
 *   B) Censo 2017 RM   → .cache/gse_2017.geojson  (fuente preferida)
 *
 * El script detecta automáticamente cuál existe y elige la más reciente.
 * Si existen ambas usa 2017.
 *
 * Pasos:
 *   1. Detecta fuente disponible.
 *   2. Normaliza propiedades según el esquema de cada fuente.
 *   3. Deriva la comuna desde el código INE (CODINE / MANZENT / CUT_COM).
 *   4. Simplifica geometrías (~4m tolerancia) y agrupa por comuna.
 *   5. Escribe public/gse/<slug>.geojson + public/gse/index.json.
 *
 * Uso:
 *   node scripts/build-gse.mjs               # detecta automático
 *   node scripts/build-gse.mjs --src 2012    # fuerza 2012
 *   node scripts/build-gse.mjs --src 2017    # fuerza 2017
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import simplify from "@turf/simplify";
import bboxFn from "@turf/bbox";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, ".cache");
const OUT_DIR = path.join(ROOT, "public", "gse");
const TOLERANCE = 0.00004; // ~4m

// ──────────────────────────────────────────────
// Mapa de códigos INE → nombre de comuna (R13 completa)
// Cubre tanto el AMS (Censo 2012) como toda la RM (Censo 2017)
// ──────────────────────────────────────────────
const COMUNA_BY_CODE = {
  "13101": "Santiago",       "13102": "Cerrillos",      "13103": "Cerro Navia",
  "13104": "Conchalí",       "13105": "El Bosque",       "13106": "Estación Central",
  "13107": "Huechuraba",     "13108": "Independencia",   "13109": "La Cisterna",
  "13110": "La Florida",     "13111": "La Granja",       "13112": "La Pintana",
  "13113": "La Reina",       "13114": "Las Condes",      "13115": "Lo Barnechea",
  "13116": "Lo Espejo",      "13117": "Lo Prado",        "13118": "Macul",
  "13119": "Maipú",          "13120": "Ñuñoa",           "13121": "Pedro Aguirre Cerda",
  "13122": "Peñalolén",      "13123": "Providencia",     "13124": "Pudahuel",
  "13125": "Quilicura",      "13126": "Quinta Normal",   "13127": "Recoleta",
  "13128": "Renca",          "13129": "San Joaquín",     "13130": "San Miguel",
  "13131": "San Ramón",      "13132": "Vitacura",
  "13201": "Puente Alto",    "13202": "Pirque",          "13203": "San José de Maipo",
  "13301": "Colina",         "13302": "Lampa",           "13303": "Til Til",
  "13401": "San Bernardo",   "13402": "Buin",            "13403": "Calera de Tango",
  "13404": "Paine",
  "13501": "Melipilla",      "13502": "Alhué",           "13503": "Curacaví",
  "13504": "María Pinto",    "13505": "San Pedro",
  "13601": "Talagante",      "13602": "El Monte",        "13603": "Isla de Maipo",
  "13604": "Padre Hurtado",  "13605": "Peñaflor",
};

const slugify = (s) =>
  s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
   .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ──────────────────────────────────────────────
// Normalización Censo 2012 (esquema AMS original)
// Props: CODINE, CODINE011, GSE_final, quintil, NSE, EDUC, Hacin, etc.
// ──────────────────────────────────────────────
function normalizeProps2012(p) {
  const c1 = String(p.CODINE ?? "").trim();
  const c2 = String(p.CODINE011 ?? "").trim();
  const rawCode = c1.length >= 5 ? c1 : c2.length >= 5 ? c2 : null;
  const code = rawCode?.slice(0, 5) ?? null;
  return {
    id: String(p.CODINE011 ?? p.CODINE ?? p.OBJECTID ?? ""),
    commune: code ? COMUNA_BY_CODE[code] ?? null : null,
    code,
    source_year: 2012,
    gse: p.GSE_final ?? null,
    quintil: p.quintil ?? null,
    nse_score: num(p.NSE),
    educ: num(p.EDUC),
    educ_score: num(p.puntaje_es),
    hacin: num(p.Hacin),
    hacin_class: p.HacinClas ?? null,
    hacin_score: num(p.Hacinpunt),
    auto_score: num(p.puntaje_au),
  };
}

// ──────────────────────────────────────────────
// Normalización Censo 2017 (esquema INE GeoEstadístico)
// Props comunes: CUT_COM, MANZENT, P_TOTAL, TOTAL_HOG, ESCOL_PROM,
//               HACIN_PROM, NSE (si viene procesado), etc.
// Ajustar según el dataset específico que tengas.
// ──────────────────────────────────────────────
function normalizeProps2017(p) {
  // El campo CUT_COM puede venir como número o string de 5 dígitos
  const cutRaw = String(p.CUT_COM ?? p.CUTCOM ?? p.cod_comuna ?? "").trim();
  const code = cutRaw.length === 5 ? cutRaw
    : cutRaw.length === 4 ? "0" + cutRaw
    : cutRaw.length >= 5 ? cutRaw.slice(0, 5)
    : null;

  // El id de manzana: MANZENT es el código completo de 11 dígitos en Censo 2017
  const id = String(p.MANZENT ?? p.ID_MANZANA ?? p.OBJECTID ?? "");

  // GSE derivado: si el dataset ya trae clasificación GSE usarla,
  // si no, derivar desde quintil de ingreso del hogar (P_ING_Q)
  const gseRaw = p.GSE ?? p.GSE_final ?? null;
  const quintilRaw = p.QUINTIL ?? p.quintil ?? p.P_ING_Q ?? null;

  // Escolaridad: campo ESCOL_PROM o P16_PROM (años promedio jefe de hogar)
  const educ = num(p.ESCOL_PROM ?? p.P16_PROM ?? p.EDUC ?? null);

  // Hacinamiento: HACIN_PROM = personas / dormitorios promedio por manzana
  const hacin = num(p.HACIN_PROM ?? p.Hacin ?? null);

  // NSE score: si no viene calculado, aproximar desde escolaridad + hacinamiento
  let nse_score = num(p.NSE_SCORE ?? p.NSE ?? null);
  if (nse_score === null && educ !== null && hacin !== null) {
    // Fórmula simple de referencia (reemplazar con modelo real si disponible)
    const educ_norm = Math.min(Math.max((educ - 4) / 12, 0), 1);
    const hacin_norm = Math.min(Math.max(1 - (hacin - 0.5) / 3, 0), 1);
    nse_score = Math.round((educ_norm * 0.6 + hacin_norm * 0.4) * 1000);
  }

  return {
    id,
    commune: code ? COMUNA_BY_CODE[code] ?? null : null,
    code,
    source_year: 2017,
    gse: gseRaw,
    quintil: quintilRaw ? String(quintilRaw) : null,
    nse_score,
    educ,
    educ_score: null,
    hacin,
    hacin_class: null,
    hacin_score: null,
    auto_score: num(p.AUTO_SCORE ?? p.puntaje_au ?? null),
  };
}

// ──────────────────────────────────────────────
// Detección de fuente
// ──────────────────────────────────────────────
function detectSource(forcedYear) {
  const src2017 = path.join(CACHE, "gse_2017.geojson");
  const src2012 = path.join(CACHE, "gse_2012.geojson");

  if (forcedYear === "2017") {
    if (!fs.existsSync(src2017)) {
      console.error("[gse] --src 2017 solicitado pero .cache/gse_2017.geojson no existe.");
      process.exit(1);
    }
    return { src: src2017, year: 2017, normalize: normalizeProps2017 };
  }
  if (forcedYear === "2012") {
    if (!fs.existsSync(src2012)) {
      console.error("[gse] --src 2012 solicitado pero .cache/gse_2012.geojson no existe.");
      process.exit(1);
    }
    return { src: src2012, year: 2012, normalize: normalizeProps2012 };
  }
  // Auto: preferir 2017
  if (fs.existsSync(src2017)) {
    console.log("[gse] Fuente detectada: Censo 2017 (.cache/gse_2017.geojson)");
    return { src: src2017, year: 2017, normalize: normalizeProps2017 };
  }
  if (fs.existsSync(src2012)) {
    console.warn("[gse] Usando Censo 2012 — considera actualizar a gse_2017.geojson");
    return { src: src2012, year: 2012, normalize: normalizeProps2012 };
  }
  console.error("[gse] No se encontró ninguna fuente GSE en .cache/");
  console.error("[gse] Opciones:");
  console.error("[gse]   .cache/gse_2017.geojson  ← preferida (Censo 2017)");
  console.error("[gse]   .cache/gse_2012.geojson  ← fallback (Censo 2012)");
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const srcIdx = args.indexOf("--src");
  const forcedYear = srcIdx >= 0 ? args[srcIdx + 1] : null;

  const { src, year, normalize } = detectSource(forcedYear);

  console.log(`[gse] Leyendo ${src} ...`);
  const raw = JSON.parse(fs.readFileSync(src, "utf8"));
  if (raw.type !== "FeatureCollection") throw new Error("not a FeatureCollection");
  console.log(`[gse] Features: ${raw.features.length}`);

  const byCommune = new Map();
  let skipped = 0;
  const unknownCodes = new Set();

  for (const f of raw.features) {
    if (!f?.geometry || !f?.properties) { skipped++; continue; }
    const props = normalize(f.properties);
    if (!props.commune) {
      if (props.code) unknownCodes.add(props.code);
      skipped++;
      continue;
    }
    const arr = byCommune.get(props.commune) ?? [];
    arr.push({ type: "Feature", geometry: f.geometry, properties: props });
    byCommune.set(props.commune, arr);
  }

  console.log(`[gse] Comunas: ${byCommune.size}, skipped: ${skipped}`);
  if (unknownCodes.size) console.warn("[gse] Códigos desconocidos:", [...unknownCodes]);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) fs.unlinkSync(path.join(OUT_DIR, f));

  const index = [];
  for (const [commune, features] of byCommune) {
    const slug = slugify(commune);
    const fc = { type: "FeatureCollection", features };
    let simplified;
    try {
      simplified = simplify(fc, { tolerance: TOLERANCE, highQuality: false, mutate: false });
    } catch (e) {
      console.warn(`[gse] simplify falló en ${commune}: ${e.message} — usando raw`);
      simplified = fc;
    }
    const bb = bboxFn(simplified);
    const outPath = path.join(OUT_DIR, `${slug}.geojson`);
    fs.writeFileSync(outPath, JSON.stringify(simplified));
    const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
    console.log(`  · ${commune.padEnd(24)} ${features.length.toString().padStart(6)} feats  ${sizeKb} KB`);
    index.push({ commune, slug, file: `${slug}.geojson`, count: features.length, bbox: bb });
  }

  index.sort((a, b) => a.commune.localeCompare(b.commune));
  const sourceLabel = year === 2017
    ? "Censo 2017 — GSE por manzana (RM)"
    : "Censo 2012 — GSE por manzana (AMS)";

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({ region: "R13", source: sourceLabel, source_year: year, communes: index }, null, 2)
  );
  console.log(`[gse] ✓ ${index.length} archivos de comuna + index.json (fuente: Censo ${year})`);
}

main();
