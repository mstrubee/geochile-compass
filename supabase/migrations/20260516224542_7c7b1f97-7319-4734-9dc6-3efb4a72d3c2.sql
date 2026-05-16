BEGIN;

TRUNCATE _pois_pre_migration_backup;
TRUNCATE _poi_folders_pre_migration_backup;
TRUNCATE _poi_features_cache_pre_migration_backup;

INSERT INTO _pois_pre_migration_backup SELECT * FROM pois;
INSERT INTO _poi_folders_pre_migration_backup SELECT * FROM poi_folders;
INSERT INTO _poi_features_cache_pre_migration_backup SELECT * FROM poi_features_cache;

INSERT INTO territorial_layer_groups (name, slug, color, icon, order_index)
VALUES
  ('Estaciones de servicio',    'estaciones-servicio',    '#3B82F6', 'fuel',            10),
  ('Farmacias',                  'farmacias',              '#10B981', 'cross',           20),
  ('Supermercados grandes',      'supermercados-grandes',  '#F59E0B', 'shopping-cart',   30),
  ('Supermercados regionales',   'supermercados-regional', '#EAB308', 'shopping-bag',    40),
  ('Tiendas de conveniencia',    'tiendas-conveniencia',   '#A855F7', 'store',           50),
  ('Retail / Tiendas',           'retail',                 '#EC4899', 'shirt',           60),
  ('Servitecas',                 'servitecas',             '#EF4444', 'wrench',          70),
  ('Mejoramiento del hogar',     'mejoramiento-hogar',     '#8B5CF6', 'hammer',          80),
  ('Otros locales',              'otros-locales',          '#64748B', 'package',         90),
  ('Sin clasificar',             'sin-clasificar',         '#9CA3AF', 'help-circle',     100)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Copec','#FF6B00','fuel'),('Shell','#FFD500','fuel'),('Petrobras','#1B7E3D','fuel'),
    ('Terpel','#E20613','fuel'),('Gazel','#0066CC','fuel'),('Shell Helix','#FFD500','fuel'),
    ('Shell (P)','#FFD500','fuel')) AS x(name, color, icon)
WHERE g.slug = 'estaciones-servicio' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Cruz Verde','#00A651','cross'),('FASA','#0066B3','cross'),('Salco Brand','#005EB8','cross'),
    ('Dr. Simi','#FF8C00','cross'),('Galenica','#10B981','cross'),('Knop','#10B981','cross'),
    ('RedFarma','#DC2626','cross'),('Farmax','#10B981','cross'),('Damifar','#10B981','cross')) AS x(name, color, icon)
WHERE g.slug = 'farmacias' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Líder','#FFD500','shopping-cart'),('Jumbo','#00A651','shopping-cart'),
    ('Tottus','#E60028','shopping-cart'),('Unimarc','#0066B3','shopping-cart'),
    ('Acuenta','#FFD500','shopping-cart')) AS x(name, color, icon)
WHERE g.slug = 'supermercados-grandes' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Erbi','#EAB308','shopping-bag'),('Montserrat','#EAB308','shopping-bag'),
    ('Alvi','#EAB308','shopping-bag'),('Mayorista 10','#EAB308','shopping-bag'),
    ('Rabie','#EAB308','shopping-bag'),('Vegamercado','#EAB308','shopping-bag'),
    ('El Trébol','#EAB308','shopping-bag'),('Super Ganga','#EAB308','shopping-bag'),
    ('Central Mayorista','#EAB308','shopping-bag'),('Eltit','#EAB308','shopping-bag'),
    ('Maxiahorro','#EAB308','shopping-bag'),('Casa Amarilla','#EAB308','shopping-bag'),
    ('Supermercado Diez','#EAB308','shopping-bag'),('Maxi K','#EAB308','shopping-bag'),
    ('Supersur','#EAB308','shopping-bag'),('La Colchaguina','#EAB308','shopping-bag')) AS x(name, color, icon)
WHERE g.slug = 'supermercados-regional' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('OXXO','#E50000','store'),('OK Market','#FF6B00','store'),('Ekono','#FFD500','store'),
    ('Pronto Copec','#FF6B00','store'),('Select Shell','#FFD500','store'),
    ('SISA','#A855F7','store'),('Super 10','#A855F7','store')) AS x(name, color, icon)
WHERE g.slug = 'tiendas-conveniencia' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Falabella','#005AAA','shirt'),('Ripley','#E80000','shirt'),('París','#0066B3','shirt'),
    ('Hites','#FF6B00','shirt'),('La Polar','#E50000','shirt'),('ABC-DIN','#E50000','shirt'),
    ('Tricot','#E50000','shirt'),('Dijon','#EC4899','shirt'),('Johnson''s','#0066B3','shirt'),
    ('Corona','#EC4899','shirt'),('Fashion''s Park','#EC4899','shirt'),
    ('Decathlon','#0091D4','shirt'),('Bata','#E50000','shirt')) AS x(name, color, icon)
WHERE g.slug = 'retail' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Good Year','#FFD700','wrench'),('Bosch','#E5202F','wrench'),('Castrol','#00874F','wrench'),
    ('Apex','#EF4444','wrench'),('Lub-Copec','#FF6B00','wrench'),('Lubba','#EF4444','wrench')) AS x(name, color, icon)
WHERE g.slug = 'servitecas' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Sodimac','#0058A3','hammer'),('Easy','#E20613','hammer'),('Construmart','#FF6B00','hammer'),
    ('Imperial','#8B5CF6','hammer'),('Multicentro','#8B5CF6','hammer'),('Punto Maestro','#8B5CF6','hammer'),
    ('Ferrexperto','#8B5CF6','hammer'),('Multihogar','#8B5CF6','hammer')) AS x(name, color, icon)
WHERE g.slug = 'mejoramiento-hogar' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Castaño','#64748B','package'),('Family Shop','#64748B','package'),('Bigger','#64748B','package'),
    ('Ganga','#64748B','package'),('Comer','#64748B','package'),('Del Pacífico','#64748B','package'),
    ('León','#64748B','package'),('Hola','#64748B','package'),('Espoz','#64748B','package'),
    ('El 9','#64748B','package'),('Los Alpes','#64748B','package'),('Dipac','#64748B','package'),
    ('San Camilo','#64748B','package'),('La Fama','#64748B','package'),('El Golf','#64748B','package'),
    ('Condell','#64748B','package'),('Casa Ximena','#64748B','package'),('Cougat','#64748B','package'),
    ('Bryc','#64748B','package'),('La Familia','#64748B','package'),('Fruna','#64748B','package'),
    ('SESA','#64748B','package'),('Yolito','#64748B','package'),('Cordillera','#64748B','package'),
    ('Único','#64748B','package'),('Pendiente Marca','#64748B','package'),('La Oferta','#64748B','package'),
    ('Vyhmeister','#64748B','package'),('Korlaet','#64748B','package'),('Asturias','#64748B','package'),
    ('La Africana','#64748B','package'),('Cantarillani','#64748B','package'),('El Sol','#64748B','package'),
    ('Lily','#64748B','package'),('Marsil','#64748B','package'),('D&M','#64748B','package'),
    ('Belén','#64748B','package'),('Carrera','#64748B','package'),('Romanini','#64748B','package'),
    ('El Inca','#64748B','package'),('El Rancho','#64748B','package')) AS x(name, color, icon)
WHERE g.slug = 'otros-locales' ON CONFLICT DO NOTHING;

INSERT INTO territorial_layers (group_id, name, color, icon)
SELECT g.id, x.name, x.color, x.icon FROM territorial_layer_groups g,
  (VALUES ('Pendiente revisar','#9CA3AF','help-circle')) AS x(name, color, icon)
WHERE g.slug = 'sin-clasificar' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION _migration_target_layer(folder_name TEXT)
RETURNS UUID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE layer_uuid UUID; target_layer_name TEXT; target_group_slug TEXT;
BEGIN
  CASE TRIM(folder_name)
    WHEN 'Copec' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Copec';
    WHEN 'Shell' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Shell';
    WHEN 'Petrobras' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Petrobras';
    WHEN 'Terpel' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Terpel';
    WHEN 'Gazel' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Gazel';
    WHEN 'Shell Helix' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Shell Helix';
    WHEN 'Shell (P)' THEN target_group_slug:='estaciones-servicio'; target_layer_name:='Shell (P)';
    WHEN 'Cruz Verde' THEN target_group_slug:='farmacias'; target_layer_name:='Cruz Verde';
    WHEN 'FASA' THEN target_group_slug:='farmacias'; target_layer_name:='FASA';
    WHEN 'SALCO BRAND' THEN target_group_slug:='farmacias'; target_layer_name:='Salco Brand';
    WHEN 'DR. SIMI' THEN target_group_slug:='farmacias'; target_layer_name:='Dr. Simi';
    WHEN 'GALENICA' THEN target_group_slug:='farmacias'; target_layer_name:='Galenica';
    WHEN 'KNOP' THEN target_group_slug:='farmacias'; target_layer_name:='Knop';
    WHEN 'RedFarma' THEN target_group_slug:='farmacias'; target_layer_name:='RedFarma';
    WHEN 'Farmax' THEN target_group_slug:='farmacias'; target_layer_name:='Farmax';
    WHEN 'Damifar' THEN target_group_slug:='farmacias'; target_layer_name:='Damifar';
    WHEN 'Lider' THEN target_group_slug:='supermercados-grandes'; target_layer_name:='Líder';
    WHEN 'Jumbo' THEN target_group_slug:='supermercados-grandes'; target_layer_name:='Jumbo';
    WHEN 'Tottus' THEN target_group_slug:='supermercados-grandes'; target_layer_name:='Tottus';
    WHEN 'Unimarc' THEN target_group_slug:='supermercados-grandes'; target_layer_name:='Unimarc';
    WHEN 'Lider Bodega Acuenta' THEN target_group_slug:='supermercados-grandes'; target_layer_name:='Acuenta';
    WHEN 'Erbi' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Erbi';
    WHEN 'Montserrat' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Montserrat';
    WHEN 'Alvi' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Alvi';
    WHEN 'Mayorista 10' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Mayorista 10';
    WHEN 'Rabie' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Rabie';
    WHEN 'Vegamercado' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Vegamercado';
    WHEN 'El Trebol' THEN target_group_slug:='supermercados-regional'; target_layer_name:='El Trébol';
    WHEN 'Super Ganga' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Super Ganga';
    WHEN 'Central Mayorista' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Central Mayorista';
    WHEN 'Eltit' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Eltit';
    WHEN 'Maxiahorro' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Maxiahorro';
    WHEN 'Mayorista Casa Amarilla' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Casa Amarilla';
    WHEN 'Supermercado Diez' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Supermercado Diez';
    WHEN 'Maxi K' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Maxi K';
    WHEN 'Supersur' THEN target_group_slug:='supermercados-regional'; target_layer_name:='Supersur';
    WHEN 'Mayorista La Colchaguina' THEN target_group_slug:='supermercados-regional'; target_layer_name:='La Colchaguina';
    WHEN 'OXXO' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='OXXO';
    WHEN 'OK Market' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='OK Market';
    WHEN 'Ekono (Express 400)' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='Ekono';
    WHEN 'PRONTO - COPEC' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='Pronto Copec';
    WHEN 'SELECT (Shell)' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='Select Shell';
    WHEN 'SISA' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='SISA';
    WHEN 'Super 10' THEN target_group_slug:='tiendas-conveniencia'; target_layer_name:='Super 10';
    WHEN 'Falabella' THEN target_group_slug:='retail'; target_layer_name:='Falabella';
    WHEN 'Ripley' THEN target_group_slug:='retail'; target_layer_name:='Ripley';
    WHEN 'París' THEN target_group_slug:='retail'; target_layer_name:='París';
    WHEN 'Hites' THEN target_group_slug:='retail'; target_layer_name:='Hites';
    WHEN 'La Polar' THEN target_group_slug:='retail'; target_layer_name:='La Polar';
    WHEN 'ABC-DIN' THEN target_group_slug:='retail'; target_layer_name:='ABC-DIN';
    WHEN 'Tricot' THEN target_group_slug:='retail'; target_layer_name:='Tricot';
    WHEN 'Dijon' THEN target_group_slug:='retail'; target_layer_name:='Dijon';
    WHEN 'Johnsons' THEN target_group_slug:='retail'; target_layer_name:='Johnson''s';
    WHEN 'Corona' THEN target_group_slug:='retail'; target_layer_name:='Corona';
    WHEN 'Fashions Park' THEN target_group_slug:='retail'; target_layer_name:='Fashion''s Park';
    WHEN 'Decathlon' THEN target_group_slug:='retail'; target_layer_name:='Decathlon';
    WHEN 'Bata' THEN target_group_slug:='retail'; target_layer_name:='Bata';
    WHEN 'Good Year' THEN target_group_slug:='servitecas'; target_layer_name:='Good Year';
    WHEN 'Bosch' THEN target_group_slug:='servitecas'; target_layer_name:='Bosch';
    WHEN 'Castrol' THEN target_group_slug:='servitecas'; target_layer_name:='Castrol';
    WHEN 'Apex' THEN target_group_slug:='servitecas'; target_layer_name:='Apex';
    WHEN 'Lub - Copec' THEN target_group_slug:='servitecas'; target_layer_name:='Lub-Copec';
    WHEN 'Lubba' THEN target_group_slug:='servitecas'; target_layer_name:='Lubba';
    WHEN 'Sodimac - Homecenter' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Sodimac';
    WHEN 'Easy' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Easy';
    WHEN 'Construmart' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Construmart';
    WHEN 'Imperial' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Imperial';
    WHEN 'Multicentro' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Multicentro';
    WHEN 'Punto Maestro' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Punto Maestro';
    WHEN 'Ferrexperto' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Ferrexperto';
    WHEN 'Multihogar' THEN target_group_slug:='mejoramiento-hogar'; target_layer_name:='Multihogar';
    WHEN 'Castaño' THEN target_group_slug:='otros-locales'; target_layer_name:='Castaño';
    WHEN 'Family Shop' THEN target_group_slug:='otros-locales'; target_layer_name:='Family Shop';
    WHEN 'Bigger' THEN target_group_slug:='otros-locales'; target_layer_name:='Bigger';
    WHEN 'Ganga' THEN target_group_slug:='otros-locales'; target_layer_name:='Ganga';
    WHEN 'Comer' THEN target_group_slug:='otros-locales'; target_layer_name:='Comer';
    WHEN 'Del Pacifico' THEN target_group_slug:='otros-locales'; target_layer_name:='Del Pacífico';
    WHEN 'Leon' THEN target_group_slug:='otros-locales'; target_layer_name:='León';
    WHEN 'Hola!' THEN target_group_slug:='otros-locales'; target_layer_name:='Hola';
    WHEN 'Espoz' THEN target_group_slug:='otros-locales'; target_layer_name:='Espoz';
    WHEN 'El 9' THEN target_group_slug:='otros-locales'; target_layer_name:='El 9';
    WHEN 'Los Alpes' THEN target_group_slug:='otros-locales'; target_layer_name:='Los Alpes';
    WHEN 'Dipac' THEN target_group_slug:='otros-locales'; target_layer_name:='Dipac';
    WHEN 'San Camilo' THEN target_group_slug:='otros-locales'; target_layer_name:='San Camilo';
    WHEN 'La Fama' THEN target_group_slug:='otros-locales'; target_layer_name:='La Fama';
    WHEN 'El Golf' THEN target_group_slug:='otros-locales'; target_layer_name:='El Golf';
    WHEN 'Condell' THEN target_group_slug:='otros-locales'; target_layer_name:='Condell';
    WHEN 'Casa Ximena' THEN target_group_slug:='otros-locales'; target_layer_name:='Casa Ximena';
    WHEN 'Cougat' THEN target_group_slug:='otros-locales'; target_layer_name:='Cougat';
    WHEN 'Bryc' THEN target_group_slug:='otros-locales'; target_layer_name:='Bryc';
    WHEN 'La Familia' THEN target_group_slug:='otros-locales'; target_layer_name:='La Familia';
    WHEN 'Fruna' THEN target_group_slug:='otros-locales'; target_layer_name:='Fruna';
    WHEN 'SESA' THEN target_group_slug:='otros-locales'; target_layer_name:='SESA';
    WHEN 'Yolito' THEN target_group_slug:='otros-locales'; target_layer_name:='Yolito';
    WHEN 'Cordillera' THEN target_group_slug:='otros-locales'; target_layer_name:='Cordillera';
    WHEN 'Unico' THEN target_group_slug:='otros-locales'; target_layer_name:='Único';
    WHEN 'Pendiente Marca' THEN target_group_slug:='otros-locales'; target_layer_name:='Pendiente Marca';
    WHEN 'La Oferta' THEN target_group_slug:='otros-locales'; target_layer_name:='La Oferta';
    WHEN 'VYHMEISTER' THEN target_group_slug:='otros-locales'; target_layer_name:='Vyhmeister';
    WHEN 'Korlaet' THEN target_group_slug:='otros-locales'; target_layer_name:='Korlaet';
    WHEN 'Asturias' THEN target_group_slug:='otros-locales'; target_layer_name:='Asturias';
    WHEN 'La Africana' THEN target_group_slug:='otros-locales'; target_layer_name:='La Africana';
    WHEN 'Cantarillani' THEN target_group_slug:='otros-locales'; target_layer_name:='Cantarillani';
    WHEN 'El Sol' THEN target_group_slug:='otros-locales'; target_layer_name:='El Sol';
    WHEN 'Lily' THEN target_group_slug:='otros-locales'; target_layer_name:='Lily';
    WHEN 'Marsil' THEN target_group_slug:='otros-locales'; target_layer_name:='Marsil';
    WHEN 'D&M Distribuidora' THEN target_group_slug:='otros-locales'; target_layer_name:='D&M';
    WHEN 'Belen' THEN target_group_slug:='otros-locales'; target_layer_name:='Belén';
    WHEN 'Carrera' THEN target_group_slug:='otros-locales'; target_layer_name:='Carrera';
    WHEN 'Romanini' THEN target_group_slug:='otros-locales'; target_layer_name:='Romanini';
    WHEN 'El Inca' THEN target_group_slug:='otros-locales'; target_layer_name:='El Inca';
    WHEN 'El Rancho' THEN target_group_slug:='otros-locales'; target_layer_name:='El Rancho';
    ELSE target_group_slug:='sin-clasificar'; target_layer_name:='Pendiente revisar';
  END CASE;
  SELECT tl.id INTO layer_uuid FROM territorial_layers tl
    JOIN territorial_layer_groups tlg ON tlg.id = tl.group_id
    WHERE tlg.slug = target_group_slug AND tl.name = target_layer_name LIMIT 1;
  RETURN layer_uuid;
END;$$;

INSERT INTO territorial_features (layer_id, external_id, name, lat, lng, geometry, properties)
SELECT _migration_target_layer(pf.name), p.id::text, p.name, p.lat, p.lng,
  jsonb_build_object('type','Point','coordinates',jsonb_build_array(p.lng, p.lat)),
  jsonb_build_object('source_folder', pf.name, 'imported_at', now()::text, 'original_poi_id', p.id::text)
FROM pois p JOIN poi_folders pf ON pf.id = p.folder_id
WHERE pf.name NOT IN ('Autoplanet', 'Agroplanet')
  AND _migration_target_layer(pf.name) IS NOT NULL;

DELETE FROM poi_features_cache WHERE poi_id IN (
  SELECT p.id FROM pois p JOIN poi_folders pf ON pf.id = p.folder_id
  WHERE pf.name NOT IN ('Autoplanet', 'Agroplanet'));

DELETE FROM pois WHERE folder_id IN (SELECT id FROM poi_folders WHERE name NOT IN ('Autoplanet', 'Agroplanet'));
DELETE FROM poi_folders WHERE name NOT IN ('Autoplanet', 'Agroplanet');

UPDATE territorial_layers tl SET feature_count = sub.cnt, bbox = sub.bbox
FROM (SELECT layer_id, COUNT(*) AS cnt,
  jsonb_build_array(MIN(lng), MIN(lat), MAX(lng), MAX(lat)) AS bbox
  FROM territorial_features GROUP BY layer_id) sub
WHERE tl.id = sub.layer_id;

DELETE FROM territorial_layers
WHERE id NOT IN (SELECT DISTINCT layer_id FROM territorial_features)
  AND id NOT IN (SELECT tl.id FROM territorial_layers tl
    JOIN territorial_layer_groups tlg ON tlg.id = tl.group_id
    WHERE tlg.slug = 'sin-clasificar');

DROP FUNCTION IF EXISTS _migration_target_layer(TEXT);

INSERT INTO _migration_log (sprint, notes) VALUES ('Sprint 3', 'Wholesale migration pois → territorial_features (Servitecas)');

COMMIT;