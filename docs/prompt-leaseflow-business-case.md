# Prompt para LeaseFlow — Business Case de ventas proyectadas

Copia el bloque de abajo y pégalo en LeaseFlow. Configura cómo debe presentar la
proyección de ventas que llega desde Geochile (`export-sales-projection`).

---

## El prompt

```
Vas a construir el Business Case financiero de un local nuevo usando la
proyección de ventas que entrega la API de Geochile (export-sales-projection).

CONTEXTO QUE DEBES ENTENDER ANTES DE USAR LOS NÚMEROS

La proyección de ventas para una ubicación nueva NO es una predicción confiable.
Se validó con leave-one-out sobre los 64 locales con venta real: el modelo de
comparables explica solo 2,5% de la varianza, y predecir la mediana de la red le
gana a cualquier combinación de variables disponibles. En la práctica el modelo
devuelve un valor cercano a la mediana de la red para casi cualquier ubicación.

Por eso el campo `estimatedUf` NO debe presentarse como "la venta esperada de
este local". Es, en el mejor de los casos, "lo que vende un local promedio de
esta red".

CÓMO PRESENTAR LA CIFRA

Usa dos escenarios, siempre los dos juntos, nunca uno solo:

1. ESCENARIO CENTRAL = networkReference.medianUf (y medianClp)
   Etiquétalo como "Escenario central (mediana de la red)".

2. ESCENARIO CONSERVADOR = networkReference.p25Uf (y p25Clp)
   Etiquétalo como "Escenario conservador (percentil 25)".

Corre el Business Case completo — flujo, VAN, TIR, payback — en AMBOS
escenarios, y muestra los dos resultados lado a lado.

POR QUÉ LOS DOS

El riesgo es asimétrico. El arriendo es un costo fijo comprometido por años; la
venta es variable. Con la mediana hay aproximadamente 50% de probabilidad de
vender menos de lo proyectado. Un negocio que solo cierra con la mediana es una
decisión que depende de acertarle al lado bueno, y quien firma tiene derecho a
saberlo.

Redacta la conclusión así:
- Si cierra en AMBOS escenarios: "el caso se sostiene incluso en el escenario
  conservador".
- Si cierra solo con la mediana: "el caso depende de que el local rinda al menos
  como la mediana de la red; en el escenario conservador no se sostiene". NO
  digas que el proyecto es inviable — di explícitamente de qué depende.
- Si no cierra en ninguno: "el caso no se sostiene ni en el escenario central".

VERIFICACIÓN OBLIGATORIA DE APLICABILIDAD

Antes de usar cualquier cifra, compara la población del área de influencia de la
ubicación contra `applicabilityRange` (minPopulation / maxPopulation).

Si la población queda FUERA de ese rango, debes encabezar el informe con esta
advertencia y NO presentar el VAN/TIR como si fueran válidos:

  "ADVERTENCIA: la población del área de influencia (X habitantes) está fuera
  del rango de los locales que sostienen el modelo (min a max habitantes). Las
  cifras de venta proyectada no son aplicables a esta ubicación. Se requiere un
  estudio específico antes de decidir."

Esto no es un tecnicismo: la red son locales urbanos maduros. En una ubicación
mucho más chica el modelo infla la cifra. Un caso real: una localidad de ~25.000
habitantes recibió una proyección superior a 100 millones de CLP mensuales,
cuando el local comparable más pequeño de la red está en ~41.500 habitantes.

QUÉ NO HACER

- No presentes `estimatedUf` como predicción precisa de este local.
- No uses solo el escenario central.
- No inventes decimales ni intervalos de confianza que la API no entrega.
- No omitas la advertencia de aplicabilidad cuando corresponda, ni la conviertas
  en una nota al pie: va al encabezado.
- No reemplaces la conclusión por un veredicto binario "viable/no viable"; di
  siempre de qué depende.

TRANSPARENCIA EN EL INFORME

Incluye una sección corta de "Base del cálculo" que indique:
- Cuántos locales sostienen la referencia (networkReference.nStores)
- Sobre qué se calculó (networkReference.basis)
- El texto de `modelCaveat` tal como llega en la respuesta

El objetivo es que quien lea el Business Case entienda el grado de
incertidumbre, no que el informe parezca más preciso de lo que es.
```

---

## Campos de la API que usa el prompt

Todos vienen de `POST /functions/v1/export-sales-projection`:

| Campo | Qué es |
|---|---|
| `networkReference.medianUf` / `.medianClp` | Escenario central: mediana de la red |
| `networkReference.p25Uf` / `.p25Clp` | Escenario conservador: percentil 25 |
| `networkReference.nStores` | Cuántos locales sostienen la referencia |
| `networkReference.basis` | Sobre qué se calculó |
| `applicabilityRange.minPopulation` / `.maxPopulation` | Rango de población válido |
| `modelCaveat` | Advertencia de interpretación, en texto |
| `estimatedUf`, `ventaMes` | Contrato previo, se mantienen sin cambios |

## Por qué el prompt está redactado así

- **Pide los dos escenarios siempre**, porque el sesgo natural al armar un caso
  es quedarse con el número que lo hace cerrar.
- **Prohíbe el veredicto binario.** "No viable" oculta información: lo útil es
  saber que el caso depende de rendir al menos como la mediana.
- **La advertencia de aplicabilidad va al encabezado, no al pie.** Una nota al
  pie no cambia decisiones.
- **Pide incluir `modelCaveat` textual**, para que la limitación viaje con el
  informe y no se pierda cuando alguien reenvíe solo el resumen.

La verificación de población es manual porque la isócrona guardada no almacena su
población: la API entrega el rango, pero no puede decidir sola si la ubicación
cae dentro. Si esto se vuelve frecuente, vale persistir la población del área en
la isócrona y que la propia API levante la bandera.
