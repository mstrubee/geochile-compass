# `supabase/` — migraciones, rollbacks y pruebas SQL

Convenciones **obligatorias** para toda migración nueva (incluidas las de las fases de salud). Las migraciones se **aplican a mano**; nadie las aplica
por el repositorio ni por CI.

```
supabase/
  migrations/   solo UP: <AAAAMMDDHHMMSS>_<nombre>.sql
  rollbacks/    solo DOWN: <la MISMA versión y nombre>_down.sql
  tests/        pruebas SQL (no son migraciones)
  functions/    edge functions (Deno)
```

## 1. Migraciones (`supabase/migrations/`)
- Nombre `<AAAAMMDDHHMMSS>_<nombre>.sql`. Las nuevas (salud, seguridad…) usan versión **`20261101000000` o posterior**. No se tocan las existentes.
- Idempotentes y no destructivas salvo que se justifique con `SQL_MIGRATION_GUARDRAILS.md` (backup versionado, validar antes de borrar, `_migration_log`).
- Se aplican con `psql "$DB" -1 -v ON_ERROR_STOP=1 -f <archivo>`: **`-1` es obligatorio** (usan `SET LOCAL` y tablas temporales de vida de transacción).
- Cabecera con: qué cambia, qué reemplaza, en qué orden se aplica y cómo se revierte.

## 2. Rollbacks (`supabase/rollbacks/`) — **los `down` NUNCA van en `supabase/migrations/`**
- Cada migración nueva lleva su rollback en **`supabase/rollbacks/<misma versión>_<nombre>_down.sql`**.
- **Por qué nunca dentro de `migrations/`:** `supabase db push` (y cualquier herramienta que recorra esa carpeta) trataría el `_down` como **otra migración**: con la misma versión
  provocaría una versión duplicada, y con otra versión el down se ejecutaría justo después del up y deshacería el cambio. Hoy no hay ningún `_down` en `migrations/`; no se introduce.
- Lo hace cumplir `src/test/migrationsConvention.test.ts` (Vitest): falla si hay un `_down` en `migrations/` o si una migración `>= 20261101000000` no tiene su rollback.

## 3. Pruebas SQL (`supabase/tests/`)
- Una prueba por migración, y una **`<nombre>_rollback.sql`** que prueba el down (aplicado dos veces: idempotencia).
- Cada archivo documenta en su encabezado la **receta**: migración(es) + prueba + `do $$ begin raise exception 'DRYRUN_OK …'; end $$;` en la **misma transacción**, para que nada quede aplicado.
- Qué corre en local y qué no (y por qué): `docs/salud/HALLAZGOS_FASE0.md` §8; entorno reproducible: `bash etl/salud/dev_env.sh`.
- Un test «estructural» de Vitest (p. ej. `src/test/edgeAuth.test.ts`) puede comprobar que migración y rollback existen y conservan sus garantías clave.
