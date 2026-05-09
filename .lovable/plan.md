
# Mejor reconocimiento de filas al importar Excel

Hoy el matcher hace, en este orden: alias por dirección normalizada exacta → geocoding Nominatim → POIs dentro de 500 m. Si la dirección cambia una coma o Nominatim falla, la fila cae a "revisión manual" aunque la sucursal sea claramente la misma. Vamos a agregar varias capas previas más confiables y a hacer la geocodificación más tolerante.

## Cambios

### 1. Match por código de identidad (antes de geocodificar)
Las filas traen `Centro Sap` y `Local`, y los POIs ya guardan esos códigos en `poi_attributes`. Si el código coincide con un único POI de la carpeta → `auto_matched` inmediato, sin gastar request a Nominatim.

### 2. Match por nombre + comuna (antes de geocodificar)
Si el `Nombre Local` normalizado de la fila coincide con el `name` de un POI de la carpeta y comparten comuna → `auto_matched`. Cubre el caso típico "AutoPlanet Maipú" vs "AutoPlanet Maipú" aunque la dirección venga con typos.

### 3. Match por dirección normalizada contra POIs existentes
Hoy los aliases solo guardan direcciones de imports anteriores. Vamos a comparar también contra la dirección guardada en `poi.properties.address` / `poi.description` cuando exista, normalizada con el mismo normalizador. Si hay un único POI con la misma dirección normalizada en la carpeta → match.

### 4. Normalizador de direcciones más fuerte
Ampliar `addressNormalize.ts`:
- Quitar paréntesis y su contenido (`(esquina X)`).
- Manejar `S/N`, `S N`, `sin número` → vacío.
- Numeración con sufijo (`1234-A`, `1234 A`) → conservar sólo el número base para comparar.
- Más abreviaturas chilenas: `gral` → general, `pte` → presidente, `pdte`, `sta` → santa, `sto` → santo, `dr` → doctor, `prof` → profesor, `cnel`, `tte`, `vic`, `edo` → eduardo, `fco` → francisco, `jose` con/sin tilde, `km`, `ruta`.
- Normalizar números romanos comunes en avenidas (`av. los carrera ii` → `2`).
- Quitar tokens basura tipo `mall`, `strip center`, `local comercial` cuando aparecen al final.
- Función auxiliar `addressTokens()` que devuelve un set de tokens significativos para comparar por similitud (Jaccard).

### 5. Geocodificación más robusta
- Pedir `limit=5` a Nominatim en vez de `limit=1` y elegir el resultado cuyo `display_name` mejor matchee la comuna y los tokens de la dirección.
- Reintento con query simplificada (sólo "calle número, comuna, Chile") si el primer intento no arroja resultados.
- Reintento sin número si sigue fallando (al menos ubica la calle, suficiente para matchear contra POIs cercanos por nombre).

### 6. Desempate cuando hay múltiples POIs en el radio
Score combinado por candidato:
- Distancia (peso alto si <150 m).
- +1 si comparte comuna.
- +similitud de nombre (Jaccard de tokens, 0..1) entre `Nombre Local` y `poi.name`.
Si el mejor supera al segundo por un margen claro → `auto_matched`. Si no, sigue en `needs_review` pero el primer candidato queda preseleccionado.

### 7. Memoria ampliada de matches manuales
Cuando el admin asigna manualmente una fila al guardar el import, además del alias por dirección que ya se guarda, persistir:
- `(folder_id, "centro_sap", valor) → poi_id`
- `(folder_id, "local", valor) → poi_id`
- `(folder_id, "name_norm", nombreNormalizado) → poi_id`

Estas memorias se consultan en el paso 1/2 en futuras importaciones, así reasignaciones quedan permanentes aunque cambien las direcciones.

## Detalles técnicos

- Nueva tabla `poi_import_identity_memory(folder_id uuid, key_type text, key_value text, poi_id uuid, created_at timestamptz)` con UNIQUE `(folder_id, key_type, key_value)` y RLS análogo a `poi_import_skip_memory`.
- `src/services/poiImportMatcher.ts`: nuevo pipeline en cascada (memoria por código → memoria por nombre → atributos POI por código → nombre+comuna del POI → alias dirección → dirección normalizada del POI → geocode + score combinado).
- `src/utils/addressNormalize.ts`: ampliar `ABBREV`, agregar `addressTokens()`, `tokenJaccard(a,b)`.
- `src/services/geocodingService.ts`: pedir `limit=5`, función `pickBestNominatim(results, expectedComuna, addressTokens)`, fallbacks de query.
- `src/services/poiImportCommit.ts`: insertar las nuevas memorias en `poi_import_identity_memory` además del alias actual.
- `src/hooks/usePoiImport.ts`: cargar memorias de identidad al inicio del matching y pasarlas al matcher; cargar también `poi_attributes` de los POIs de la carpeta para el match por código.

## Resultado esperado

En importaciones recurrentes de la misma planilla (cambia sólo el mes), prácticamente todas las filas deberían quedar en `auto_matched` o `alias_matched` sin necesidad de tocar Nominatim, y las filas nuevas tienen muchas más probabilidades de auto-asignarse gracias a la mejor geocodificación y al desempate por nombre/comuna.
