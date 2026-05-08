import { parseLeafletHtml } from "./territorial-parser.ts";

let pass = 0, fail = 0;
const assert = (cond: unknown, msg: string) => {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m " + msg); }
  else { fail++; console.log("  \x1b[31m✗\x1b[0m " + msg); }
};

// ----------------------------------------------------------------------------
// Test 1: chained .addTo (the original bug)
// ----------------------------------------------------------------------------
console.log("\n[1] Chained .addTo on constructor");
{
  const html = `
    var map_x = L.map("foo");
    var feature_group_abc = L.featureGroup({}).addTo(map_x);
    var marker_1 = L.marker([10.5, -20.25], {opacity: 0.8}).addTo(feature_group_abc);
    var polygon_1 = L.polygon([[1,2],[3,4],[5,6]], {}).addTo(feature_group_abc);
    var ctrl = L.control.layers({}, {"Zonas Norte": feature_group_abc}).addTo(map_x);
  `;
  const layers = parseLeafletHtml(html);
  assert(layers.length === 1, "yields exactly 1 layer");
  assert(layers[0]?.name === "Zonas Norte", `layer name resolved to display name (got: ${layers[0]?.name})`);
  assert(layers[0]?.features.length === 2, `2 features under the layer (got: ${layers[0]?.features.length})`);
  const m = layers[0]?.features[0];
  assert(m?.geometry?.type === "Point" && m.geometry.coordinates[0] === -20.25 && m.geometry.coordinates[1] === 10.5,
    "marker coords as [lng, lat]");
  const p = layers[0]?.features[1];
  assert(p?.geometry?.type === "Polygon" && p.geometry.coordinates[0].length === 4,
    "polygon ring closed (4 points incl. closing)");
}

// ----------------------------------------------------------------------------
// Test 2: subGroup with parent as first arg + transitive resolution
// ----------------------------------------------------------------------------
console.log("\n[2] L.featureGroup.subGroup(parent, ...) transitive");
{
  const html = `
    var map_x = L.map("foo");
    var fg_outer = L.featureGroup({}).addTo(map_x);
    var fg_inner = L.featureGroup.subGroup(fg_outer).addTo(map_x);
    var marker_a = L.marker([1.1, 2.2]).addTo(fg_inner);
    var ctrl = L.control.layers({}, {"Outer Visible": fg_outer}).addTo(map_x);
  `;
  const layers = parseLeafletHtml(html);
  assert(layers.length === 1, "1 layer");
  assert(layers[0]?.name === "Outer Visible", "marker in inner subgroup resolved to outer's display name");
  assert(layers[0]?.features.length === 1, "1 feature");
}

// ----------------------------------------------------------------------------
// Test 3: 3-level nested subgroups
// ----------------------------------------------------------------------------
console.log("\n[3] 3-level nested groups");
{
  const html = `
    var lvl1 = L.featureGroup().addTo(map);
    var lvl2 = L.featureGroup.subGroup(lvl1).addTo(map);
    var lvl3 = L.featureGroup.subGroup(lvl2).addTo(map);
    var p = L.polyline([[1,2],[3,4]]).addTo(lvl3);
    var ctrl = L.control.layers({}, {"Top": lvl1});
  `;
  const layers = parseLeafletHtml(html);
  assert(layers[0]?.name === "Top", `3-level transitive resolution (got: ${layers[0]?.name})`);
  const f = layers[0]?.features[0];
  const path = (f?.properties as any)?.groupPath as string[];
  assert(Array.isArray(path) && path[0] === "lvl3" && path[path.length - 1] === "lvl1",
    `groupPath records full chain (got: ${JSON.stringify(path)})`);
}

// ----------------------------------------------------------------------------
// Test 4: standalone .addTo on a separate line (regression)
// ----------------------------------------------------------------------------
console.log("\n[4] .addTo on separate statement");
{
  const html = `
    var fg = L.featureGroup();
    var marker_a = L.marker([5, 6]);
    marker_a.addTo(fg);
    fg.addTo(map);
    var ctrl = L.control.layers({}, {"Standalone": fg});
  `;
  const layers = parseLeafletHtml(html);
  assert(layers[0]?.name === "Standalone", "standalone addTo still works");
  assert(layers[0]?.features.length === 1, "1 feature");
}

// ----------------------------------------------------------------------------
// Test 5: chained popup + addTo
// ----------------------------------------------------------------------------
console.log("\n[5] chained .bindPopup(...).addTo(...)");
{
  const html = `
    var fg = L.featureGroup().addTo(map);
    var m = L.marker([1, 2]).bindPopup("<b>Cliente X</b>").addTo(fg);
    var ctrl = L.control.layers({}, {"Capa": fg});
  `;
  const layers = parseLeafletHtml(html);
  const f = layers[0]?.features[0];
  assert(layers[0]?.name === "Capa", "layer ok");
  assert(f?.name === "Cliente X", `popup text extracted, HTML stripped (got: ${JSON.stringify(f?.name)})`);
}

// ----------------------------------------------------------------------------
// Test 6: alias chain
// ----------------------------------------------------------------------------
console.log("\n[6] alias chain (var a = b;)");
{
  const html = `
    var fg_real = L.featureGroup().addTo(map);
    var fg_alias = fg_real;
    var m = L.marker([1, 2]).addTo(fg_alias);
    var ctrl = L.control.layers({}, {"Aliased": fg_real});
  `;
  const layers = parseLeafletHtml(html);
  assert(layers[0]?.name === "Aliased", `alias resolved (got: ${layers[0]?.name})`);
}

// ----------------------------------------------------------------------------
// Test 7: feature added directly to map (NOT a real group) is skipped
// ----------------------------------------------------------------------------
console.log("\n[7] marker added to map (no group) is skipped");
{
  const html = `
    var map = L.map("x");
    var m = L.marker([1, 2]).addTo(map);
    var fg = L.featureGroup().addTo(map);
    var m2 = L.marker([3, 4]).addTo(fg);
    var ctrl = L.control.layers({}, {"Real": fg});
  `;
  const layers = parseLeafletHtml(html);
  assert(layers.length === 1, "only 1 layer (the real group)");
  assert(layers[0]?.features.length === 1, "only 1 feature (the one in fg)");
}

// ----------------------------------------------------------------------------
// Test 8: cycle protection
// ----------------------------------------------------------------------------
console.log("\n[8] cycle protection (no infinite loop)");
{
  const html = `
    var a = L.featureGroup();
    var b = L.featureGroup();
    a.addTo(b);
    b.addTo(a);
    var m = L.marker([1, 2]).addTo(a);
  `;
  // Should not infinite-loop. May produce 0 or 1 layer with var-name fallback.
  const layers = parseLeafletHtml(html);
  assert(true, "did not hang");
  // a is a group so the feature should resolve via groupVar fallback
  assert(layers.length <= 1, "at most 1 layer emitted");
}

// ----------------------------------------------------------------------------
// Test 9: ctrl.overlays = {...} alternative syntax
// ----------------------------------------------------------------------------
console.log("\n[9] ctrl.overlays = {...} syntax");
{
  const html = `
    var fg = L.featureGroup().addTo(map);
    var m = L.marker([1, 2]).addTo(fg);
    var ctrl = L.control.layers();
    ctrl.overlays = {"Via overlays": fg};
  `;
  const layers = parseLeafletHtml(html);
  assert(layers[0]?.name === "Via overlays", `.overlays = {...} works (got: ${layers[0]?.name})`);
}

// ----------------------------------------------------------------------------
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  // @ts-ignore Deno
  if (typeof Deno !== "undefined") Deno.exit(1);
  // @ts-ignore Node
  if (typeof process !== "undefined") process.exit(1);
}

// ----------------------------------------------------------------------------
// Test 10: Folium-style overlays as object property inside var literal
// ----------------------------------------------------------------------------
console.log("\n[10] overlays as : property in object literal (Folium)");
{
  const html = `
    var feature_group_abc = L.featureGroup({}).addTo(map_x);
    var marker_cluster_xyz = L.markerClusterGroup({}).addTo(feature_group_abc);
    var marker_1 = L.marker([1, 2]).addTo(marker_cluster_xyz);
    var layer_control_999 = {
      base_layers: { "Mapa": tile_layer },
      overlays: { "Talleres": feature_group_abc },
    };
    L.control.layers(layer_control_999.base_layers, layer_control_999.overlays).addTo(map_x);
  `;
  const layers = parseLeafletHtml(html);
  assert(layers[0]?.name === "Talleres", `overlays:{} property resolved (got: ${layers[0]?.name})`);
  assert(layers[0]?.features.length === 1, "1 feature via cluster -> group chain");
}
