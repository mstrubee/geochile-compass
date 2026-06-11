-- ─────────────────────────────────────────────────────────────────────────────
-- AGROPLANET — Pesos del modelo v1.1
-- Sin tractores ni tamaño predial (datos no disponibles en Censo 2021 descargado)
-- Se actualizará a v2.0 con Ridge cuando entren ventas reales.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE agroplanet_model_config SET active = false;

INSERT INTO agroplanet_model_config
  (variable, peso_grandes, peso_indap, version, active, notas)
VALUES
  ('ha_frutales_riego',   0.35, 0.15, 'v1.1', true,
   'Fruticultura intensiva = maquinaria especializada costosa. Mayor peso grandes.'),

  ('ha_cereales_total',   0.20, 0.40, 'v1.1', true,
   'Cereales + cultivos industriales. Principal cultivo INDAP (trigo, avena, raps).'),

  ('ha_vinas_riego',      0.20, 0.05, 'v1.1', true,
   'Viñas = mayor densidad de maquinaria especializada de Chile. Relevante O''Higgins/Maule.'),

  ('diversidad_especies', 0.15, 0.10, 'v1.1', true,
   'N° especies frutícolas distintas por comuna. Proxy de variedad de repuestos necesarios.'),

  ('ha_forrajeras_total', 0.10, 0.30, 'v1.1', true,
   'Forrajeras + praderas. Ganadería mecanizada — clave para INDAP sur (Los Lagos, Los Ríos).');
