## Diagnóstico

El backend tiene datos: hay 5.708 POI activos, 2.746 en papelera y 213 carpetas activas. El problema está en el arranque del cliente.

Se observan dos causas principales:

1. **Consultas POI con sesión incorrecta**
   - En la red aparecen cargas a `pois` usando el token anónimo en vez de la sesión del usuario.
   - Eso devuelve `[]`, activa `server=0 local=6500`, dispara un full refresh y puede sobrescribir el estado/caché con listas vacías.
   - También aparecen errores de lock de autenticación por varias consultas simultáneas al arrancar.

2. **Caché y full refresh demasiado agresivos**
   - Si una consulta falla o corre sin sesión válida, el módulo puede creer que no hay POI.
   - El caché local puede quedar contaminado por ese estado vacío.
   - El Sidecar muestra “Aún no hay POIs…” porque recibe `savedPois=[]` y `folders=[]` temporal o persistentemente.

## Plan de corrección

1. **Bloquear carga POI hasta que la sesión esté lista**
   - Actualizar `useSavedPois` y `usePoiFolders` para usar `loading` de autenticación.
   - No consultar ni vaciar estado mientras la autenticación todavía se está resolviendo.
   - Evitar que un render inicial sin sesión dispare consultas anónimas.

2. **Hacer el refresh tolerante a errores y a respuestas anónimas**
   - Si un full refresh devuelve 0 POI pero había caché/local previo, no sobrescribir inmediatamente con vacío.
   - Tratar `server=0` como sospechoso cuando existe estado local y reintentar más tarde, en vez de borrar el módulo.
   - Mantener el último snapshot bueno visible hasta confirmar una carga válida.

3. **Separar activo vs papelera en la verificación de integridad**
   - La función actual cuenta todos los POI, pero la UI principal depende de activos.
   - Ajustar la verificación para no provocar full refresh falso por diferencias entre activos/papelera.
   - Si hace falta, actualizar la función de resumen para devolver conteos activos y eliminados por separado.

4. **Evitar contaminación del caché local**
   - No guardar caché vacío cuando la carga viene de un fallo, de sesión ausente o de una respuesta sospechosa.
   - Guardar sólo snapshots confirmados.
   - Si se detecta caché corrupto/vacío frente a datos reales, forzar recuperación desde backend sin mostrar “no hay POI”.

5. **Reducir carreras de autenticación del Sidecar**
   - Cambiar `userUiPrefs` para no llamar `auth.getUser()` desde cada sección al mismo tiempo.
   - Usar la sesión ya disponible por contexto o aplazar preferencias remotas hasta que auth esté estable.
   - Esto debería eliminar gran parte de los errores `Lock was stolen by another request`.

6. **Mejorar el estado visual del Sidecar**
   - Mientras POI/carpetas están hidratando o recuperándose, mostrar estado de carga/recuperación, no “Aún no hay POIs”.
   - Sólo mostrar “no hay POI” después de una carga confirmada y estable.

7. **Verificación**
   - Confirmar que las consultas a `pois` usan el token del usuario, no el token anónimo.
   - Confirmar que no vuelve a aparecer `server=0 local=...` durante carga normal.
   - Confirmar que el Sidecar lista las 213 carpetas y el contador principal refleja los POI activos sin desaparecer.