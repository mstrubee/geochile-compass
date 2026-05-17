# SQL Migration Guardrails

Guía **obligatoria** para futuras migraciones destructivas (DELETE / TRUNCATE / DROP / UPDATE masivo) sobre la base de datos de este proyecto.

Origen: incidente del 2026-05-16 en `02-migration-data.sql`, donde un `DELETE FROM poi_folders WHERE name NOT IN ('Autoplanet','Agroplanet')` borró las carpetas que pretendía preservar (causa: comparación literal case/whitespace-sensitive + reejecución por timeout + backup vaciado por TRUNCATE).

---

## 1. Nunca usar `NOT IN` con literales para preservar filas críticas

`NOT IN` hace comparación **exacta, case- y whitespace-sensitive**, y se rompe silenciosamente con NULLs.

❌ **Mal**
```sql
DELETE FROM poi_folders
 WHERE name NOT IN ('Autoplanet','Agroplanet');
```

✅ **Bien** — capturar los IDs a preservar ANTES y borrar por ID:
```sql
CREATE TEMP TABLE _keep_ids AS
  SELECT id FROM poi_folders
   WHERE lower(btrim(name)) IN ('autoplanet','agroplanet');

-- abortar si no encontramos lo esperado
DO $$ BEGIN
  IF (SELECT count(*) FROM _keep_ids) < 2 THEN
    RAISE EXCEPTION 'Guardrail: esperaba >=2 carpetas a preservar, encontré %', (SELECT count(*) FROM _keep_ids);
  END IF;
END $$;

DELETE FROM poi_folders WHERE id NOT IN (SELECT id FROM _keep_ids);
```

Si **debés** usar matching por nombre, usar normalización tolerante: `lower(btrim(name))` y validar conteos antes de borrar.

---

## 2. Idempotencia + guard de reentrada

Toda migración destructiva debe poder ejecutarse 2 veces sin corromper datos (los timeouts del API son comunes y disparan reintentos).

✅ Patrón:
```sql
-- Marca de ejecución
INSERT INTO _migration_log (sprint, notes)
  SELECT 'sprint_X_data', 'start'
  WHERE NOT EXISTS (
    SELECT 1 FROM _migration_log WHERE sprint = 'sprint_X_data' AND notes = 'done'
  )
RETURNING id;

-- ... migración ...

-- Si ya estaba 'done', abortar limpiamente al principio
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _migration_log WHERE sprint='sprint_X_data' AND notes='done') THEN
    RAISE NOTICE 'Migración ya aplicada, saliendo';
    RETURN;
  END IF;
END $$;
```

Además: envolver en `BEGIN; ... COMMIT;` y usar **advisory locks** (`pg_advisory_xact_lock(<hash>)`) para impedir 2 ejecuciones concurrentes.

---

## 3. Backup **versionado** antes de TRUNCATE/DELETE

❌ **Mal** — un único `_backup` que la segunda corrida pisa con TRUNCATE:
```sql
TRUNCATE _pois_pre_migration_backup;
INSERT INTO _pois_pre_migration_backup SELECT * FROM pois;
```

✅ **Bien** — tabla nueva con sufijo de versión y timestamp, **nunca** se trunca:
```sql
CREATE TABLE IF NOT EXISTS _backup_pois_v3_20260516 AS
  SELECT * FROM pois WHERE 1=0;

INSERT INTO _backup_pois_v3_20260516
  SELECT * FROM pois
  ON CONFLICT DO NOTHING;  -- idempotente si re-corre
```

Mantener al menos 2 versiones recientes hasta validar.

---

## 4. Validar **antes** de borrar, no después

Toda operación destructiva debe ir precedida de un bloque de auditoría que aborta si los conteos no calzan con lo esperado.

```sql
DO $$
DECLARE n_pois_orig int; n_keep int;
BEGIN
  SELECT count(*) INTO n_pois_orig FROM pois;
  SELECT count(*) INTO n_keep FROM pois p
    JOIN _keep_ids k ON k.id = p.folder_id;
  IF n_keep < n_pois_orig * 0.5 THEN
    RAISE EXCEPTION 'Guardrail: el DELETE eliminaría > 50%% (% de %)', n_pois_orig - n_keep, n_pois_orig;
  END IF;
END $$;
```

Regla: si una migración destructiva afecta más filas de lo esperado, **abortar** y revisar.

---

## 5. No mezclar DDL/migración pesada con timeouts cortos del API

Las migraciones largas (>30s) que se ejecutan vía API/edge function pueden cortarse y reintentarse en silencio. Para esos casos:

- Partir el script en pasos atómicos chicos, cada uno idempotente (ver §2).
- Ejecutar el bloque destructivo en una **transacción dedicada** con `SET LOCAL statement_timeout = '5min'`.
- Loggear `start`/`done` en `_migration_log` por paso.
- Evitar DELETEs masivos en una sola transacción gigante; preferir loops por lotes con commits intermedios y guardar el progreso.

---

## Checklist obligatorio para una migración destructiva

- [ ] Backup versionado creado (`_backup_<tabla>_vN_<fecha>`), nunca truncado.
- [ ] Captura de IDs a preservar en TEMP table, validada con `RAISE EXCEPTION` si conteo < esperado.
- [ ] DELETE/UPDATE filtrado por ID, **no** por literal de texto.
- [ ] Si se filtra por texto, usar `lower(btrim(...))` y validar.
- [ ] Bloque de auditoría que aborta si % afectado > umbral razonable.
- [ ] Idempotencia con `_migration_log` + `pg_advisory_xact_lock`.
- [ ] Transacción explícita `BEGIN ... COMMIT` con `statement_timeout` apropiado.
- [ ] Probado en una copia/branch antes de aplicar a prod.

---

## Trigger anti-data-sintética (`trg_reject_future_sales`)

Origen: incidente del 2026-05-17. Se detectó que `poi_metrics` contenía 64 filas de `metric_key='ventas'` con `period = 2026-06-01` (mes futuro) y valores decimales largos — claramente proyecciones o datos sintéticos cargados el 2026-05-09 por un proceso no rastreable (no hay registro en `poi_import_jobs` ni en logs de edge functions de esa fecha). Esa data se filtraba al modelo Gemini en `poi-insights` como "último mes registrado", haciendo que el resumen mencionara junio 2026 con cifras inventadas.

### Qué hace

Trigger `BEFORE INSERT OR UPDATE` sobre `public.poi_metrics`. Bloquea con `RAISE EXCEPTION` cualquier fila donde:

- `metric_key = 'ventas'`, y
- `period > date_trunc('month', now())::date` (es decir, posterior al primer día del mes calendario actual).

Definición:

```sql
CREATE OR REPLACE FUNCTION public.reject_future_sales_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.metric_key = 'ventas'
     AND NEW.period > date_trunc('month', now())::date THEN
    RAISE EXCEPTION 'Period % is in the future. Sales metrics cannot have periods > current month (%).',
      NEW.period, date_trunc('month', now())::date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reject_future_sales
  BEFORE INSERT OR UPDATE ON public.poi_metrics
  FOR EACH ROW EXECUTE FUNCTION public.reject_future_sales_metrics();
```

### Por qué

- **Defensa en profundidad**: imports, scripts manuales, edge functions o queries ad-hoc no pueden saltarse esta validación. El error es ruidoso (excepción a nivel DB) y se propaga al cliente.
- **No depende del código de la app**: aunque alguien cambie `poi-insights` o el flujo de import, el dato sucio nunca entra.
- **Limitado a `ventas`**: otras métricas (objetivos, proyecciones formales) podrían legítimamente tener períodos futuros y no se ven afectadas.

### Si en el futuro hay que cargar proyecciones de ventas

Opciones (no romper este trigger):

1. Usar otra `metric_key` (ej. `ventas_proyectadas`) que no se filtre al modelo.
2. Agregar una columna `is_projection boolean` a `poi_metrics`, ajustar el trigger para permitir futuros solo cuando `is_projection = true`, y filtrar esa columna del lado de `poi-insights`.
3. Mover proyecciones a una tabla separada (`poi_projections`).

Nunca: deshabilitar el trigger temporalmente para "meter el dato y listo" — esa fue exactamente la categoría de problema que originó este guardrail.
