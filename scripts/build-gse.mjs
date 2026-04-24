#!/usr/bin/env node
/**
 * Pre-procesa el GeoJSON "Grupos socioeconómicos por manzana — Censo 2012, AMS".
 *
 * Pasos:
 *   1. Lee .cache/gse_2012.geojson (debe existir; copiar manualmente).
 *   2. Normaliza propiedades (GSE_final, quintil, EDUC, Hacin, NSE, puntajes).
 *   3. Deriva la comuna desde CODINE/CODINE011[:5] usando COMUNA_BY_CODE.
 *   4. Simplifica geometrías y agrupa por comuna.
 *   5. Escribe public/gse/<slug>.geojson + public/gse/index.json.
 *
 * Uso: node scripts/build-gse.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import simplify from "@turf/simplify";
import bboxFn from "@turf/bbox";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, ".cache", "gse_2012.geojson");
const OUT_DIR = path.join(ROOT, "public", "gse");

const TOLERANCE = 0.00004; // ~4m

// Códigos INE comuna (5 dígitos) → nombre. Cubre las comunas presentes en el dataset (R13).
const COMUNA_BY_CODE = {
  "13101": "Santiago",
  "13102": "Cerrillos",
  "13103": "Cerro Navia",
  "13104": "Conchalí",
  "13105": "El Bosque",
  "13106": "Estación Central",
  "13107": "Huechuraba",
  "13108": "Independencia",
  "13109": "La Cisterna",
  "13110": "La Florida",
  "13111": "La Granja",
  "13112": "La Pintana",
  "13113": "La Reina",
  "13114": "Las Condes",
  "13115": "Lo Barnechea",
  "13116": "Lo Espejo",
  "13117": "Lo Prado",
  "13118": "Macul",
  "13119": "Maipú",
  "13120": "Ñuñoa",
  "13121": "Pedro Aguirre Cerda",
  "13122": "Peñalolén",
  "13123": "Providencia",
  "13124": "Pudahuel",
  "13125": "Quilicura",
  "13126": "Quinta Normal",
  "13127": "Recoleta",
  "13128": "Renca",
  "13129": "San Joaquín",
  "13130": "San Miguel",
  "13131": "San Ramón",
  "13132": "Vitacura",
  "13201": "Puente Alto",
  "13202": "Pirque",
  "13203": "San José de Maipo",
  "13301": "Colina",
  "13302": "Lampa",
  "13303": "Tiltil",
  "13401": "San Bernardo",
  "13402": "Buin",
  "13403": "Calera de Tango",
  "13404": "Paine",
  "13501": "Melipilla",
  "13502": "Alhué",
  "13503": "Curacaví",
  "13504": "María Pinto",
  "13505": "San Pedro",
  "13601": "Talagante",
  "13602": "El Monte",
  "13603": "Isla de Maipo",
  "13604": "Padre Hurtado",
  "13605": "Peñaflor",
};

const slugify = (s) =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function deriveCommuneCode(p) {
  const c1 = String(p.CODINE ?? "").trim();
  if (c1 && c1.length >= 5) return c1.slice(0, 5);
  const c2 = String(p.CODINE011 ?? "").trim();
  if (c2 && c2.length >= 5) return c2.slice(0, 5);
  return null;
}

function normalizeProps(p) {
  const code = deriveCommuneCode(p);
  const commune = code ? COMUNA_BY_CODE[code] ?? null : null;
  return {
    id: String(p.CODINE011 ?? p.CODINE ?? p.OBJECTID ?? ""),
    commune,
    code,
    gse: p.GSE_final ?? null,         // "ABC1" | "C1" | "C2" | "C3" | "D" | "E"
    quintil: p.quintil ?? null,       // "Q1".."Q5"
    nse_score: num(p.NSE),            // 0–1000 (puntaje continuo)
    educ: num(p.EDUC),                // años de escolaridad promedio
    educ_score: num(p.puntaje_es),
    hacin: num(p.Hacin),              // hab/dorm
    hacin_class: p.HacinClas ?? null,
    hacin_score: num(p.Hacinpunt),
    auto_score: num(p.puntaje_au),
  };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[gse] missing source: ${SRC}`);
    console.error(`[gse] copy the uploaded GeoJSON to .cache/gse_2012.geojson`);
    process.exit(1);
  }
  console.log(`[gse] reading ${SRC} ...`);
  const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
  if (raw.type !== "FeatureCollection") throw new Error("not a FeatureCollection");
  console.log(`[gse] features: ${raw.features.length}`);

  const byCommune = new Map();
  let skipped = 0;
  const unknownCodes = new Set();
  for (const f of raw.features) {
    if (!f?.geometry || !f?.properties) { skipped++; continue; }
    const props = normalizeProps(f.properties);
    if (!props.commune) {
      if (props.code) unknownCodes.add(props.code);
      skipped++;
      continue;
    }
    const arr = byCommune.get(props.commune) ?? [];
    arr.push({ type: "Feature", geometry: f.geometry, properties: props });
    byCommune.set(props.commune, arr);
  }
  console.log(`[gse] communes: ${byCommune.size}, skipped: ${skipped}`);
  if (unknownCodes.size) console.warn(`[gse] unknown codes:`, [...unknownCodes]);

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
      console.warn(`[gse] simplify failed for ${commune}: ${e.message} — using raw`);
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
  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      { region: "R13 - AMS", source: "Censo 2012 — GSE por manzana", communes: index },
      null,
      2
    )
  );
  console.log(`[gse] wrote ${index.length} commune files + index.json`);
}

main();
