## Problema detectado

El login sí está ejecutando la acción, pero el navegador queda atrapado intentando refrescar una sesión local antigua (`refresh_token`) y aparece `Failed to fetch`. Además, la app llama `useAuth()` en varios componentes/hooks, y cada llamada crea su propio `onAuthStateChange` + `getSession()`. Eso puede provocar carreras de sesión y el error observado: `Lock broken by another request with the 'steal' option`.

## Plan de corrección

1. **Centralizar el estado de autenticación**
   - Crear un proveedor global de auth en la raíz de la app.
   - Hacer que `useAuth()` solo consuma ese contexto, en vez de crear múltiples listeners por componente.
   - Mantener un único `onAuthStateChange` y una única restauración inicial de sesión.

2. **Evitar carreras y bloqueos de sesión**
   - Manejar `getSession()` con `try/catch/finally` para que `loading` nunca quede bloqueado.
   - Si la sesión local está corrupta, limpiar solo la sesión local y permitir reintentar.
   - Evitar llamadas auth pesadas dentro del callback de `onAuthStateChange`.

3. **Ajustar la pantalla `/auth`**
   - Usar el estado global de auth.
   - Antes de login por email, limpiar tokens locales corruptos si hay error previo.
   - Mostrar feedback visible en español si falla la conexión o las credenciales.
   - Dejar el botón siempre reactivado si falla.

4. **Ajustar montaje global**
   - Envolver las rutas con el nuevo `AuthProvider` en `App.tsx`.
   - Conservar Google OAuth y el resto de la app sin cambios funcionales.

5. **Verificación**
   - Probar `/auth` en preview.
   - Confirmar que el botón ya no queda “sin hacer nada”.
   - Revisar que desaparezca el error `Lock broken by another request with the 'steal' option` y que el login por email avance o muestre un mensaje claro.