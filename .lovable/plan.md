# Problema

El botón **"Guardar por defecto"** (Sidebar → Isócronas) llama a `saveIsoMinutesAsDefault` en `src/pages/Index.tsx`. La persistencia mezcla dos formatos incompatibles, lo que provoca que los valores se pierdan o no se restauren al recargar.

# Causa raíz

En `src/pages/Index.tsx`:

- **Guardado** (línea 366-383): escribe en `localStorage` como objeto `{ min1, min2, min3 }`.
- **Lectura** (línea 331-350): acepta tanto el objeto como un array `[a,b,c]`, pero el chequeo del objeto es frágil: `[v.min1, v.min2, v.min3].every(n => typeof n === "number")` — si el usuario deja un campo vacío, el input lo envía como `0` ✓ pero si alguna vez se guarda `undefined`/`null`, el `pick` cae al `FALLBACK_MINUTES` y el usuario pierde sus valores.
- Además, el `useEffect` de montaje (línea 353) sólo corre una vez con `[]`; si la lectura de `readIsoDefaults` devuelve el fallback por cualquier motivo, los valores guardados nunca se aplican aunque estén en `localStorage`.
- Cualquier mode-switch posterior llama a `handleIsoModeChange`, que vuelve a leer y, si el formato no matchea, sobrescribe a `[5,7,10]`.

# Solución

1. **Unificar el formato a array `[number, number, number]`** en escritura y lectura — más simple y consistente con el resto del código (`isoMinutes: number[]`).
2. **Endurecer la lectura**: aceptar arrays de longitud ≥1 y rellenar con 0 si faltan elementos, en lugar de descartar todo el bloque.
3. **Sanear al guardar**: convertir explícitamente cada valor con `Number(...)` y guardar siempre los 3 valores actuales del estado.
4. **Confirmar con toast** que mencione el modo guardado (ej. "Defaults guardados para Vehículo") para dar feedback claro al usuario.
5. **Verificar** en el navegador: editar valores → click "Guardar por defecto" → recargar → confirmar que los inputs muestran los valores guardados; cambiar de modo y volver → confirmar que cada modo conserva los suyos.

# Cambios de código

- `src/pages/Index.tsx`:
  - `saveIsoMinutesAsDefault`: persistir como array `[a,b,c]`.
  - `readIsoDefaults` → `pick`: aceptar array y normalizar a 3 enteros.
  - Mensaje de toast con etiqueta del modo.

Sin cambios en `Sidebar.tsx` (la UI ya funciona).
