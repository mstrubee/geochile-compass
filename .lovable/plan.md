## Problema

El informe de IA sigue mostrando fechas/meses del futuro respecto al último mes con ventas registradas. La validación actual solo busca el patrón "mes año" en español, así que se le escapan casos como:

- Años a secas: "en 2027", "para 2027", "el próximo año".
- Trimestres/proyecciones: "próximo trimestre", "proyectado", "estimación", "se espera".
- Meses sin año junto a un año del futuro.

Además, hoy se está pasando al modelo `analysis.target_year` y `temporal_decomposition` con períodos que pueden ser posteriores al último mes registrado, lo cual lo empuja a inventar fechas futuras.

## Alcance estricto

Solo se tocará lo necesario para evitar fechas del futuro en el informe de IA, sin cambiar nada más de la app.

## Plan mínimo

### 1. Sanitizar el payload enviado al modelo (frontend)

Archivo: `src/components/panels/PoiAnalysisPanel.tsx`

- Eliminar `target_year` del objeto `analysis` que se envía a `poi-insights`, o reemplazarlo por `latestRegisteredPeriodLabel` para que el modelo no tenga ningún ancla de año futuro.
- Filtrar `temporal_decomposition` para descartar tramos cuyo período sea posterior al `latestRegisteredPeriod`.
- No cambiar el panel visual ni el flujo del botón.

### 2. Endurecer el prompt y la validación en el backend

Archivo: `supabase/functions/poi-insights/index.ts`

- Endurecer el `systemPrompt`:
  - Prohibir explícitamente menciones a años o trimestres posteriores a `latestRegisteredPeriod`.
  - Prohibir lenguaje predictivo: "próximo", "próximos", "futuro", "proyección", "proyectado", "estimación", "se espera", "se proyecta".
  - Bajar `temperature` a 0 para reducir alucinaciones.
- Mejorar `mentionsInvalidMonths` y renombrar lógicamente a "menciones inválidas":
  - Seguir detectando "mes año" fuera del rango permitido.
  - Detectar cualquier año de 4 dígitos > año del último período registrado.
  - Detectar palabras predictivas listadas arriba.
- Si la validación falla, reemplazar por `buildSafeSummary` como ya se hace hoy.

### 3. Validación

- Generar el informe sobre un POI con datos hasta el mes X.
- Confirmar que el texto no menciona meses, trimestres ni años posteriores a X.
- Confirmar que el resto del informe sigue funcionando igual.

## Exclusiones explícitas

No se tocará:
- Administración de API keys.
- Lógica de rotación de keys.
- Header, sidebar, panel admin, autenticación.
- UI/estilos del panel de análisis.
- Otras funciones backend.

## Resultado esperado

El informe generado por IA nunca menciona fechas, trimestres ni años posteriores al último mes con ventas registradas. Si el modelo intenta hacerlo, el backend lo reemplaza automáticamente por el resumen seguro determinístico ya existente.