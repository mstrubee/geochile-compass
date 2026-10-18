/**
 * Hover compartido de las coropletas comunales (useComunaHover). Se prueba con capas Leaflet reales sin mapa (jsdom no dibuja vectores): el resaltado persiste
 * mientras el puntero está sobre la comuna, se quita solo con mouseout, no queda pegado en otra y un re-render del padre NO lo borra.
 */
import { forwardRef, useLayoutEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const reg = vi.hoisted(() => ({ geos: [] as Array<{ geo: unknown; props: Record<string, unknown>; styleCalls: number }> }));
// react-leaflet.GeoJSON se sustituye por un equivalente FIEL del real: crea la capa una vez y, si cambia la identidad de `props.style`, llama layer.setStyle(style).
vi.mock("react-leaflet", async (orig) => {
  const real = await orig<typeof import("react-leaflet")>();
  const FakeGeoJSON = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    const state = useRef<{ geo: L.GeoJSON; prevStyle: unknown; entry: (typeof reg.geos)[number] } | null>(null);
    if (!state.current) {
      const geo = L.geoJSON(props.data as never, { style: props.style as never, onEachFeature: props.onEachFeature as never });
      const entry = { geo, props, styleCalls: 0 };
      reg.geos.push(entry);
      state.current = { geo, prevStyle: props.style, entry };
    }
    useLayoutEffect(() => {
      const s = state.current!;
      s.entry.props = props;
      if (s.prevStyle !== props.style) {
        s.entry.styleCalls++;
        (s.geo as unknown as { setStyle: (f: unknown) => void }).setStyle(props.style);   // igual que react-leaflet updateGeoJSON
        s.prevStyle = props.style;
      }
      if (typeof ref === "function") ref(s.geo);
      else if (ref) (ref as { current: unknown }).current = s.geo;
    });
    return null;
  });
  return { ...real, GeoJSON: FakeGeoJSON };
});

const geoIndex = vi.hoisted(() => ({ fc: null as unknown }));
vi.mock("@/hooks/useComunasGeoIndex", () => ({
  useComunasGeoIndex: () => ({ ready: true, fc: geoIndex.fc, nombresPorCodigo: { "90001": "Comuna Uno", "90002": "Comuna <b>Dos</b>" }, getIneStats: () => null, getBboxByName: () => null, getFeatureByName: () => null }),
}));
vi.mock("@/hooks/useAgroplanetData", () => ({ useAgroplanetData: () => ({ data: new Map(), loading: false }) }));

import { createComunaHover, nameTooltip, COMUNA_HIGHLIGHT } from "@/hooks/useComunaHover";
import { ChileCommunesLayer } from "@/components/map/ChileCommunesLayer";
import { HealthChoroplethLayer } from "@/components/map/HealthChoroplethLayer";
import { IsapreChoroplethLayer } from "@/components/map/IsapreChoroplethLayer";
import { PermitsChoroplethLayer } from "@/components/map/PermitsChoroplethLayer";
import { AgroplanetComunasLayer } from "@/components/map/AgroplanetComunasLayer";

const poly = (x: number): Geometry => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [90001, 90002].map((c, i) => ({ type: "Feature", properties: { codigo_comuna: String(c), nom_comuna: `C${c}` }, geometry: poly(i * 2) })),
};
const opts = (l: unknown) => (l as { options: Record<string, unknown> }).options;
const layersOf = (geo: unknown) => (geo as L.GeoJSON).getLayers() as L.Path[];

beforeEach(() => {
  reg.geos.length = 0;
  geoIndex.fc = FC;
});

describe("createComunaHover (núcleo)", () => {
  const setup = () => {
    let tone = "red";
    const style = (f?: Feature<Geometry, never>) => ({ fillColor: tone, fillOpacity: 0.5, color: "#000", weight: 0.6, name: (f as unknown as Feature)?.properties?.codigo_comuna });
    let geo: L.GeoJSON | null = null;
    const hover = createComunaHover(() => style as never, () => geo);
    geo = L.geoJSON(FC, { style: style as never, onEachFeature: (f, l) => hover.bind(l, nameTooltip(() => String(f.properties?.nom_comuna))) });
    return { geo, hover, setTone: (t: string) => { tone = t; }, layers: geo.getLayers() as L.Path[] };
  };

  it("el resaltado se aplica al entrar y PERSISTE mientras el puntero sigue sobre la comuna (aunque se restile todo)", () => {
    const { layers, hover } = setup();
    layers[0].fire("mouseover");
    expect(opts(layers[0])).toMatchObject({ weight: COMUNA_HIGHLIGHT.weight, fillOpacity: COMUNA_HIGHLIGHT.fillOpacity });
    for (let i = 0; i < 5; i++) hover.restyle();                  // lo que antes provocaba cada re-render de Index (cada 100 ms)
    expect(opts(layers[0])).toMatchObject({ weight: 2, fillOpacity: 0.85 });
    expect(opts(layers[1])).toMatchObject({ weight: 0.6, fillOpacity: 0.5 });
  });

  it("se quita SOLO con mouseout y vuelve al estilo ACTUAL (no al de la primera pintura)", () => {
    const { layers, hover, setTone } = setup();
    layers[0].fire("mouseover");
    setTone("blue");                                              // llegan datos nuevos mientras el puntero sigue encima
    hover.restyle();
    expect(opts(layers[0])).toMatchObject({ weight: 2 });
    expect(opts(layers[1])).toMatchObject({ fillColor: "blue" });
    layers[0].fire("mouseout");
    expect(opts(layers[0])).toMatchObject({ weight: 0.6, fillOpacity: 0.5, fillColor: "blue" });
    expect(hover.current()).toBeNull();
  });

  it("no queda pegado en otra comuna: al pasar de A a B solo B está resaltada, y el mouseout de A no apaga a B", () => {
    const { layers } = setup();
    layers[0].fire("mouseover");
    layers[1].fire("mouseover");
    expect(opts(layers[0])).toMatchObject({ weight: 0.6 });
    expect(opts(layers[1])).toMatchObject({ weight: 2 });
    layers[0].fire("mouseout");                                   // evento tardío de A
    expect(opts(layers[1])).toMatchObject({ weight: 2 });
    layers[1].fire("mouseout");
    expect(layersOf({ getLayers: () => layers }).every((l) => opts(l).weight === 0.6)).toBe(true);
  });

  it("tooltip sticky (sigue al cursor) con el NOMBRE como texto plano; el popup sigue siendo independiente", () => {
    const { layers } = setup();
    const t = layers[0].getTooltip()!;
    expect(t.options.sticky).toBe(true);
    const content = (t.getContent() as (l: L.Layer) => HTMLElement)(layers[0]);
    expect(content.textContent).toBe("C90001");
    const evil = nameTooltip(() => "<img src=x onerror=alert(1)>")(layers[0]);
    expect(evil.querySelector("img")).toBeNull();
    expect(evil.textContent).toBe("<img src=x onerror=alert(1)>");
    layers[0].bindPopup("popup");
    expect(layers[0].getPopup()).toBeTruthy();                    // el clic sigue abriendo el popup
  });

  it("si la capa se recrea, el resaltado de la anterior no se arrastra", () => {
    let geo: L.GeoJSON | null = null;
    const style = () => ({ weight: 0.6 });
    const hover = createComunaHover(() => style as never, () => geo);
    const make = () => L.geoJSON(FC, { style: style as never, onEachFeature: (f, l) => hover.bind(l, nameTooltip(() => "x")) });
    geo = make();
    (geo.getLayers()[0] as L.Path).fire("mouseover");
    const old = geo.getLayers()[0] as L.Path;
    geo = make();
    hover.restyle();
    expect(hover.current()).toBeNull();
    expect(opts(old)).toMatchObject({ weight: 2 });               // la vieja ya no se toca
    expect(opts(geo.getLayers()[0])).toMatchObject({ weight: 0.6 });
  });
});

type Case = { name: string; ui: () => JSX.Element; tooltipName: string };
const cases: Case[] = [
  { name: "Comunas de Chile", ui: () => <ChileCommunesLayer visible variable="poblacion" />, tooltipName: "Comuna Uno" },
  { name: "Establecimientos por comuna", ui: () => <HealthChoroplethLayer rows={[]} breaks={[]} filterText="f" />, tooltipName: "Comuna Uno" },
  { name: "Isapre: beneficiarios por comuna", ui: () => <IsapreChoroplethLayer rows={[]} filterText="f" />, tooltipName: "Comuna Uno" },
  { name: "Permisos de edificación", ui: () => <PermitsChoroplethLayer rows={[]} selection={{ mode: "year", year: 2025, month: null, metric: "units", display: "value", destination: "housing_total" }} breaks={[]} onSelectComuna={() => undefined} />, tooltipName: "Comuna Uno" },
  { name: "Agroplanet", ui: () => <AgroplanetComunasLayer visible scoreMode="combined" />, tooltipName: "" },
];

describe.each(cases)("capa «$name»", ({ ui, tooltipName }) => {
  it("un re-render del padre (Index re-renderiza cada 100 ms) NO cambia la identidad de `style` ni borra el resaltado; mouseout lo quita", () => {
    const { rerender } = render(ui());
    const entry = reg.geos[0];
    const [a, b] = layersOf(entry.geo);
    const styleBefore = entry.props.style;
    a.fire("mouseover");
    expect(opts(a)).toMatchObject({ weight: 2, fillOpacity: expect.any(Number) });
    for (let i = 0; i < 5; i++) rerender(ui());                    // simula las actualizaciones de coordenadas del puntero
    expect(entry.props.style).toBe(styleBefore);                   // causa del parpadeo: antes era una función nueva en cada render
    expect(entry.styleCalls).toBe(0);                              // react-leaflet no llamó setStyle sobre todas las comunas
    expect(opts(a).weight).toBe(2);                                // el resaltado persiste
    expect(opts(b).weight).not.toBe(2);
    a.fire("mouseout");
    expect(opts(a).weight).not.toBe(2);                            // se quita solo con mouseout
  });

  it("tooltip sticky de Leaflet en cada comuna y el popup sigue ligado al clic", () => {
    render(ui());
    const [a] = layersOf(reg.geos[0].geo);
    const t = a.getTooltip();
    expect(t).toBeTruthy();
    expect(t!.options.sticky).toBe(true);
    const content = t!.getContent() as ((l: L.Layer) => string | HTMLElement) | string;
    const text = typeof content === "function" ? content(a) : content;
    const plain = typeof text === "string" ? text : text.textContent;
    if (tooltipName) expect(plain).toBe(tooltipName);
    else expect(plain).toBeTruthy();
    if (tooltipName) expect(a.getPopup()).toBeTruthy();
  });

  it("al pasar de una comuna a otra, el resaltado no queda pegado en la anterior", () => {
    render(ui());
    const [a, b] = layersOf(reg.geos[0].geo);
    a.fire("mouseover");
    b.fire("mouseover");
    expect(opts(a).weight).not.toBe(2);
    expect(opts(b).weight).toBe(2);
    a.fire("mouseout");
    expect(opts(b).weight).toBe(2);
  });
});

describe("datos nuevos con el puntero encima", () => {
  it("Establecimientos: al cambiar las filas se restila todo y la comuna bajo el puntero sigue resaltada hasta el mouseout", () => {
    const row = (cut: string, n: number) => ({ cut, name: `Comuna ${cut}`, region_cut: "90", region_name: "R", establishments: n, imputed: 0, not_drawable: 0, marked_geo: 0, rank: 1, snapshot_id: "s", captured_at: "2026-01-01" });
    const { rerender } = render(<HealthChoroplethLayer rows={[row("90001", 1)]} breaks={[5, 10, 20, 50]} filterText="f" />);
    const [a, b] = layersOf(reg.geos[0].geo);
    const before = opts(b).fillColor;
    a.fire("mouseover");
    rerender(<HealthChoroplethLayer rows={[row("90001", 1), row("90002", 100)]} breaks={[5, 10, 20, 50]} filterText="f" />);
    expect(opts(a).weight).toBe(2);
    expect(opts(b).fillColor).not.toBe(before);                    // la otra sí se restiló con los datos nuevos
    a.fire("mouseout");
    expect(opts(a).weight).not.toBe(2);
  });
});
