import { describe, expect, it } from "vitest";
import { exportLayerTreeAsCsv, layerTreeToCsvTable } from "@/utils/layerCsvExport";
import type { KmzNode } from "@/utils/kmzExport";

const pt = (lng: number, lat: number): GeoJSON.Geometry => ({ type: "Point", coordinates: [lng, lat] });

const tree: KmzNode = {
  name: "Retail",
  children: [
    {
      name: "Farmacias",
      features: [
        { name: "Cruz Verde Centro", geometry: pt(-70.65, -33.44), properties: { comuna: "Santiago", rating: 4.5 } },
        { name: "Salcobrand Sur", geometry: pt(-70.7, -33.5), properties: { comuna: "San Bernardo", horario: { lun: "9-18" } } },
      ],
    },
    {
      name: "Zonas",
      children: [
        { name: "Norte", features: [{ name: "Polígono 1", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: null }] },
      ],
    },
  ],
};

describe("layerTreeToCsvTable", () => {
  const { headers, rows } = layerTreeToCsvTable(tree);

  it("una fila por punto, con la ruta de carpetas sin repetir la carpeta exportada", () => {
    expect(rows.map((r) => r.layer_name)).toEqual(["Farmacias", "Farmacias", "Zonas / Norte"]);
    expect(rows.map((r) => r.name)).toEqual(["Cruz Verde Centro", "Salcobrand Sur", "Polígono 1"]);
  });

  it("columnas fijas primero y después la unión de atributos, ordenada", () => {
    expect(headers).toEqual(["layer_name", "name", "lat", "lng", "geometry_type", "comuna", "horario", "rating"]);
  });

  it("lat/lng solo en los puntos; el resto de geometrías queda con el tipo", () => {
    expect(rows[0]).toMatchObject({ lat: -33.44, lng: -70.65, geometry_type: "Point" });
    expect(rows[2]).toMatchObject({ lat: "", lng: "", geometry_type: "Polygon" });
  });

  it("los atributos anidados van como JSON y los que faltan quedan vacíos", () => {
    expect(rows[1].horario).toBe('{"lun":"9-18"}');
    expect(rows[0].horario).toBe("");
    expect(rows[2].comuna).toBe("");
  });

  it("exportar una sola capa conserva su nombre en la columna", () => {
    const layer = layerTreeToCsvTable({ name: "Farmacias", features: [{ name: "A", geometry: pt(1, 2) }] });
    expect(layer.rows[0].layer_name).toBe("Farmacias");
  });
});

describe("exportLayerTreeAsCsv", () => {
  it("si no hay puntos no descarga nada y dice por qué", () => {
    expect(() => exportLayerTreeAsCsv({ name: "Vacía", features: [] })).toThrow(/“Vacía” no tiene puntos para exportar/);
  });
});
