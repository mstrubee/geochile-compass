Diagnóstico encontrado:

- El patch anterior sí se desplegó: el log muestra 5.696 métricas paginadas, 64 POIs aptos, 0 sin UF y 0 con features todos en cero.
- El R² sigue bajo porque el modelo actual usa solo features territoriales estáticos. En los datos reales esos features tienen correlación muy débil con ventas 2025: la mejor correlación individual está cerca de 0,17.
- Además hay señales territoriales degeneradas: `n_anchors` y `n_complement_medium` están en 0 para todos los POIs, por lo que no aportan nada al modelo.
- El modelo actual elige `lambda=500` por LOO, lo que aplana predicciones: `sd(predicted_uf)` ≈ 40 UF contra `sd(actual_uf)` ≈ 569 UF. Resultado: predice casi el promedio para todos y queda en R² ≈ 2%.
- Probé el historial de ventas: el promedio 2024 por local explica 2025 con R² ≈ 93%; un modelo con features temporales simples llega a R² in-sample ≈ 96% y LOO ≈ 93%.

Plan de solución:

1. Cambiar `compute-performance-batch` de modelo puramente territorial a modelo híbrido temporal + territorial.
   - Mantener los features territoriales actuales para drivers de entorno.
   - Agregar features históricos por POI calculados desde `poi_metrics`:
     - promedio UF 2024
     - promedio UF 2023
     - promedio UF 2022
     - promedio últimos 6 meses 2024
     - promedio primeros 6 meses 2024
     - pendiente mensual 2024
     - pendiente últimos 24 meses pre-target
     - volatilidad 2024
     - crecimiento 2024 vs 2023
     - crecimiento H2 2024 vs H1 2024

2. Ajustar entrenamiento para evitar predicciones aplanadas.
   - Entrenar Ridge sobre el set híbrido.
   - Excluir features constantes o casi constantes antes de estandarizar, para evitar columnas inútiles (`n_anchors`, `n_complement_medium`).
   - Mantener validación LOO y devolver en logs `r_squared`, `cv_rmse`, `lambda`, cantidad de features usados y features descartados.

3. Corregir drivers mostrados al usuario.
   - Separar drivers temporales de drivers territoriales en `top_drivers` usando labels claros.
   - Evitar que un coeficiente de feature constante aparezca como driver.
   - Conservar el formato existente de `top_drivers` para no romper la UI.

4. Validar con ejecución real.
   - Desplegar la función `compute-performance-batch`.
   - Ejecutarla contra la carpeta Autoplanet.
   - Revisar logs y respuesta: esperamos R² > 30%; por los datos medidos debería quedar muy por encima si el historial entra correctamente.
   - Confirmar que se reescriben las 68 filas de `poi_performance_analysis` y que no hay errores de upsert.

Archivos a tocar:

- `supabase/functions/compute-performance-batch/index.ts`
  - agregar construcción de features temporales
  - filtrado de columnas constantes
  - labels nuevos
  - logs diagnósticos ampliados
  - cálculo de contribuciones con el set final de features