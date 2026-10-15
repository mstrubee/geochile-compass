import { describe, expect, it } from "vitest";
import { groupsFromNodes, slugFromName } from "@/utils/territorialGroups";
import type { LayerNode } from "@/types/layerNodes";

const node = (over: Partial<LayerNode> & { id: string }): LayerNode => ({
  kind: "folder",
  name: over.id,
  parent_id: null,
  position: "a0",
  style: {},
  scope: "shared",
  owner_id: null,
  archived_at: null,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
  ...over,
});

describe("groupsFromNodes", () => {
  it("solo las carpetas raíz compartidas y activas; con id, nombre, color, ícono y slug del nodo", () => {
    const nodes = [
      node({ id: "F1", name: "Farmacias", position: "a1", style: { slug: "farmacias", color: "#10B981", icon: "cross", visible_default: true } }),
      node({ id: "F1a", name: "Cadenas", parent_id: "F1" }), // subcarpeta: no es grupo
      node({ id: "L1", kind: "layer", name: "Cruz Verde", parent_id: "F1" }), // capa
      node({ id: "P1", name: "Mía", scope: "personal", owner_id: "u1" }), // personal
      node({ id: "T1", name: "Papelera", archived_at: "2026-10-01T00:00:00Z" }), // en la papelera
    ];
    expect(groupsFromNodes(nodes)).toEqual([
      { id: "F1", name: "Farmacias", slug: "farmacias", color: "#10B981", icon: "cross", order_index: 0, visible_default: true },
    ]);
  });

  it("el orden es el del árbol (position, con id de desempate), no el order_index antiguo", () => {
    const g = groupsFromNodes([
      node({ id: "B", name: "B", position: "a1" }),
      node({ id: "A", name: "A", position: "a1" }),
      node({ id: "Z", name: "Z", position: "Zz" }), // 'Z' < 'a' por código de carácter: va primero
      node({ id: "C", name: "C", position: "a2" }),
    ]);
    expect(g.map((x) => x.id)).toEqual(["Z", "A", "B", "C"]);
    expect(g.map((x) => x.order_index)).toEqual([0, 1, 2, 3]);
  });

  it("sin slug en el estilo lo deriva del nombre; sin color o ícono quedan en null; visible_default parte en false", () => {
    const [g] = groupsFromNodes([node({ id: "X", name: "Mejoramiento del Hogar Ñandú" })]);
    expect(g).toMatchObject({ slug: "mejoramiento-del-hogar-nandu", color: null, icon: null, visible_default: false });
  });
});

describe("slugFromName", () => {
  it.each([
    ["Servitecas", "servitecas"],
    ["Retail / Tiendas", "retail-tiendas"],
    ["Clientes Domicilio eCom.", "clientes-domicilio-ecom"],
    ["Ñandú y Más", "nandu-y-mas"],
    ["  ---  ", "carpeta"],
    ["", "carpeta"],
  ])("%j → %j", (name, slug) => expect(slugFromName(name)).toBe(slug));
});
