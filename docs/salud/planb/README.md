# Plan B de la Fase 0

Qué hay aquí y cuándo usarlo. Contexto completo en [`../HALLAZGOS_FASE0.md`](../HALLAZGOS_FASE0.md) §13.

| Archivo | Para qué | Estado |
|---|---|---|
| `docker-compose.yml` | PostgreSQL 16 + PostGIS 3.4 en tu máquina (`SALUD_EXTERNAL_PG=1 bash etl/salud/dev_env.sh`) | **No probado** (la sesión no tiene daemon de docker); el modo `SALUD_EXTERNAL_PG=1` de `dev_env.sh` sí se probó contra el clúster local |
| `inventario_esquema_base.sql` | Nueve `SELECT` de **solo lectura** para correr en tu Supabase real y confirmar los objetos que el repo asume (roles, `auth`, `storage`, `pg_cron`, `custom_layers`, rol admin, esquemas expuestos, migraciones aplicadas) | Sintaxis verificada en local; resultado contra tu Supabase: **pendiente** |
| `medir_tamano.sql` | Mide el tamaño real de lo cargado, **publicado y restringido por separado** | Se usa desde la fase que cargue datos |
| `../../../etl/salud_probe.py` | Sondeo de solo lectura para correr en tu máquina (Fonasa, Geofabrik, descargas del Censo, conteo de manzanas con `--manzana-file`) | Probado contra las fuentes reales desde la sesión y con 16 tests contra un servidor falso |

El sondeo **no usa cabeceras de navegador ni reintenta bloqueos**: si un sitio responde con un WAF o un 403, queda registrado tal cual y esa fuente va a descarga manual.
