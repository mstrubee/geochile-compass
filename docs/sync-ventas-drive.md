# Sincronización automática del Excel de ventas desde Google Drive

Deja el Excel de ventas en Google Drive y la información se carga sola. Cada día
el sistema mira si el archivo cambió; si cambió, lo procesa. Si no, no hace nada.

**La importación manual desde la app sigue funcionando igual.** Este camino
automático usa exactamente el mismo código (mismo parser, mismo reconocimiento
de locales, mismo guardado), así que no hay dos comportamientos distintos que
puedan desalinearse.

---

## Lo que tienes que hacer una sola vez

Son 4 pasos. Los primeros 3 son en Google, el último en GitHub.

### 1. Crear la cuenta de servicio en Google

Una "cuenta de servicio" es un usuario robot que puede leer el archivo sin usar
tu cuenta personal.

1. Entra a <https://console.cloud.google.com/>
2. Arriba a la izquierda, elige o crea un proyecto.
3. Busca **"Service Accounts"** (Cuentas de servicio) en la barra de búsqueda.
4. Clic en **"+ Create service account"**:
   - Nombre: `geoplanet-drive-sync` (o el que quieras)
   - Clic en **Create and continue**, y luego en **Done** (no necesita ningún rol).
5. En la lista, clic sobre la cuenta que acabas de crear → pestaña **Keys** →
   **Add key** → **Create new key** → tipo **JSON** → **Create**.
6. Se descarga un archivo `.json`. **Guárdalo, lo necesitas en el paso 4.**
7. Copia el **email** de esa cuenta de servicio (se ve como
   `geoplanet-drive-sync@tu-proyecto.iam.gserviceaccount.com`). Lo necesitas en
   el paso 3.

### 2. Habilitar la Drive API

En el mismo proyecto de Google Cloud:

1. Busca **"Google Drive API"**.
2. Clic en **Enable** (Habilitar).

Sin esto, el sistema no puede leer el archivo aunque tenga permiso.

### 3. Compartir el archivo con la cuenta de servicio

En Google Drive:

1. Clic derecho sobre el archivo de ventas (o sobre la carpeta que lo contiene)
   → **Compartir**.
2. Pega el email de la cuenta de servicio del paso 1.
3. Permiso: **Lector** (con eso alcanza — el sistema solo lee, nunca escribe en
   Drive).
4. Enviar.

**Además, copia el ID del archivo.** Está en la URL cuando lo abres:

```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit
                                      └──────── este es el ID ────────┘
```

### 4. Cargar los secretos en GitHub

En <https://github.com/mstrubee/geochile-compass> → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**. Crea estos tres:

| Nombre del secreto | Qué pegar |
|---|---|
| `SUPABASE_URL` | `https://fmynxmxrtponfuqxmjli.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | La `service_role` key: Supabase → Settings → API → Project API keys |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | El **contenido completo** del archivo `.json` del paso 1. Ábrelo con un editor de texto, selecciona todo y pega tal cual (empieza con `{` y termina con `}`) |

> **El error más común** es pegar el JSON incompleto o solo un trozo. Si pasa
> eso, el sistema te avisa con un mensaje claro que menciona
> `GOOGLE_SERVICE_ACCOUNT_JSON`, no con un error técnico incomprensible.

### 5. Decirle al sistema qué archivo vigilar

Esto se guarda en la base de datos (no en el repo), para poder cambiar el
archivo después sin tocar código. Reemplaza `EL_ID_DEL_PASO_3`:

```sql
insert into drive_sync_state (folder_id, drive_file_id, enabled)
values ('d5f2c961-041d-469c-b0a8-e3d2e8261404', 'EL_ID_DEL_PASO_3', true)
on conflict (folder_id) do update
  set drive_file_id = excluded.drive_file_id, enabled = true;
```

(El `folder_id` de arriba es la carpeta que hoy tiene la importación habilitada.)

---

## Cómo probarlo sin riesgo

Antes de dejarlo automático, córrelo en modo de prueba: **no escribe nada**,
solo te dice qué haría.

1. GitHub → pestaña **Actions** → **"Sync Ventas desde Drive"** → **Run workflow**
2. Marca **dry_run** en `true` → **Run workflow**
3. Abre la corrida y lee el log: te muestra cuántas filas reconoció, cuántas no,
   y si el archivo cambió.

Cuando el log se vea bien, corre lo mismo con `dry_run` en `false`.

---

## Cómo funciona el día a día

- **Todos los días a las 06:00 (hora de Chile)** el sistema revisa el archivo.
- Si no cambió: termina en segundos, no toca nada.
- Si cambió: lo procesa completo y queda registrado en el historial de
  importaciones, igual que si lo hubieras subido a mano.

También puedes dispararlo cuando quieras desde **Actions → Run workflow**, sin
esperar al horario.

---

## Las dos protecciones que tiene

### Se puede deshacer

Antes de sobrescribir cualquier valor, el sistema guarda una copia del valor
anterior. Si una corrida cargó datos malos, se revierte completa:

```sql
-- Ver las últimas corridas
select id, filename, created_at, rows_total, period_min, period_max
from poi_import_jobs order by created_at desc limit 10;

-- Revertir una (usa el id de arriba)
select * from restore_import_snapshot('EL_ID_DEL_JOB');
```

Devuelve cuántos valores restauró y cuántos borró. Los meses que esa corrida
creó se eliminan; los que sobrescribió vuelven a su valor anterior.

### Nunca descarta filas en silencio

Si el Excel trae un local que el sistema no puede reconocer (por ejemplo, uno
nuevo), **no lo inventa ni lo tira a la basura**: lo deja en una cola de
revisión con sus datos intactos.

```sql
select raw_name, raw_address, comuna, reason, created_at
from poi_import_pending_rows
where resolved_at is null
order by created_at desc;
```

Esas filas conservan sus métricas ya procesadas, así que una vez que asignes el
local no hace falta volver a subir el archivo.

---

## Si algo falla

El estado de la última corrida queda guardado en la base:

```sql
select drive_file_id, last_status, last_error, last_synced_at, last_modified_time
from drive_sync_state;
```

- `last_status = 'ok'` → procesó bien
- `last_status = 'skipped'` → el archivo no había cambiado (normal)
- `last_status = 'error'` → `last_error` explica qué pasó

Errores típicos:

| Mensaje | Qué significa |
|---|---|
| `Drive devolvió 404` | El ID del archivo está mal, o no compartiste el archivo con el email de la cuenta de servicio (paso 3) |
| `No se pudo firmar con la private_key` | El secreto `GOOGLE_SERVICE_ACCOUNT_JSON` quedó incompleto (paso 4) |
| `no tiene esquema de importación configurado` | Falta configurar la importación de esa carpeta en la app (Configurar importación…) |

---

## Detalles técnicos

- **Motor:** [`scripts/sync-drive-sales.ts`](../scripts/sync-drive-sales.ts),
  corre con `vite-node` para resolver el alias `@/` igual que la app y así
  reutilizar el mismo parser/matcher/commit sin duplicar lógica.
- **Cliente de Drive:** [`scripts/drive-client.ts`](../scripts/drive-client.ts).
  Firma un JWT con `node:crypto` en vez de traer `googleapis` (~50 MB) para dos
  llamadas. Alcance `drive.readonly`. Si el archivo es un Google Sheet nativo en
  vez de un `.xlsx`, lo exporta al vuelo.
- **Detección de cambios:** `modifiedTime` de Drive contra
  `drive_sync_state.last_modified_time`.
- **Workflow:** [`.github/workflows/sync_drive_sales.yml`](../.github/workflows/sync_drive_sales.yml),
  con `concurrency` para que dos corridas no se pisen.
- **Tablas nuevas:** `drive_sync_state`, `poi_metrics_snapshots`,
  `poi_import_pending_rows` (migración `20260819140000_drive_sales_sync.sql`).
- **Único cambio en el código existente:** `commitImport` ahora recibe el cliente
  de Supabase por parámetro en vez de importar el del navegador. Sin eso, el
  módulo no se puede cargar en Node (el cliente del navegador toca
  `localStorage` al importarse).
