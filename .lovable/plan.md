## Diagnóstico

Los network logs muestran que las 4 URLs devuelven `200 OK` con GeoJSON válido (~6 MB, empieza con `{"type":"FeatureCollection",...`). Sin embargo, en consola las 4 fallan con:

```
SyntaxError: The string did not match the expected pattern.
```

Este mensaje es específico de WebKit y aparece cuando `Response.json()` lee de una entry corrupta/parcial del HTTP cache. El código usa `fetch(url, { cache: "force-cache" })`, lo que fuerza al navegador a servir desde cache incluso si el body cacheado quedó truncado en un load anterior (probablemente el primer intento contra `/crime/...` cuando todavía no estaba el bucket).

Como el fallo ocurre en las 4 URLs simultáneamente —incluida `/crime/...` que es same-origin y nunca tuvo CSP/CORS— se descarta:
- problema del archivo (los logs muestran JSON válido)
- CSP / CORS
- URL incorrecta del bucket Supabase (el primer URL responde 200 con el FeatureCollection esperado)

## Plan

Editar **únicamente** `src/components/map/CrimeLayer.tsx` en la función `loadData`:

1. **Quitar `cache: "force-cache"`** y usar `cache: "no-store"` en el primer intento, para forzar bypass del cache corrupto. Una vez cargado, el cache en memoria (`_cache`) ya evita re-fetches en la misma sesión.

2. **Separar el parseo del fetch** para localizar el error con precisión:
   ```ts
   const r = await fetch(url, { cache: "no-store" });
   if (!r.ok) throw new Error(`HTTP ${r.status}`);
   const text = await r.text();
   try {
     const data = JSON.parse(text) as GeoJSON.FeatureCollection;
     ...
   } catch (parseErr) {
     throw new Error(`JSON parse failed (len=${text.length}, head="${text.slice(0,40)}"): ${parseErr}`);
   }
   ```
   Así, si el problema persiste, el mensaje de error mostrará el tamaño real y los primeros 40 caracteres recibidos, lo que permite distinguir entre "cache corrupto", "respuesta truncada" o "JSON realmente inválido".

3. **Agregar header `Accept: application/json`** para evitar que algún proxy/CDN devuelva HTML alternativo.

4. **Validar `data.features` antes de cachear**: si no es un array, tratar como fallo y pasar al siguiente URL.

No se tocan otros archivos. El bucket de Supabase, la migration y el upload ya están correctos (el GET devuelve 200 con el body esperado).

## Validación

- Typecheck (`tsc --noEmit`) debe pasar.
- En el preview, activar la capa "Riesgo Delictivo" y confirmar en consola el log `✅ cargado desde https://tcmyidycqdrrtwuaovbk.supabase.co/...` con 346 comunas.
- Si aún falla, el nuevo mensaje de error indicará exactamente qué llega al cliente.
