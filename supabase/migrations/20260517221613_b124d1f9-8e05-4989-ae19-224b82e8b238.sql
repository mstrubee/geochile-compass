DO $mig$
DECLARE
  v_reasignados int := 0;
  v_consolidados int := 0;
  v_residual int;
  v_tmp int;
BEGIN
  -- Guard idempotencia
  IF EXISTS (SELECT 1 FROM public._migration_log WHERE sprint='cleanup_sin_clasificar_20260517' AND notes='done') THEN
    RAISE NOTICE 'Migracion ya aplicada, saliendo';
    RETURN;
  END IF;

  -- PASO 1: CREAR CAPAS NUEVAS
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Cruz Verde', '#10B981', 'icons', 10 FROM territorial_layer_groups WHERE slug='farmacias'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Otras farmacias', '#EF4444', 'icons', 99 FROM territorial_layer_groups WHERE slug='farmacias'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Fullfresh', '#10B981', 'icons', 20 FROM territorial_layer_groups WHERE slug='supermercados-regional'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Keymarket', '#10B981', 'icons', 30 FROM territorial_layer_groups WHERE slug='supermercados-regional'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Tucapel', '#10B981', 'icons', 40 FROM territorial_layer_groups WHERE slug='supermercados-regional'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Otros supermercados', '#10B981', 'icons', 99 FROM territorial_layer_groups WHERE slug='supermercados-regional'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Bencineras genéricas', '#3B82F6', 'icons', 99 FROM territorial_layer_groups WHERE slug='estaciones-servicio'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Gasco', '#F59E0B', 'icons', 50 FROM territorial_layer_groups WHERE slug='estaciones-servicio'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Abastible', '#F59E0B', 'icons', 51 FROM territorial_layer_groups WHERE slug='estaciones-servicio'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Bridgestone', '#EF4444', 'icons', 10 FROM territorial_layer_groups WHERE slug='servitecas'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Michelin', '#EF4444', 'icons', 20 FROM territorial_layer_groups WHERE slug='servitecas'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Pirelli', '#EF4444', 'icons', 30 FROM territorial_layer_groups WHERE slug='servitecas'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Servitecas genéricas', '#EF4444', 'icons', 99 FROM territorial_layer_groups WHERE slug='servitecas'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Ferreterías independientes', '#F59E0B', 'icons', 99 FROM territorial_layer_groups WHERE slug='mejoramiento-hogar'
  ON CONFLICT DO NOTHING;
  INSERT INTO territorial_layers (group_id, name, color, render_mode, order_index)
  SELECT id, 'Distribuidoras', '#6B7280', 'icons', 99 FROM territorial_layer_groups WHERE slug='otros-locales'
  ON CONFLICT DO NOTHING;

  -- PASO 2: REASIGNACIONES desde Sin clasificar
  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='farmacias' AND tl.name='Cruz Verde')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'cruz verde%' OR tf.name='Cruz verde');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='farmacias' AND tl.name='Otras farmacias')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ~ '^F [A-Z]' OR tf.name='F del Formulario' OR tf.name ~ '^F\. '
         OR tf.name ILIKE 'farmacia%' OR tf.name ILIKE 'farmared%' OR tf.name ILIKE 'farmvital%'
         OR tf.name ILIKE 'farmax%' OR tf.name ILIKE 'dr%ahorro%' OR tf.name ILIKE 'galeno%'
         OR tf.name ILIKE 'nova salud%' OR tf.name ILIKE 'nva francesa%' OR tf.name ILIKE 'scandic%'
         OR tf.name ILIKE 'su farmacia%');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-grandes' AND tl.name='Unimarc')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'bigger%' OR tf.name='BIGGER' OR tf.name ILIKE 'unimarc%' OR UPPER(tf.name)='DECA');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-grandes' AND tl.name='Jumbo')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name ILIKE 'jumbo%';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Fullfresh')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'fullfresh%' OR tf.name ILIKE 'full fresh%' OR tf.name='SM Fullfresh');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Keymarket')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name ILIKE 'keymarket%';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Tucapel')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name ILIKE 'tucapel%';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Otros supermercados')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'sm %' OR tf.name ILIKE 'sm.%' OR tf.name ILIKE 'super %' OR tf.name ILIKE 'supermercado%'
         OR tf.name ILIKE 'supereconómico%' OR tf.name ILIKE 'suoer%' OR tf.name ILIKE 'mayorista%'
         OR tf.name ILIKE 'mega ahorro%' OR tf.name ILIKE 'híper kor%' OR tf.name ILIKE 'lider%'
         OR tf.name='AHORREMAS' OR tf.name='ApexMarket' OR tf.name='Burbuja' OR tf.name='Eltit'
         OR tf.name='El Oso' OR tf.name='El Porvenir' OR tf.name ILIKE 'embeka%'
         OR tf.name='Ex oriente' OR tf.name='Kamadi' OR tf.name='La Catedral'
         OR tf.name ILIKE 'la italiana%' OR tf.name='La Oferta' OR tf.name='La Suiza'
         OR tf.name='Mercado Central de Concepción' OR tf.name ILIKE 'sta. paulina%'
         OR tf.name='Verluyz' OR tf.name='Marca Propia');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='estaciones-servicio' AND tl.name='Bencineras genéricas')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ~ '^B [A-Z]' OR tf.name ILIKE 'bencinera%' OR tf.name ILIKE 'petro%'
         OR tf.name='Mobil' OR tf.name='Texaco' OR tf.name ILIKE 'ecoil%' OR tf.name ILIKE 'sun oil%'
         OR tf.name ILIKE 'new oil%' OR tf.name ILIKE 'sur energy%' OR tf.name ILIKE 'yc combustibles%'
         OR tf.name IN ('Dynamo','Diesel','Express','Active','Letelier Yañez','Punto Sur','Rabalme','Fensicor','Farcom','Comtal','Karpex','JCD','JQL','JRB','JSP','JVL'));
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='estaciones-servicio' AND tl.name='Gasco')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name='Gasco';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='estaciones-servicio' AND tl.name='Abastible')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name ILIKE 'abastible%';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='servitecas' AND tl.name='Bridgestone')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE '%bridgestone%' OR tf.name ILIKE 'svtk brid%' OR tf.name ILIKE 'svtk brigestn%');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='servitecas' AND tl.name='Michelin')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE '%michelin%' OR tf.name ILIKE '%michellin%');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='servitecas' AND tl.name='Pirelli')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name ILIKE '%pirelli%';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='servitecas' AND tl.name='Servitecas genéricas')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'serviteca%' OR tf.name ILIKE 'servisur%' OR tf.name ILIKE 'svtk%' OR tf.name ILIKE 'serv. %'
         OR tf.name ILIKE 'central frenos%' OR tf.name ILIKE 'camarena%' OR tf.name ILIKE 'grbac%' OR tf.name ILIKE 'mtc%'
         OR tf.name ILIKE '%neumatic%' OR tf.name ILIKE '%neumátic%' OR tf.name ILIKE 'neumacentro%' OR tf.name ILIKE 'neumaspot%'
         OR tf.name ILIKE 'lubricentro%' OR tf.name ILIKE 'acopio mtc%' OR tf.name ILIKE 'comercial mtc%' OR tf.name ILIKE 'stuardo%');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  -- 2.15b corrección: Leon (sin tilde) sueltos → Servitecas genéricas
  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='servitecas' AND tl.name='Servitecas genéricas')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND tf.name='Leon';
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='mejoramiento-hogar' AND tl.name='Ferreterías independientes')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'ferret%' OR tf.name ILIKE 'ferr %' OR tf.name ILIKE 'ferr. %' OR tf.name ILIKE 'ferr.%'
         OR tf.name ILIKE 'ferretr%' OR tf.name ILIKE 'ferremad%' OR tf.name ILIKE 'ferrolusac%' OR tf.name ILIKE 'ferrexperto%'
         OR tf.name ILIKE 'fermaco%' OR tf.name ILIKE 'fergie%' OR tf.name ILIKE 'construmart%' OR tf.name ILIKE 'home center%'
         OR tf.name ILIKE 'sodimac%' OR tf.name ILIKE 'mts%' OR tf.name ILIKE 'centro ferretero%' OR tf.name ILIKE 'centro constructor%'
         OR tf.name ILIKE 'casa del constructor%' OR tf.name ILIKE 'paniahue%' OR tf.name ILIKE 'placa centro%' OR tf.name ILIKE 'placacentro%'
         OR tf.name ILIKE 'chilemat%' OR tf.name ILIKE 'dimac%' OR tf.name ILIKE 'dimaplac%' OR tf.name ILIKE 'dimafer%'
         OR tf.name ILIKE 'distribuidora rengo%' OR tf.name ILIKE 'barraca%' OR tf.name ILIKE 'masafil%' OR tf.name ILIKE 'masisa%'
         OR tf.name ILIKE 'ctro maderas%' OR tf.name ILIKE 'maderas %' OR tf.name ILIKE 'mat construcci%' OR tf.name ILIKE 'hc %'
         OR tf.name ILIKE 'innhause%'
         OR tf.name IN ('Los Pinos','Oriente','Covadonga','Costaguta','Coliseo','Caponni','Campodónico','Prat','Punto Prat','Geyger')
         OR tf.name ILIKE 'okey%' OR tf.name ILIKE 'pio nono%' OR tf.name ILIKE 'sds proyecto%' OR tf.name ILIKE 'sawy%'
         OR tf.name ILIKE 'diproc%' OR tf.name ILIKE 'san fco. constructor%' OR tf.name ILIKE 'san fermín%'
         OR tf.name ILIKE 'casa imperio%' OR tf.name ILIKE 'casa zuñiga%' OR tf.name ILIKE 'casa alicia%'
         OR tf.name ILIKE 'comercial lagomarsino%' OR tf.name ILIKE 'comercial copelec%'
         OR tf.name ILIKE 'las 2 estrellas%' OR tf.name ILIKE 'libreria giorgio%');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  UPDATE territorial_features tf SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='otros-locales' AND tl.name='Distribuidoras')
  WHERE tf.layer_id IN (SELECT id FROM territorial_layers WHERE group_id IN (SELECT id FROM territorial_layer_groups WHERE slug='sin-clasificar'))
    AND (tf.name ILIKE 'adelco%' OR tf.name ILIKE 'distribu%' OR tf.name ILIKE 'distribudora%' OR tf.name='CD - SMU'
         OR tf.name ILIKE 'abarrotes%' OR tf.name ILIKE 'abarttal%' OR tf.name ILIKE 'asipac%' OR tf.name ILIKE 'asoducam%'
         OR tf.name ILIKE 'la mundial%' OR tf.name ILIKE 'dolomiti%' OR tf.name ILIKE 'anania%' OR tf.name ILIKE 'multiventas%'
         OR tf.name ILIKE 'suasel%' OR tf.name ILIKE 'todo hogar%' OR tf.name ILIKE 'germani%' OR tf.name ILIKE 'maipu autoserv%'
         OR tf.name ILIKE 'javbian%' OR tf.name ILIKE 'mili%' OR tf.name ILIKE 'ducal%' OR tf.name ILIKE 'darmax%'
         OR tf.name ILIKE 'san sebastian%' OR tf.name ILIKE 'san rosendo%' OR tf.name ILIKE 'puerto cristo%'
         OR tf.name ILIKE 'o´higgins%' OR tf.name='O´HIGGINS' OR tf.name ILIKE 'syp%'
         OR tf.name='Almacenes (gran Tienda)');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_reasignados := v_reasignados + v_tmp;

  -- PASO 3: CONSOLIDACION
  UPDATE territorial_features SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-grandes' AND tl.name='Unimarc')
  WHERE layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='otros-locales' AND tl.name='Bigger');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_consolidados := v_consolidados + v_tmp;

  UPDATE territorial_features SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='servitecas' AND tl.name='Servitecas genéricas')
  WHERE layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='otros-locales' AND tl.name='León');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_consolidados := v_consolidados + v_tmp;

  UPDATE territorial_features SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Otros supermercados')
  WHERE layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='otros-locales' AND tl.name='La Oferta');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_consolidados := v_consolidados + v_tmp;

  UPDATE territorial_features SET layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Otros supermercados')
  WHERE layer_id = (SELECT tl.id FROM territorial_layers tl JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id WHERE tlg.slug='supermercados-regional' AND tl.name='Eltit');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_consolidados := v_consolidados + v_tmp;

  -- Guardrail: abortar si conteos lejos de lo esperado
  IF v_reasignados < 1100 OR v_reasignados > 1300 THEN
    RAISE EXCEPTION 'Guardrail: reasignados=% fuera de rango [1100,1300]', v_reasignados;
  END IF;
  IF v_consolidados <> 38 THEN
    RAISE EXCEPTION 'Guardrail: consolidados=% != 38 esperado', v_consolidados;
  END IF;

  SELECT count(*) INTO v_residual
  FROM territorial_features tf
  JOIN territorial_layers tl ON tl.id=tf.layer_id
  JOIN territorial_layer_groups tlg ON tlg.id=tl.group_id
  WHERE tlg.slug='sin-clasificar';

  IF v_residual > 30 THEN
    RAISE EXCEPTION 'Guardrail: residual=% > 30', v_residual;
  END IF;

  -- Recalcular feature_count en todas las capas tocadas
  UPDATE territorial_layers tl SET feature_count = (SELECT count(*) FROM territorial_features tf WHERE tf.layer_id=tl.id)
  WHERE tl.group_id IN (
    SELECT id FROM territorial_layer_groups
    WHERE slug IN ('farmacias','supermercados-grandes','supermercados-regional','estaciones-servicio','servitecas','mejoramiento-hogar','otros-locales','sin-clasificar')
  );

  INSERT INTO public._migration_log (sprint, notes)
  VALUES ('cleanup_sin_clasificar_20260517',
          'done | reasignados=' || v_reasignados || ' consolidados=' || v_consolidados || ' residual=' || v_residual);

  RAISE NOTICE 'OK reasignados=% consolidados=% residual=%', v_reasignados, v_consolidados, v_residual;
END
$mig$;