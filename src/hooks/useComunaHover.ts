/**
 * Resaltado por hover + tooltip con el nombre de la comuna, COMPARTIDO por todas las coropletas comunales
 * (Comunas de Chile, Establecimientos por comuna, Isapre, Permisos, Agroplanet, Delitos).
 *
 * CAUSA del resaltado que duraba un instante (diagnosticada): `Index` guarda las coordenadas del puntero (`setCoords`, cada 100 ms) y re-renderiza todo el árbol del mapa.
 * Cada capa definía `styleFor` dentro del componente (función nueva en cada render) y se la pasaba a `<GeoJSON style={styleFor}>`; `react-leaflet` compara `props.style !== prevProps.style`
 * y, al ser distinta, llama `layer.setStyle(style)` sobre TODAS las comunas: borra el resaltado de la que está bajo el puntero ≤ 100 ms después de aplicarlo. Además el
 * `mouseout` nunca restauraba el estilo («el destacado persiste hasta otra comuna») y `resetStyle` usa el estilo del PRIMER render (datos viejos), no el actual.
 *
 * Aquí: (1) el `style` que recibe `<GeoJSON>` tiene identidad ESTABLE (lee siempre el último `styleFor` desde un ref), así un re-render no restila nada;
 * (2) `restyle()` —para cuando cambian los datos— vuelve a aplicar el resaltado a la comuna que sigue bajo el puntero; (3) `mouseout` quita el resaltado de ESA comuna y solo de ella,
 * restaurando con el estilo ACTUAL; (4) el tooltip es `sticky` de Leaflet (sigue al cursor) y el clic sigue abriendo el popup.
 */
import { useCallback, useMemo, useRef } from "react";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, Path, PathOptions, TooltipOptions } from "leaflet";

export const COMUNA_HIGHLIGHT: PathOptions = { weight: 2, color: "hsl(199 89% 70%)", fillOpacity: 0.85 };

type StyleFn = (feature?: Feature<Geometry, never>) => PathOptions;
export type TooltipContent = string | HTMLElement | ((layer: Layer) => string | HTMLElement);

export interface ComunaHoverOptions {
  highlight?: PathOptions;
  /** opciones extra del tooltip (por defecto: sticky, dirección automática) */
  tooltip?: TooltipOptions;
}

/** Un tooltip de texto plano (nunca HTML): el nombre llega de datos externos. */
export const nameTooltip = (name: () => string): ((layer: Layer) => HTMLElement) => () => {
  const el = document.createElement("span");
  el.textContent = name();
  return el;
};

/**
 * Núcleo sin React (lo usan el hook y las capas imperativas como la de delitos).
 * `getGeo` devuelve la capa GeoJSON actual (para saber si el resaltado sigue vigente tras recrearla).
 */
export const createComunaHover = (getStyle: () => StyleFn, getGeo: () => LeafletGeoJSON | null, options: ComunaHoverOptions = {}) => {
  const hl = () => options.highlight ?? COMUNA_HIGHLIGHT;
  let hovered: Path | null = null;

  const restore = (layer: Path) => layer.setStyle(getStyle()((layer as unknown as { feature?: Feature<Geometry, never> }).feature));

  const bind = (layer: Layer, content: TooltipContent, tooltipOptions: TooltipOptions = {}) => {
    layer.bindTooltip(content as never, { sticky: true, direction: "auto", opacity: 0.95, className: "comuna-hover-tooltip", ...options.tooltip, ...tooltipOptions });
    layer.on({
      mouseover: (e) => {
        const next = e.target as Path;
        if (hovered && hovered !== next) restore(hovered);
        next.setStyle(hl());
        next.bringToFront();
        hovered = next;
      },
      mouseout: (e) => {
        const l = e.target as Path;
        if (hovered === l) {
          restore(l);
          hovered = null;
        }
      },
    });
  };

  /** Re-aplica el estilo vigente a TODAS las comunas (cambiaron los datos) sin perder el resaltado de la que está bajo el puntero. */
  const restyle = () => {
    const geo = getGeo();
    if (!geo) return;
    geo.setStyle(getStyle() as never);
    if (hovered && !geo.hasLayer(hovered)) hovered = null;             // la capa se recreó: el resaltado anterior ya no existe
    if (hovered) hovered.setStyle(hl());
  };

  return { bind, restyle, current: () => hovered };
};

/**
 * Hook para las capas con `<GeoJSON>` de react-leaflet.
 *   const hover = useComunaHover(styleFor);
 *   useEffect(() => hover.restyle(), [datos…]);
 *   <GeoJSON ref={hover.setRef} style={hover.style} onEachFeature={(f, l) => hover.bind(l, nameTooltip(() => nombre))} />
 */
export const useComunaHover = (styleFor: (feature?: Feature<Geometry, never>) => PathOptions, options: ComunaHoverOptions = {}) => {
  const geoRef = useRef<LeafletGeoJSON | null>(null);
  const styleRef = useRef(styleFor);
  styleRef.current = styleFor;
  const optsRef = useRef(options);
  optsRef.current = options;

  /** Identidad estable: `<GeoJSON style>` no cambia entre renders, así que react-leaflet no llama setStyle. */
  const style = useCallback((f?: Feature<Geometry, never>) => styleRef.current(f), []);
  const setRef = useCallback((r: unknown) => {
    geoRef.current = r as LeafletGeoJSON | null;
  }, []);
  const core = useMemo(
    () => createComunaHover(() => style, () => geoRef.current, { get highlight() { return optsRef.current.highlight; }, get tooltip() { return optsRef.current.tooltip; } }),
    [style],
  );
  return { style, setRef, bind: core.bind, restyle: core.restyle, current: core.current };
};
