## Objetivo

Corregir únicamente la causa de la recarga/crash de la página principal, sin rediseñar, sin cambiar flujos, sin tocar administración de API keys, permisos, imports, rutas ni lógica no relacionada.

## Alcance estricto

Solo se tocará código si está directamente relacionado con una de estas dos causas posibles:

1. Carga/render excesivo en la página principal `/`.
2. Llamadas largas a funciones backend que puedan dejar la pestaña inestable.

No se hará ninguna mejora adicional.

## Plan mínimo

### 1. Confirmar la causa exacta antes de editar
- Revisar señales de navegador: memoria, CPU, requests repetidos y errores.
- Revisar logs de funciones backend solo si aparece una llamada lenta/fallida relacionada con el momento de la recarga.
- No cambiar nada hasta identificar qué dispara la caída.

### 2. Si la causa es carga masiva de capas territoriales
Aplicar solo un parche defensivo:
- Evitar que la app restaure automáticamente demasiadas capas territoriales visibles desde `localStorage` al abrir `/`.
- Limitar la concurrencia de carga de features para que no se disparen decenas de requests simultáneos.
- No cambiar el diseño ni la forma de usar las capas.

Archivos máximos en este caso:
- `src/hooks/useTerritorialVisibility.tsx`
- `src/hooks/useTerritorialLayers.ts`

### 3. Si la causa es una función backend lenta o con timeout
Aplicar solo un parche defensivo:
- Evitar que el frontend quede esperando indefinidamente.
- Manejar timeout/error devolviendo estado controlado al usuario.
- No implementar una cola completa salvo que se confirme que esa función realmente está superando límites y que no hay alternativa menor.

Archivos máximos en este caso:
- El servicio/hook frontend que llama esa función.
- La función backend específica que esté fallando, solo si es imprescindible.

### 4. Validación mínima
- Abrir `/` con el viewport actual.
- Confirmar que no se dispara una explosión de requests.
- Confirmar que la página se mantiene estable y no se recarga.
- Verificar que las funciones principales existentes siguen iguales: mapa, sidebar y capas.

## Exclusiones explícitas

No se tocará:
- Administración de API keys.
- Header.
- Pantallas admin.
- Autenticación/permisos.
- Diseño visual.
- Base de datos o migraciones, salvo que una función backend confirmada lo requiera.
- Refactors generales o limpieza de código.

## Resultado esperado

Un cambio pequeño y focalizado que elimine la causa de la recarga sin alterar el comportamiento del resto de la app.