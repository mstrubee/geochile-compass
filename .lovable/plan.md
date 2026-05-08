# Plan para corregir inicio de sesión

## Diagnóstico

El botón sí ejecuta la acción: queda en estado ocupado (`…`) y luego aparece el error `Failed to fetch`.

Las solicitudes de red muestran que el navegador intenta renovar una sesión antigua con `refresh_token` y también falla el login por contraseña contra el endpoint de autenticación. El backend está activo, así que el problema más probable en la app es una sesión local corrupta/atascada que mantiene reintentos de refresh y deja la experiencia de login sin una recuperación clara.

## Cambios propuestos

1. **Endurecer `useAuth`**
   - Manejar errores de `getSession()` sin dejar `loading` bloqueado.
   - Si hay error al restaurar sesión, limpiar la sesión local con `signOut({ scope: "local" })`.
   - Exponer el estado `error` para que la UI pueda reaccionar.

2. **Corregir flujo de login en `Auth.tsx`**
   - Antes de iniciar sesión por email, limpiar cualquier sesión local previa/corrupta.
   - No navegar manualmente a `/` si `signInWithPassword` no devuelve una sesión válida.
   - Mostrar mensajes claros en español para errores de conexión o credenciales.
   - Rehabilitar siempre el botón si falla.

3. **Agregar acción de recuperación visible**
   - Si ocurre `Failed to fetch` o error de restauración de sesión, mostrar un botón tipo “Limpiar sesión y reintentar”.
   - Ese botón ejecutará logout local, limpiará el formulario sólo si corresponde, y permitirá intentar nuevamente sin depender del refresh token viejo.

4. **Verificación**
   - Revisar que el botón ya no quede aparentemente “sin hacer nada”.
   - Confirmar que ante error se muestra feedback útil y el usuario puede reintentar.
   - Mantener Google intacto salvo ajuste mínimo de mensajes si comparte el mismo estado `busy`.

## Archivos a modificar

- `src/hooks/useAuth.ts`
- `src/pages/Auth.tsx`
