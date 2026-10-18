# Seguridad de las edge functions `isochrone` y `sign-urls` (rama `fix/seguridad-edge`)

**Estado: código y migración listos, NADA desplegado ni aplicado.** El despliegue de funciones y la aplicación de la migración los hace el
dueño del proyecto, en el orden de abajo.

## Qué estaba mal (verificado leyendo el código)

| Función | Problema |
|---|---|
| `isochrone` | `verify_jwt = false` y ninguna validación en el código: **cualquiera con la URL gastaba la cuota de ORS** (CORS `*`). `api_quota` no la contaba (su `CHECK` solo admitía las 4 APIs de Google) |
| `sign-urls` | firma con `service_role` URLs de 1 h de 3 archivos del bucket privado `territorial-sources` **sin validar a nadie** y sin entrada en `config.toml`. Nada en el repo la llama (solo la nombra el README) |
| Capturas de mapa para informes | `Index.tsx` apaga las capas locales pero no consideraba las capas del árbol ni `client_ready` |

## Qué hace ahora

**`isochrone`** (`supabase/functions/isochrone/index.ts`)
1. Exige un **JWT de usuario** (la clave anon es un JWT válido para el gateway pero `auth.getUser` la rechaza → 401).
2. Exige el mismo «rol» que ya aplica la interfaz (`usePermissions`): **administrador, o permiso `view` en la sección `isocronas`**
   (`src/config/sections.ts`). Se lee con el RPC `user_section_permissions` usando la sesión del propio usuario. Sin permiso → 403.
3. Valida el cuerpo y recién entonces **descuenta 1 de la cuota `ors`** de `api_quota` (por llamada, no por reintento). Agotada → 429; sin poder verificarla → 503.
   **Falla cerrado** en todos los pasos: si Auth, los permisos o la cuota no responden, no se llama a ORS.

**`sign-urls`**: exige JWT de usuario con rol **administrador** (403 si no).

**`supabase/config.toml`**: `verify_jwt = true` para `isochrone` y `sign-urls` (defensa en profundidad; la validación real está en el código).

**Cuota** (`supabase/migrations/20261101000000_api_quota_ors.sql`, rollback en `supabase/rollbacks/`)
- `api_quota_config.api` admite `'ors'`; fila inicial con **límite mensual PROVISIONAL de 10.000** (no verificado contra el plan de ORS; ORS además limita por día y por
  minuto por su cuenta). Ajustar con `set_api_quota_limit('ors', n, <contraseña>)`.
- `consume_api_quota('ors', n)` **solo la puede llamar `service_role`**. Sin esto, cualquiera con la clave pública (que `consume_api_quota` concede a `anon`) podría vaciar
  la cuota de ORS por RPC directo y bloquear las isócronas de todos. Las APIs de Google no cambian.
- `get_api_quota_status()` **no lista `ors`**: es público y alimenta el panel de Google Maps (que tiene etiquetas y textos solo de Google).

**Capturas de mapa** (`Index.tsx`, `src/utils/clientReady.ts`): las capas del árbol visibles que **no** sean `client_ready` se apagan solo durante la foto y se
restauran en `finally`. La bandera aún no existe, así que **hoy no cambia nada de lo que se ve**; el mecanismo queda listo para la regla 6 de la Fase 1a.

## Orden de despliegue (lo ejecuta el dueño)

1. `psql "$PROD" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261101000000_api_quota_ors.sql` (necesita `20261015130000_api_quota.sql` ya aplicada). Revisar que `api_quota_config` tenga la fila `ors`.
2. `supabase functions deploy isochrone` y `supabase functions deploy sign-urls`.
3. Probar con la sesión de un usuario: isócrona con y sin permiso `isocronas`, y sin sesión.

**Si se despliega la función ANTES de aplicar la migración**, `isochrone` responde 503 (`quota_unavailable`): falla cerrado, no abre nada.

**Reversión:** `supabase/rollbacks/20261101000000_api_quota_ors_down.sql` (borra el consumo de `ors` y restaura las funciones). Para volver al comportamiento anterior de las funciones, redesplegar la versión previa.

## Cambios de comportamiento que conviene conocer

- Quien **no tiene sesión** ya no puede generar isócronas (antes sí, con la clave anon).
- Un usuario con sesión pero **sin permiso `isocronas`** (ni admin) recibe 403. Los permisos de sección dejaron de ser solo visuales para esta función.
- Si se agota la cuota `ors`, las isócronas responden 429 hasta que un admin la amplíe o cambie el mes (hora del Pacífico).
- El frontend muestra el mensaje genérico de `supabase.functions.invoke` para 401/403/429/503; mejorar esos mensajes no se incluyó.

## Qué NO cubre este PR (riesgos conocidos, sin tocar)

- `drive-distance`: exige JWT (`verify_jwt = true`) pero **no valida rol ni cuenta cuota** y llama a ORS por destino.
- `isochrone-insights`, `poi-insights`: `verify_jwt = false`.
- `export-report-slides`, `list-saved-isochrones`, `export-sales-projection`: protegidas solo por `x-api-key`.
- Buckets **públicos** `territorial-aggregates` y `geodata`.
- `.env.production` está versionado (variables `VITE_*` publicables; confirmar que es intencional).
- `consume_api_quota` sigue concedida a `anon` para las APIs de Google (decisión original; solo puede bloquear Google).

## Cómo se probó

- Vitest: `src/test/edgeAuth.test.ts` (24) y `src/test/clientReady.test.tsx` (12). La lógica de autorización es un módulo **puro** (`supabase/functions/_shared/edge-auth.ts`) probado con dependencias falsas;
  los handlers de Deno **no se pueden ejecutar** en Vitest (no hay Deno instalado), así que se verifica su **estructura** (autorizar antes de leer la clave de ORS, descontar cuota antes de llamar a ORS, preflight sin autenticar).
- SQL: `supabase/tests/api_quota_ors.sql` (17 aserciones) y `api_quota_ors_rollback.sql` (7), con la receta de cada encabezado. Se corrieron sobre una base local con una **plataforma mínima de pruebas**
  (roles, `auth`, `extensions`/pgcrypto) **que no es el esquema real**: quedan **pendientes de re-ejecutar** cuando exista el stub confirmado contra el Supabase real (`docs/salud/planb/inventario_esquema_base.sql`).
- **No probado:** el comportamiento real de las funciones desplegadas, `verify_jwt = true` con el preflight CORS del navegador (el precedente es `drive-distance`, que ya lo usa), ni la cuota real de ORS.
