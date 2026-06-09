-- ─────────────────────────────────────────────────────────────────────────────
-- AGROPLANET — Pesos iniciales del modelo (v1.0, subjetivos)
-- Se reemplazarán por v2.0 calibrados con Ridge cuando entren ventas reales.
-- ─────────────────────────────────────────────────────────────────────────────

-- Desactivar versiones anteriores si existen
UPDATE agroplanet_model_config SET active = false WHERE version = 'v1.0';

INSERT INTO agroplanet_model_config
  (variable, peso_grandes, peso_indap, version, active, notas)
VALUES
  ('tractores_x100ha',        0.30, 0.35, 'v1.0', true,
   'Señal directa de demanda. Censo 2021. Mayor peso INDAP porque tracción = herramienta principal.'),

  ('ha_frutales_riego',       0.20, 0.10, 'v1.0', true,
   'Fruticultura intensiva = maquinaria especializada y costosa. Menos relevante para INDAP.'),

  ('ha_cereales_oleaginosas', 0.15, 0.30, 'v1.0', true,
   'Cubre zona sur (Ñuble, Biobío, Araucanía) no capturada por Catastro Frutícola.'),

  ('pct_predios_grandes',     0.20, 0.05, 'v1.0', true,
   '% explot ≥20ha. Fundos grandes = maquinaria propia = mayor gasto en repuestos.'),

  ('num_explot_medianas',     0.05, 0.15, 'v1.0', true,
   'Explot 5-50ha. Núcleo del cliente INDAP: compra frecuente, fidelizable.'),

  ('diversidad_especies',     0.05, 0.00, 'v1.0', true,
   'Mix de especies → mix de repuestos. Valor para catálogo, no para volumen.'),

  ('ha_suelo_clase_I_II',     0.05, 0.05, 'v1.0', true,
   'Proxy de inversión agrícola histórica. Peso bajo: redundante con otras variables.');
