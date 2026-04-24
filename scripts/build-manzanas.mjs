#!/usr/bin/env node
/**
 * Pre-procesa el GeoJSON de manzanas del Censo 2017 (RM = R13).
 * Fuente: https://github.com/robsalasco/censo_2017_geojson_chile
 *
 * Pasos:
 *   1. Descarga R13.geojson desde GitHub (raw).
 *   2. Simplifica geometrías (tolerance ~0.00005).
 *   3. Agrupa features por NOM_COMUNA.
 *   4. Escribe public/manzanas/<slug>.geojson para cada comuna.
 *   5. Genera public/manzanas/index.json con bbox + counts.
 *
 * Uso: node scripts/build-manzanas.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import simplify from "@turf/simplify";
import bboxFn from "@turf/bbox";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "manzanas");
const CACHE = path.join(ROOT, ".cache", "R13.geojson");

const SOURCE_URL =
  "https://raw.githubusercontent.com/robsalasco/censo_2017_geojson_chile/master/R13.geojson";

const TOLERANCE = 0.00005; // ~5m
const slugify = (s) =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function ensureSource() {
  if (fs.existsSync(CACHE)) {
    console.log(`[manzanas] cache hit: ${CACHE}`);
    return;
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  console.log(`[manzanas] downloading ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(CACHE));
  console.log(`[manzanas] cached at ${CACHE}`);
}

function normalizeProps(p) {
  // Mantener subset compacto: id, comuna, pop, hogares (viviendas)
  return {
    id: String(p.MANZENT_I ?? p.MANZENT ?? p.ID ?? ""),
    commune: String(p.NOM_COMUNA ?? p.COMUNA ?? "").trim(),
    pop: Number(p.TOTAL_PERS ?? p.PERSONAS ?? 0) || 0,
    hh: Number(p.TOTAL_VIVI ?? p.VIVIENDAS ?? 0) || 0,
  };
}

async function main() {
  await ensureSource();
  console.log(`[manzanas] reading & parsing ...`);
  const raw = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  if (raw.type !== "FeatureCollection") throw new Error("not a FeatureCollection");
  console.log(`[manzanas] features: ${raw.features.length}`);

  // Group by commune
  const byCommune = new Map();
  for (const f of raw.features) {
    if (!f?.geometry || !f?.properties) continue;
    const props = normalizeProps(f.properties);
    if (!props.commune) continue;
    const arr = byCommune.get(props.commune) ?? [];
    arr.push({
      type: "Feature",
      geometry: f.geometry,
      properties: props,
    });
    byCommune.set(props.commune, arr);
  }
  console.log(`[manzanas] communes: ${byCommune.size}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Clean previous outputs
  for (const f of fs.readdirSync(OUT_DIR)) {
    fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const index = [];
  for (const [commune, features] of byCommune) {
    const slug = slugify(commune);
    const fc = { type: "FeatureCollection", features };
    let simplified;
    try {
      simplified = simplify(fc, { tolerance: TOLERANCE, highQuality: false, mutate: false });
    } catch (e) {
      console.warn(`[manzanas] simplify failed for ${commune}: ${e.message} — using raw`);
      simplified = fc;
    }
    const bb = bboxFn(simplified);
    const outPath = path.join(OUT_DIR, `${slug}.geojson`);
    fs.writeFileSync(outPath, JSON.stringify(simplified));
    const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
    console.log(`  · ${commune.padEnd(28)} ${features.length.toString().padStart(6)} feats  ${sizeKb} KB`);
    index.push({
      commune,
      slug,
      file: `${slug}.geojson`,
      count: features.length,
      bbox: bb, // [w, s, e, n]
    });
  }

  index.sort((a, b) => a.commune.localeCompare(b.commune));
  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({ region: "R13 - Metropolitana", source: "INE Censo 2017", communes: index }, null, 2)
  );
  console.log(`[manzanas] wrote ${index.length} commune files + index.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
