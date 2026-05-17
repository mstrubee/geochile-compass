## Diagnóstico

- La función `poi-insights` **no está usando Gemini directo**: hoy llama a `https://ai.gateway.lovable.dev/...` con `LOVABLE_API_KEY`, aunque el modelo configurado sea `google/gemini-2.5-flash`.
- Para devolverlo a Gemini directo, debe usar `GEMINI_API_KEY` y `generativelanguage.googleapis.com` como ya hace `isochrone-insights`.
- El corrector actual solo reemplaza menciones textuales de meses fuera de rango. No valida que la cifra asociada exista en la serie, y además el flujo del panel “Resumen” no envía `salesContext`; depende de `aggregates`, donde puede entrar un `latest` no confiable si hay registros cargados hasta junio.

## Plan de implementación

1. **Devolver `poi-insights` a Gemini directo**
   - Reemplazar la llamada al gateway por la API Gemini con `GEMINI_API_KEY`.
   - Mantener modelo Gemini configurable, con fallback a un modelo Gemini.
   - No usar `LOVABLE_API_KEY` en esta función.

2. **Enviar a Gemini solo ventas realmente disponibles y explícitas**
   - En `poiInsightsService.ts`, construir `salesContext` desde la métrica `ventas` dentro de los `aggregates`.
   - Incluir:
     - `latestRegisteredPeriod`
     - `latestRegisteredPeriodLabel`
     - `availablePeriods`
     - `recentSeries`
   - Filtrar el payload para que Gemini reciba como “desempeño reciente” únicamente la métrica `ventas` y sus períodos reales disponibles, no un contexto ambiguo.

3. **Eliminar ambigüedad por `target_year` y por meses no cerrados**
   - Ajustar el prompt para que el informe no diga “año cerrado” ni infiera meses por año objetivo.
   - Si no existe `salesContext` para ventas, la función debe responder “Datos insuficientes” en vez de pedirle al modelo que infiera.

4. **Reemplazar el corrector débil por validación determinística**
   - Validar todas las menciones tipo `mes año` contra `salesContext.availablePeriods`.
   - Si aparece un mes no disponible, no solo reemplazar el texto: devolver un resumen seguro generado por código usando `latestRegisteredPeriodLabel` y `recentSeries`.
   - Validar también cifras CLP mencionadas para el último mes: deben coincidir con el valor de `recentSeries` para ese período. Si no coinciden, usar resumen seguro.

5. **Verificar con un caso que incluya “junio 2026”**
   - Probar localmente la lógica del validador con una respuesta que diga “Las ventas de junio 2026 fueron...” y un payload cuyo último mes sea abril 2026.
   - Confirmar que el resultado final no contiene junio 2026 ni cifras inventadas.

6. **Redeploy de `poi-insights`**
   - Desplegar la función corregida para que el preview use la versión actualizada.