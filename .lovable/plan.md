## Objetivo
Permitir rotación automática entre múltiples API Keys de Gemini, con panel admin para gestionarlas y accesos rápidos en el header para generar nuevas.

## Arquitectura

Las keys dejan de vivir en `GEMINI_API_KEY` (secret único) y pasan a una tabla en la base de datos administrable desde la UI. Las edge functions leen la lista con el service role, prueban en orden y registran uso/errores.

```text
[Edge Function poi-insights / isochrone-insights]
        │
        ├─ getActiveKeys()  ──► tabla gemini_api_keys (service role)
        │
        ├─ for key in keys ordenadas:
        │     try fetch(Gemini, key)
        │     ├─ 200 → marcar last_used_at, success
        │     ├─ 429/quota/exhausted → marcar error, continuar
        │     └─ 5xx temporal → marcar error, continuar
        │
        └─ si todas fallan → 503 con detalle por key
```

## Cambios de base de datos

**Tabla `gemini_api_keys`** (solo admin via RLS)
- `alias` (text), `api_key` (text), `enabled` (bool), `priority` (int)
- `last_used_at`, `last_error_at`, `last_error_message`
- `success_count`, `error_count`
- `created_at`, `updated_at`

**Tabla `gemini_key_links`** (solo admin via RLS)
- `label` (text), `url` (text), `order_index` (int)
- Usada por el header para "Obtener más API Keys".

Ambas con RLS: lectura/escritura solo para `has_role(auth.uid(), 'admin')`. Las edge functions acceden vía service role, así que no necesitan exponer la key al cliente.

## Cambios en Edge Functions

`supabase/functions/_shared/gemini-keys.ts` (nuevo):
- `loadActiveKeys(supabaseAdmin)` → lista ordenada por `priority`, `last_error_at` asc.
- `callGeminiWithRotation({ model, body, supabaseAdmin })`:
  - Itera keys, intenta fetch.
  - Clasifica errores: `quota`, `rate_limit`, `unavailable`, `auth`, `other`.
  - Update async de `last_used_at` / `last_error_at` / contadores.
  - Devuelve `{ data, keyAlias }` o lanza `AllKeysFailedError` con detalle por key.
- Logs estructurados: `console.warn("[gemini-rotation] key=alias reason=quota -> trying next")`.

Refactor de:
- `supabase/functions/poi-insights/index.ts`
- `supabase/functions/isochrone-insights/index.ts`

Reemplazan el fetch directo actual por `callGeminiWithRotation`. Fallback (`buildSafeSummary`) se conserva.

Compatibilidad: si la tabla está vacía, se hace fallback al secret `GEMINI_API_KEY` existente para no romper instalaciones actuales.

## Cambios en Frontend (Admin)

Nueva ruta `/admin/gemini-keys` (visible solo si `isAdmin`, link agregado en `Header`/`AdminCapas`).

Componentes nuevos en `src/components/admin/`:
- `GeminiKeysAdmin.tsx` — grid de tarjetas, botón **"Agregar nueva key"**.
- `GeminiKeyCard.tsx` — por cada key:
  - alias, estado (toggle enable/disable), prioridad
  - key enmascarada (`AIzaSy****X92K`) con botón **mostrar/ocultar**, **copiar**
  - métricas: `success_count`, `error_count`, `last_used_at`, `last_error_at` + tooltip con `last_error_message`
  - botones **Editar**, **Eliminar**, **Testear** (invoca una edge function `gemini-key-test` que hace un ping mínimo con esa key específica)
- `GeminiKeyDialog.tsx` — formulario crear/editar (alias, api_key, enabled, priority).

Servicio `src/services/geminiKeysService.ts` con CRUD via supabase client.

Nueva edge function `gemini-key-test`:
- Recibe `{ keyId }`, valida admin via JWT, hace 1 request mínimo a Gemini con esa key, devuelve `{ ok, latencyMs, error? }`.

## Cambios en Header

Nuevo dropdown **"Obtener más API Keys"** (visible solo si `isAdmin`) en `src/components/layout/Header.tsx`:
- Lista los `gemini_key_links` como botones que abren en pestaña nueva (`target="_blank" rel="noopener"`).
- Item final **"Gestionar enlaces…"** abre dialog para CRUD de links.
- Por defecto se siembra: `https://aistudio.google.com/apikey`.

Componente `GeminiKeyLinksDialog.tsx` con CRUD simple (label + url + orden).

## Manejo de errores hacia el usuario

- Si todas las keys fallan: edge function responde 503 `{ error: "ALL_KEYS_FAILED", details: [{ alias, reason }] }`.
- Frontend ya tiene UI de error en `useIsochroneInsights` y `PoiAnalysisPanel`; se ajusta el mensaje para indicar "Todas las API Keys de Gemini fallaron. Revisa el panel de administración." y, si es admin, link directo a `/admin/gemini-keys`.

## Detalles técnicos

- **Enmascarado**: `key.slice(0,6) + "****" + key.slice(-4)`.
- **Seguridad**: la `api_key` solo viaja desencriptada en respuestas a admin autenticado (RLS lo garantiza). El cliente nunca la usa para llamar a Gemini directamente.
- **Concurrencia de updates de uso**: updates "fire-and-forget" (`waitUntil`-style) para no penalizar latencia.
- **Clasificación de errores** (regex sobre body de Gemini):
  - `RESOURCE_EXHAUSTED` / `429` → `quota`
  - `rate limit` → `rate_limit`
  - `UNAVAILABLE` / `503` → `unavailable`
  - `API key not valid` / `401` / `403` → `auth` (deshabilita key automáticamente)
- **Rotación**: orden = `enabled=true` primero, luego `priority asc`, luego `last_error_at` más antiguo (las que fallaron recientemente al final).

## Entregables
1. Migración SQL: `gemini_api_keys`, `gemini_key_links`, RLS admin.
2. Edge functions: `_shared/gemini-keys.ts`, `gemini-key-test`, refactor de `poi-insights` e `isochrone-insights`.
3. Frontend: ruta + componentes admin, servicio, dropdown en header.
4. Seed opcional: si existe `GEMINI_API_KEY` en secrets y la tabla está vacía, la primera carga muestra un aviso "Importa tu key actual" con botón de un click.
