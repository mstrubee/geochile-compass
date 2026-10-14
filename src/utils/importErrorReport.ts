/**
 * Informe de un fallo del importador: en vez de un mensaje técnico suelto, explica QUÉ paso falló,
 * la causa probable y cómo corregirlo, y arma un texto listo para copiar y pegar en el chat
 * ("Claude, esto falló: …") con el contexto necesario para diagnosticarlo sin preguntar de vuelta.
 */

export type ImportStage = "read" | "upload" | "preview" | "commit" | "undo";

export interface ImportErrorContext {
  stage: ImportStage;
  filename: string;
  format?: string | null;
  mode?: "new" | "replace" | "append" | null;
  targetName?: string | null;
  counts?: { folders: number; layers: number; features: number; invalid: number } | null;
  included?: { layers: number; features: number } | null;
  maxRows?: number | null;
  rowsToWrite?: number | null;
  batchId?: string | null;
}

export interface ImportErrorReport {
  stage: ImportStage;
  /** Qué falló, en una línea ("No se pudo confirmar la importación"). */
  title: string;
  cause: string;
  solution: string;
  /** Código de Postgres/PostgREST, si lo hay. */
  code: string | null;
  /** Mensaje original, sin tocar. */
  raw: string;
  /** Texto para pegar en el chat. */
  text: string;
}

const STAGE_TITLE: Record<ImportStage, string> = {
  read: "No se pudo leer el archivo",
  upload: "No se pudieron subir los puntos",
  preview: "No se pudieron calcular las diferencias",
  commit: "No se pudo confirmar la importación",
  undo: "No se pudo deshacer la importación",
};

const STAGE_LABEL: Record<ImportStage, string> = {
  read: "Leer el archivo",
  upload: "Subir los puntos",
  preview: "Calcular las diferencias",
  commit: "Confirmar la importación",
  undo: "Deshacer la importación",
};

const MODE_LABEL = { new: "crear capas y carpetas nuevas", replace: "reemplazar una capa existente", append: "agregar a una capa existente" } as const;

const n = (v: number) => v.toLocaleString("es-CL");

interface Rule {
  test: (raw: string, code: string | null) => boolean;
  cause: (ctx: ImportErrorContext, raw: string) => string;
  solution: (ctx: ImportErrorContext, raw: string) => string;
}

const numbers = (raw: string): number[] => (raw.match(/\d[\d.]*/g) ?? []).map((x) => Number(x.replace(/\./g, "")));

/** En orden: la primera que coincide gana. Lo más específico va primero. */
const RULES: Rule[] = [
  {
    test: (raw, code) => /Could not find the function|PGRST202|PGRST205|42883|42P01|does not exist|schema cache/i.test(raw) || code === "PGRST202" || code === "42883" || code === "42P01",
    cause: () => "La base de datos no tiene instalada la parte del importador (falta aplicar la migración 20261014190000_layer_import.sql).",
    solution: () => "Pega este mensaje en el chat y pídeme que aplique la migración del importador.",
  },
  {
    test: (raw, code) => code === "57014" || /statement timeout|canceling statement/i.test(raw),
    cause: () => "La base cortó la operación por tardar más de 8 segundos.",
    solution: () =>
      "Reduce lo que importas (desmarca partes del archivo, a la izquierda) y vuelve a intentarlo. Si necesitas importar capas nuevas más grandes, dímelo y subimos el límite de tiempo de la base.",
  },
  {
    test: (raw) => /máximo por confirmación/i.test(raw),
    cause: (ctx, raw) => {
      const [rows, max] = numbers(raw);
      return `Esta importación escribe ${n(rows ?? ctx.rowsToWrite ?? 0)} puntos y el máximo que la base admite de una vez es ${n(max ?? ctx.maxRows ?? 0)} (cada operación se corta a los 8 segundos).`;
    },
    solution: () =>
      "Desmarca partes del archivo (casillas de la izquierda) o impórtalo en varias partes. Al actualizar una capa solo cuenta lo que cambia. Si necesitas capas nuevas más grandes, dímelo y subimos el límite.",
  },
  {
    test: (raw, code) => code === "42501" || /solo administradores|sin permiso|permission denied|insufficient_privilege|row-level security|ese lote es de otro/i.test(raw),
    cause: () => "Tu usuario no tiene permiso de administrador para importar, o ese lote pertenece a otra persona.",
    solution: () => "Cierra sesión y vuelve a entrar. Si sigue igual, pide que te asignen el rol de administrador.",
  },
  {
    test: (raw) => /JWT expired|invalid JWT|jwt/i.test(raw),
    cause: () => "Tu sesión venció.",
    solution: () => "Vuelve a iniciar sesión y repite la importación (lo que se había subido se descarta solo).",
  },
  {
    // Solo por el mensaje: un TypeError cualquiera suele ser un error de programación, no la red.
    test: (raw) => /Failed to fetch|NetworkError|Load failed|network request failed|ERR_INTERNET|ERR_NETWORK/i.test(raw),
    cause: () => "No hubo conexión con el servidor: se cortó la red o el servidor no respondió.",
    solution: () => "Revisa tu conexión y vuelve a intentarlo. Lo que alcanzó a subirse se descarta solo.",
  },
  {
    test: (raw) => /llegaron \d+ de \d+ puntos/i.test(raw),
    cause: (_c, raw) => {
      const [got, total] = numbers(raw);
      return `La subida se cortó antes de terminar: llegaron ${n(got ?? 0)} de ${n(total ?? 0)} puntos.`;
    },
    solution: () => "Vuelve a intentarlo. Si pasa de nuevo con este archivo, pega este mensaje en el chat.",
  },
  {
    test: (raw) => /el destino debe ser|la carpeta destino|no existe|está en la papelera/i.test(raw),
    cause: () => "La carpeta o capa de destino ya no existe, está en la papelera o no es del tipo que se necesita.",
    solution: () => "Elige otro destino en la lista (o cierra y vuelve a abrir el asistente para refrescarla).",
  },
  {
    test: (raw) => /ya se confirmó|ya se revirtió|solo se puede revertir un lote confirmado/i.test(raw),
    cause: () => "Este lote ya se importó (o ya se deshizo) antes; por ejemplo, se hizo clic dos veces.",
    solution: () => "Revisa el árbol de capas: no se duplicó nada. Si falta algo, vuelve a importar el archivo.",
  },
  {
    test: (raw) => /importación posterior/i.test(raw),
    cause: () => "Esa capa se importó otra vez después, y solo se puede deshacer la importación más reciente.",
    solution: () => "Deshaz primero la importación más reciente de esa capa.",
  },
  {
    test: (raw) => /no quedó ninguna capa incluida|nada incluido/i.test(raw),
    cause: () => "No quedó nada incluido para importar.",
    solution: () => "Marca al menos una capa del archivo (casillas de la izquierda).",
  },
  {
    test: (raw, code) => code === "23505" || /duplicate key|unique constraint|ya existe/i.test(raw),
    cause: () => "Dos capas o puntos chocan por tener el mismo nombre dentro del mismo grupo, o el mismo id dentro de una capa.",
    solution: () => "Renombra la capa en conflicto o quita el id repetido del archivo, y vuelve a intentarlo.",
  },
  // ── Leer el archivo ──────────────────────────────────────────────────────
  {
    test: (raw) => /KML inválido|XML bien formado/i.test(raw),
    cause: () => "El archivo no es un XML bien formado: quizá está cortado o se editó a mano.",
    solution: () => "Ábrelo en Google Earth y vuelve a guardarlo como KMZ. Si es un KML, comprueba que termine con </kml>.",
  },
  {
    test: (raw) => /no contiene ningún archivo \.kml/i.test(raw),
    cause: () => "El KMZ no trae el archivo doc.kml adentro.",
    solution: () => "Vuelve a exportarlo desde Google Earth (Guardar lugar como… → KMZ).",
  },
  {
    test: (raw) => /Formato no soportado/i.test(raw),
    cause: () => "La extensión del archivo no es una de las admitidas.",
    solution: () => "Usa un archivo KMZ, KML, GeoJSON o CSV.",
  },
  {
    test: (raw) => /el máximo es \d+ MB/i.test(raw),
    cause: (_c, raw) => `El archivo supera el tamaño máximo (${raw.match(/el máximo es (\d+) MB/)?.[1] ?? "20"} MB).`,
    solution: () => "Divídelo en varios archivos o quita lo que no necesites antes de importar.",
  },
  {
    test: (raw) => /No se encontraron las columnas de coordenadas/i.test(raw),
    cause: () => "El CSV no tiene columnas de latitud y longitud con un nombre que reconozcamos.",
    solution: () => "Renombra las columnas a lat y lng (también sirven latitud/longitud, lon, x/y) y vuelve a intentarlo.",
  },
  {
    test: (raw) => /Ninguna fila del CSV|CSV está vacío/i.test(raw),
    cause: () => "El CSV no tiene ninguna fila con coordenadas válidas.",
    solution: () => "Revisa que latitud y longitud sean números (punto o coma decimal) y estén dentro de rango (lat −90 a 90, lng −180 a 180).",
  },
  {
    test: (raw) => /GeoJSON inválido|debe ser Feature/i.test(raw),
    cause: () => "El archivo no es un GeoJSON válido.",
    solution: () => "Valídalo en geojson.io o expórtalo de nuevo desde su origen.",
  },
  {
    test: (raw) => /ningún punto, línea o polígono|ningún elemento importable/i.test(raw),
    cause: () => "El archivo no trae geometrías que se puedan importar.",
    solution: () => "Comprueba que tenga Placemarks con punto, línea o polígono (los overlays y enlaces de red no se importan).",
  },
];

/** Mensaje y código de lo que sea que se haya lanzado (Error, error de Supabase, texto, etc.). */
export const describeError = (e: unknown): { raw: string; code: string | null } => {
  if (e instanceof Error) return { raw: e.message || e.name, code: (e as { code?: string }).code ?? null };
  if (typeof e === "string") return { raw: e, code: null };
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [o.message, o.details, o.hint].filter((x): x is string => typeof x === "string" && !!x);
    return { raw: parts.join(" · ") || JSON.stringify(e), code: typeof o.code === "string" ? o.code : null };
  }
  return { raw: String(e), code: null };
};

const contextLines = (ctx: ImportErrorContext): string[] => {
  const lines: string[] = [];
  const file = [ctx.filename, ctx.format ? `(${ctx.format.toUpperCase()})` : null].filter(Boolean).join(" ");
  const c = ctx.counts;
  lines.push(`Archivo: ${file}${c ? ` · ${n(c.folders)} carpetas, ${n(c.layers)} capas, ${n(c.features)} puntos${c.invalid ? ` (${n(c.invalid)} inválidos)` : ""}` : ""}`);
  if (ctx.mode) {
    const inc = ctx.included ? ` · ${n(ctx.included.features)} puntos incluidos` : "";
    lines.push(`Lo que intentaba: ${MODE_LABEL[ctx.mode]}${ctx.targetName ? ` · destino: «${ctx.targetName}»` : ""}${inc}`);
  }
  const tech = [
    ctx.batchId ? `lote ${ctx.batchId}` : null,
    ctx.maxRows != null ? `límite de la base: ${n(ctx.maxRows)} puntos` : null,
    ctx.rowsToWrite ? `puntos a escribir: ${n(ctx.rowsToWrite)}` : null,
  ].filter(Boolean);
  if (tech.length) lines.push(`Detalles técnicos: ${tech.join(" · ")}`);
  return lines;
};

/** Texto completo, listo para pegar en el chat. */
export const reportText = (r: Omit<ImportErrorReport, "text">, ctx: ImportErrorContext): string =>
  [
    "[Importador de capas] Falló un paso y necesito ayuda para corregirlo.",
    "",
    `Paso que falló: ${STAGE_LABEL[ctx.stage]}`,
    ...contextLines(ctx),
    `Mensaje de error: ${r.raw}${r.code ? ` (código ${r.code})` : ""}`,
    `Causa probable: ${r.cause}`,
    `Cómo corregirlo: ${r.solution}`,
    "",
    "Claude: revisa qué pasó y corrígelo, o dime qué debo hacer yo.",
  ].join("\n");

export const buildErrorReport = (error: unknown, ctx: ImportErrorContext): ImportErrorReport => {
  const { raw, code } = describeError(error);
  const rule = RULES.find((r) => r.test(raw, code));
  const base = {
    stage: ctx.stage,
    title: STAGE_TITLE[ctx.stage],
    cause: rule ? rule.cause(ctx, raw) : `Ocurrió un error que no tengo catalogado: «${raw}».`,
    solution: rule ? rule.solution(ctx, raw) : "Copia este mensaje y pégalo en el chat: con esos datos lo reviso y lo corrijo.",
    code,
    raw,
  };
  return { ...base, text: reportText(base, ctx) };
};

/** Informe de los avisos del archivo (lo que NO se importará y por qué), para pegarlo en el chat. */
export const issuesText = (
  filename: string,
  issues: readonly { kind: string; path: string[]; name: string | null; reason: string }[],
  limit = 100,
): string => {
  const kinds: Record<string, string> = {
    "invalid-geometry": "Geometría inválida (no se importa)",
    "no-geometry": "Sin geometría (no se importa)",
    unsupported: "No soportado (se ignora)",
    warning: "Aviso",
  };
  const lines = issues.slice(0, limit).map((i) => `- ${kinds[i.kind] ?? i.kind}: ${i.name ? `«${i.name}» — ` : ""}${i.reason}${i.path.length ? ` [${i.path.join(" › ")}]` : ""}`);
  return [
    `[Importador de capas] Avisos al leer «${filename}» (${issues.length}):`,
    ...lines,
    ...(issues.length > limit ? [`… y ${issues.length - limit} más`] : []),
    "",
    "Claude: ¿puedes ayudarme a entender o corregir estos avisos?",
  ].join("\n");
};
