import { describe, expect, it } from "vitest";
import { buildErrorReport, describeError, issuesText, type ImportErrorContext } from "@/utils/importErrorReport";

const ctx = (over: Partial<ImportErrorContext> = {}): ImportErrorContext => ({
  stage: "commit",
  filename: "locales.kml",
  format: "kml",
  mode: "new",
  targetName: "Retail",
  counts: { folders: 3, layers: 6, features: 10, invalid: 3 },
  included: { layers: 6, features: 10 },
  maxRows: 5600,
  rowsToWrite: 10,
  batchId: "b-123",
  ...over,
});

describe("describeError", () => {
  it("entiende Error, texto y errores de Supabase (mensaje, detalle y pista)", () => {
    expect(describeError(new Error("boom"))).toEqual({ raw: "boom", code: null });
    expect(describeError("texto")).toEqual({ raw: "texto", code: null });
    expect(describeError({ message: "falló", details: "detalle", hint: "pista", code: "23505" })).toEqual({ raw: "falló · detalle · pista", code: "23505" });
    expect(describeError({ foo: 1 }).raw).toBe('{"foo":1}');
    expect(describeError(null).raw).toBe("null");
  });
});

describe("buildErrorReport — causas conocidas (cada una explica causa y solución)", () => {
  const cases: [string, unknown, Partial<ImportErrorContext>, RegExp, RegExp][] = [
    ["falta la migración (PGRST202)", { message: "Could not find the function public.commit_layer_import in the schema cache", code: "PGRST202" }, {}, /no tiene instalada la parte del importador/, /aplique la migración/],
    ["tabla inexistente", { message: 'relation "public.territorial_import_batches" does not exist', code: "42P01" }, { stage: "upload" }, /no tiene instalada/, /migración/],
    ["timeout de la base", { message: "canceling statement due to statement timeout", code: "57014" }, {}, /más de 8 segundos/, /Reduce lo que importas/],
    ["tope de puntos", { message: "importador: son 25.045 puntos y el máximo por confirmación es 5.600 (el rol authenticated corta a los 8s).", code: "23514" }, {}, /25\.045 puntos y el máximo que la base admite de una vez es 5\.600/, /Desmarca partes del archivo/],
    ["sin permiso (42501)", { message: "importador: solo administradores", code: "42501" }, {}, /permiso de administrador/, /Cierra sesión/],
    ["RLS", { message: 'new row violates row-level security policy for table "territorial_import_staging"', code: "42501" }, { stage: "upload" }, /permiso de administrador/, /rol de administrador/],
    ["sesión vencida", { message: "JWT expired" }, {}, /sesión venció/, /iniciar sesión/],
    ["sin red", new TypeError("Failed to fetch"), { stage: "upload" }, /No hubo conexión/, /Revisa tu conexión/],
    ["subida incompleta", { message: "importador: llegaron 300 de 1000 puntos; vuelve a subir el archivo", code: "23514" }, { stage: "upload" }, /llegaron 300 de 1\.000 puntos/, /Vuelve a intentarlo/],
    ["destino inválido", { message: "importador: el destino debe ser una capa existente", code: "23514" }, {}, /ya no existe|papelera/, /Elige otro destino/],
    ["lote ya confirmado", { message: "importador: este lote ya se confirmó o se revirtió" }, {}, /ya se importó/, /no se duplicó nada/],
    ["importación posterior", { message: "importador: esa capa tiene una importación posterior; revierte primero la más reciente" }, { stage: "undo" }, /solo se puede deshacer la importación más reciente/, /Deshaz primero/],
    ["nada incluido", { message: "importador: no quedó ninguna capa incluida" }, {}, /No quedó nada incluido/, /Marca al menos una capa/],
    ["nombre duplicado", { message: 'duplicate key value violates unique constraint "territorial_layers_group_id_name_key"', code: "23505" }, {}, /mismo nombre dentro del mismo grupo/, /Renombra/],
    ["KML mal formado", new Error("KML inválido (no es un XML bien formado)"), { stage: "read" }, /no es un XML bien formado/, /guárdalo como KMZ|guardarlo como KMZ/],
    ["KMZ sin kml", new Error("El KMZ no contiene ningún archivo .kml"), { stage: "read" }, /no trae el archivo doc\.kml/, /Guardar lugar como/],
    ["formato desconocido", new Error("Formato no soportado. Usa KMZ, KML, GeoJSON o CSV."), { stage: "read" }, /extensión/, /KMZ, KML, GeoJSON o CSV/],
    ["archivo muy grande", new Error("El archivo pesa 31.0 MB y el máximo es 20 MB"), { stage: "read" }, /tamaño máximo \(20 MB\)/, /Divídelo/],
    ["CSV sin columnas", new Error("No se encontraron las columnas de coordenadas. Se esperaba una de lat…"), { stage: "read" }, /columnas de latitud y longitud/, /Renombra las columnas/],
    ["CSV sin filas válidas", new Error("Ninguna fila del CSV tiene coordenadas válidas"), { stage: "read" }, /ninguna fila con coordenadas válidas/, /dentro de rango/],
    ["GeoJSON roto", new Error("GeoJSON inválido (no es JSON)"), { stage: "read" }, /no es un GeoJSON válido/, /geojson\.io/],
    ["sin geometrías", new Error("El archivo no contiene ningún punto, línea o polígono importable"), { stage: "read" }, /no trae geometrías/, /overlays/],
  ];

  it.each(cases)("%s", (_name, error, over, cause, solution) => {
    const r = buildErrorReport(error, ctx(over));
    expect(r.cause).toMatch(cause);
    expect(r.solution).toMatch(solution);
    expect(r.title).toMatch(/^No se pud(o|ieron)/);
    expect(r.raw.length).toBeGreaterThan(0);
  });

  it("un TypeError de programación NO se hace pasar por un problema de red", () => {
    const r = buildErrorReport(new TypeError("Cannot read properties of undefined (reading 'x')"), ctx());
    expect(r.cause).toMatch(/no tengo catalogado/);
    expect(r.cause).toContain("Cannot read properties of undefined");
  });

  it("lo desconocido no se esconde: incluye el mensaje original y pide copiarlo", () => {
    const r = buildErrorReport({ message: "algo rarísimo", code: "XX000" }, ctx());
    expect(r.cause).toBe("Ocurrió un error que no tengo catalogado: «algo rarísimo».");
    expect(r.solution).toMatch(/Copia este mensaje y pégalo en el chat/);
    expect(r.code).toBe("XX000");
  });

  it("el título depende del paso", () => {
    expect(buildErrorReport("x", ctx({ stage: "read" })).title).toBe("No se pudo leer el archivo");
    expect(buildErrorReport("x", ctx({ stage: "upload" })).title).toBe("No se pudieron subir los puntos");
    expect(buildErrorReport("x", ctx({ stage: "preview" })).title).toBe("No se pudieron calcular las diferencias");
    expect(buildErrorReport("x", ctx({ stage: "undo" })).title).toBe("No se pudo deshacer la importación");
  });
});

describe("el texto para pegar en el chat", () => {
  const r = buildErrorReport({ message: "importador: solo administradores", code: "42501" }, ctx());

  it("trae el paso, el archivo, lo que intentaba, el error, la causa y la solución", () => {
    expect(r.text).toContain("[Importador de capas] Falló un paso y necesito ayuda para corregirlo.");
    expect(r.text).toContain("Paso que falló: Confirmar la importación");
    expect(r.text).toContain("Archivo: locales.kml (KML) · 3 carpetas, 6 capas, 10 puntos (3 inválidos)");
    expect(r.text).toContain("Lo que intentaba: crear capas y carpetas nuevas · destino: «Retail» · 10 puntos incluidos");
    expect(r.text).toContain("Mensaje de error: importador: solo administradores (código 42501)");
    expect(r.text).toContain("Causa probable: Tu usuario no tiene permiso de administrador");
    expect(r.text).toContain("Cómo corregirlo: Cierra sesión");
    expect(r.text).toContain("Detalles técnicos: lote b-123 · límite de la base: 5.600 puntos · puntos a escribir: 10");
    expect(r.text.trim().endsWith("Claude: revisa qué pasó y corrígelo, o dime qué debo hacer yo.")).toBe(true);
  });

  it("omite lo que no se sabe (por ejemplo, en la lectura del archivo no hay lote ni modo)", () => {
    const t = buildErrorReport(new Error("KML inválido (no es un XML bien formado)"), { stage: "read", filename: "roto.kml", format: "kml" }).text;
    expect(t).toContain("Paso que falló: Leer el archivo");
    expect(t).toContain("Archivo: roto.kml (KML)");
    expect(t).not.toContain("Lo que intentaba");
    expect(t).not.toContain("Detalles técnicos");
  });

  it("describe el modo y el destino al actualizar", () => {
    const t = buildErrorReport("x", ctx({ stage: "preview", mode: "replace", targetName: "Cruz Verde" })).text;
    expect(t).toContain("Lo que intentaba: reemplazar una capa existente · destino: «Cruz Verde»");
  });
});

describe("issuesText", () => {
  const issues = [
    { kind: "invalid-geometry", path: ["Red", "Con problemas"], name: "Latitud mala", reason: "latitud fuera de rango (95)" },
    { kind: "unsupported", path: [], name: null, reason: "1 elemento(s) NetworkLink no se importan" },
  ];

  it("arma un reporte con cada aviso, su motivo y dónde está", () => {
    const t = issuesText("locales.kml", issues);
    expect(t).toContain("Avisos al leer «locales.kml» (2):");
    expect(t).toContain("- Geometría inválida (no se importa): «Latitud mala» — latitud fuera de rango (95) [Red › Con problemas]");
    expect(t).toContain("- No soportado (se ignora): 1 elemento(s) NetworkLink no se importan");
  });

  it("recorta las listas largas y lo dice", () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ kind: "warning", path: [], name: `p${i}`, reason: "x" }));
    const t = issuesText("a.kml", many);
    expect(t).toContain("… y 30 más");
    expect(t.split("\n").filter((l) => l.startsWith("- ")).length).toBe(100);
  });
});
