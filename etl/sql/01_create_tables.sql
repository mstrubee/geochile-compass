-- ─────────────────────────────────────────────────────────────────────────────
-- AGROPLANET — Tablas Supabase
-- Ejecutar en Supabase SQL Editor antes de correr el ETL
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Score y variables por comuna (346 filas)
CREATE TABLE IF NOT EXISTS agroplanet_comunas (
  cut                       text PRIMARY KEY,   -- CUT 5 dígitos (ej: "07301")
  nombre                    text NOT NULL,
  region                    text,
  region_id                 text,               -- 2 dígitos (ej: "07")

  -- ── Variables raw (para debugging y calibración futura) ──────────────────
  tractores_x100ha          float,
  ha_frutales_total         float,
  ha_frutales_riego         float,
  ha_cereales_oleaginosas   float,
  pct_predios_grandes       float,  -- % explotaciones >= 20 ha
  num_explot_medianas        float,  -- n° explotaciones 5-50 ha
  diversidad_especies        float,  -- n° especies frutícolas distintas
  ha_suelo_clase_I_II        float,  -- ha suelos capacidad alta (opcional)

  -- ── Variables auxiliares de contexto ─────────────────────────────────────
  total_tractores           int,
  total_explotaciones       int,
  ha_agricola_total         float,
  especie_dominante         text,

  -- ── Scores calculados (0–100) ────────────────────────────────────────────
  score_grandes             float,
  score_indap               float,
  score_combined            float,  -- 0.6 × grandes + 0.4 × indap

  -- ── Quintiles nacionales (1 = más bajo, 5 = más alto) ────────────────────
  quintil_grandes           int,
  quintil_indap             int,
  quintil_combined          int,

  -- ── Metadatos ─────────────────────────────────────────────────────────────
  model_version             text DEFAULT 'v1.0',
  computed_at               timestamptz DEFAULT now()
);

-- Índices útiles para el frontend
CREATE INDEX IF NOT EXISTS idx_agroplanet_comunas_region    ON agroplanet_comunas(region_id);
CREATE INDEX IF NOT EXISTS idx_agroplanet_comunas_q_combined ON agroplanet_comunas(quintil_combined);
CREATE INDEX IF NOT EXISTS idx_agroplanet_comunas_q_grandes  ON agroplanet_comunas(quintil_grandes);

-- RLS: lectura pública (el score es información de negocio, no sensible)
ALTER TABLE agroplanet_comunas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON agroplanet_comunas FOR SELECT USING (true);


-- 2. Pesos del modelo (calibrables sin tocar código)
CREATE TABLE IF NOT EXISTS agroplanet_model_config (
  id            serial PRIMARY KEY,
  variable      text NOT NULL,
  peso_grandes  float NOT NULL,
  peso_indap    float NOT NULL,
  version       text NOT NULL DEFAULT 'v1.0',
  active        boolean NOT NULL DEFAULT false,
  notas         text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE agroplanet_model_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON agroplanet_model_config FOR SELECT USING (true);


-- 3. Competidores (capa geográfica)
CREATE TABLE IF NOT EXISTS agroplanet_competitors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  categoria     text NOT NULL,  -- 'dealer_tractor' | 'repuestos' | 'implementos'
  marca         text,           -- 'John Deere' | 'New Holland' | etc.
  lat           float NOT NULL,
  lng           float NOT NULL,
  cut           text,           -- FK → agroplanet_comunas.cut (nullable)
  region        text,
  direccion     text,
  telefono      text,
  url           text,
  fuente        text NOT NULL DEFAULT 'manual',  -- 'osm' | 'manual' | 'google'
  verified      boolean NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agroplanet_competitors_cut       ON agroplanet_competitors(cut);
CREATE INDEX IF NOT EXISTS idx_agroplanet_competitors_categoria ON agroplanet_competitors(categoria);

ALTER TABLE agroplanet_competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON agroplanet_competitors FOR SELECT USING (true);
