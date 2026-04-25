## Objetivo

Crear un mapa interactivo simple de Chile con las 346 comunas usando react-leaflet, accesible en una nueva ruta `/comunas`, sin tocar la app principal existente.

## Supuesto

El archivo `public/comunas.geojson` lo subes tú manualmente. El componente lo consumirá vía `fetch("/comunas.geojson")`. Si aún no existe, se mostrará un mensaje de carga indefinido (puedo agregar manejo de error si lo prefieres).

## Archivos

### 1. Crear `src/components/MapaComunas.tsx`

Componente con:

- `import "leaflet/dist/leaflet.css"` al inicio.
- Interfaz `ComunaProps { cod_comuna: string; nom_comuna: string }`.
- Tipos importados: `Feature, FeatureCollection, Geometry` de `"geojson"`, `Layer` de `"leaflet"`.
- `useState<FeatureCollection<Geometry, ComunaProps> | null>(null)` para el GeoJSON.
- `useEffect` con `fetch("/comunas.geojson").then(r => r.json()).then(setData)`.
- Contenedor raíz: `<div className="w-full h-full min-h-[500px]">`.
- `<MapContainer center={[-35.5, -71.0]} zoom={5} style={{ width: "100%", height: "100%" }}>`.
- `<TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' />`.
- `<GeoJSON data={data} style={() => ({ fillColor: "#3b82f6", fillOpacity: 0.45, color: "#1e3a8a", weight: 0.6 })} onEachFeature={(feature, layer) => layer.bindPopup(...)} />` renderizado solo cuando `data` exista.
- Popup con HTML: `<strong>{nom_comuna}</strong><br/>Código: {cod_comuna}`.

### 2. Crear `src/pages/MapaComunasPage.tsx`

Página wrapper:
```tsx
<div className="h-screen w-screen">
  <MapaComunas />
</div>
```

### 3. Editar `src/App.tsx`

Agregar la ruta **antes** del catch-all `*`:
```tsx
<Route path="/comunas" element={<MapaComunasPage />} />
```

## No se hará

- No instalar dependencias (`leaflet`, `react-leaflet` ya están; los tipos `geojson` vienen vía `@types/geojson` transitivo).
- No tocar `Index.tsx`, `MapView.tsx` ni la app existente.
- No agregar hover, coloreado dinámico, búsqueda, ni props.
- No crear el archivo `comunas.geojson` (lo subes tú).

## Verificación

Tras aplicar los cambios y subir el `comunas.geojson`, abrir `/comunas` en el preview debe mostrar Chile completo con polígonos azules semitransparentes y popup al hacer click en cada comuna.