# Cargar el Excel de ventas desde tu computador

Un comando y la planilla queda cargada. Sin abrir el navegador, sin pasar por el
diálogo de importación.

**La importación manual desde la app sigue funcionando igual.** Este camino usa
exactamente el mismo código (mismo parser, mismo reconocimiento de locales,
mismo guardado), así que no hay dos comportamientos que puedan desalinearse.

> Si preferís que se cargue solo desde Google Drive sin depender de tu
> computador, mirá [sync-ventas-drive.md](./sync-ventas-drive.md). Este documento
> es la versión con archivo local, que es más simple de poner en marcha.

---

## Configuración (una sola vez)

Crea el archivo `.env.sync` en la raíz del repo con dos líneas:

```
SUPABASE_URL=https://fmynxmxrtponfuqxmjli.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<la service_role key>
```

La `service_role key` está en Supabase → **Settings** → **API** → *Project API
keys*. Ese archivo está en `.gitignore`, así que no se sube al repo.

---

## Usarlo

**Primero probá en seco** — no escribe nada, solo te dice qué haría:

```bash
./scripts/sync-ventas.sh ~/ruta/a/ventas.xlsx --dry-run
```

Vas a ver algo así:

```
carpeta destino (única habilitada): d5f2c961-...
archivo: "ventas.xlsx" · modificado 2026-08-19T15:43:52Z
leído: 340 KB
parseado: 64 filas
memoria: 72 locales, 75 alias, 15 claves de identidad
asignadas: 63 · omitidas por memoria: 0 · sin asignar: 1
DRY_RUN: no se escribe nada
```

Si el resumen se ve bien, cargalo de verdad quitando `--dry-run`:

```bash
./scripts/sync-ventas.sh ~/ruta/a/ventas.xlsx
```

---

## Que se cargue solo, todos los días

Para que no tengas que correr el comando a mano, macOS puede hacerlo por vos.

1. Agregá la ruta del archivo a `.env.sync`, así el script funciona sin
   argumentos:

   ```
   VENTAS_FILE=/Users/mstrubee/Documents/ventas.xlsx
   ```

2. Abrí `scripts/com.geoplanet.sync-ventas.plist.example`, cambiá las 3 rutas
   marcadas con `CAMBIAR`, y guardá una copia en
   `~/Library/LaunchAgents/com.geoplanet.sync-ventas.plist`

3. Activala:

   ```bash
   launchctl load ~/Library/LaunchAgents/com.geoplanet.sync-ventas.plist
   ```

4. Probala ahora mismo sin esperar la hora, y mirá el resultado:

   ```bash
   launchctl start com.geoplanet.sync-ventas
   cat /tmp/sync-ventas.log
   ```

**Límite importante:** solo corre si tu computador está encendido. Si estaba
apagado a la hora agendada, macOS la ejecuta cuando lo prendés de nuevo. Si
necesitás que corra sí o sí todos los días sin depender de tu máquina, ahí
conviene el camino de Google Drive.

Para desactivarla:

```bash
launchctl unload ~/Library/LaunchAgents/com.geoplanet.sync-ventas.plist
```

---

## Las dos protecciones que tiene

### Se puede deshacer todo

Antes de escribir, guarda una copia de lo que va a sobrescribir: **las ventas,
los atributos del local** (Gerente Zonal, Zona…) **y el nombre del local**. Si
una carga quedó mal, se revierte completa:

```sql
-- Ver las últimas cargas
select id, filename, created_at, rows_total, period_min, period_max
from poi_import_jobs order by created_at desc limit 10;

-- Revertir una (usá el id de arriba)
select * from restore_import_snapshot('EL_ID_DEL_JOB');
```

Devuelve exactamente qué deshizo:

```
 metricas_restauradas | metricas_borradas | atributos_restaurados | atributos_borrados | nombres_restaurados
                    0 |                 2 |                    10 |                  0 |                   2
```

Los meses que esa carga creó se borran; los que sobrescribió vuelven a su valor
anterior. Igual con atributos y nombres.

### Nunca descarta filas en silencio

Si la planilla trae un local que el sistema no reconoce (por ejemplo uno nuevo),
no lo inventa ni lo tira: lo deja en una cola de revisión con sus datos
intactos.

```sql
select raw_name, raw_address, comuna, reason, created_at
from poi_import_pending_rows
where resolved_at is null
order by created_at desc;
```

Esas filas conservan sus ventas ya procesadas, así que una vez que asignes el
local no hace falta volver a cargar el archivo.

---

## Cosas que conviene saber

- **La carga sobrescribe por mes.** Un mes que ya estaba y viene en la planilla
  se reemplaza; uno nuevo se agrega; uno que ya estaba y *no* viene en la
  planilla queda intacto.
- **También sobrescribe el nombre del local y sus atributos** con lo que traiga
  la planilla. Por eso están respaldados (ver arriba).
- **Si tenés el Excel abierto**, guardalo antes de correr el comando. El script
  detecta y rechaza los archivos temporales de Excel (`~$nombre.xlsx`) con un
  mensaje claro.

---

## Si algo falla

| Mensaje | Qué significa |
|---|---|
| `Falta .env.sync con las credenciales` | No creaste el archivo de configuración (ver arriba) |
| `No se encontró el archivo` | La ruta al Excel está mal escrita |
| `es un archivo temporal de Excel` | Apuntaste al `~$archivo.xlsx`. Cerrá Excel y usá el archivo real |
| `Ninguna carpeta tiene la importación habilitada` | Falta configurar la importación de la carpeta en la app (*Configurar importación…*) |
| `Hay N carpetas con importación habilitada` | Agregá `--folder <uuid>` para indicar cuál |

---

## Detalles técnicos

- **Motor:** [`scripts/sync-drive-sales.ts`](../scripts/sync-drive-sales.ts),
  corre con `vite-node` para resolver el alias `@/` igual que la app y así
  reutilizar el mismo parser/matcher/commit sin duplicar lógica.
- **Fuente local:** [`scripts/local-file-client.ts`](../scripts/local-file-client.ts).
  Usa el `mtime` del archivo como detector de cambios, el mismo rol que el
  `modifiedTime` de Drive.
- **Modos:** `--file <ruta>` es una corrida puntual que no guarda estado (se
  procesa siempre, incluso si el archivo no cambió). Sin `--file`, lee la tabla
  `drive_sync_state`, donde cada fila define `source_type` = `drive` o `local`.
- **Respaldos:** `poi_metrics_snapshots`, `poi_attributes_snapshots`,
  `poi_name_snapshots`. La función `restore_import_snapshot(job_id)` revierte los
  tres de una vez.
- **Verificado end-to-end** contra la base real: escritura, sobrescritura de
  atributos y nombres, y reversión completa devolviendo los valores originales.
