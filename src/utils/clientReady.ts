/**
 * `client_ready` (regla 6 del proyecto «Inteligencia territorial de salud», docs/salud/BRIEF.md): una capa con
 * `client_ready === false` NO entra a informes ni exportaciones (imágenes del informe, XLSX/PDF/PPTX/CSV, KMZ).
 *
 * La bandera todavía no existe en la base: hoy ninguna capa la trae, así que `undefined`/`null` cuentan como
 * «lista» y el comportamiento actual no cambia. Cuando exista (Fase 1a) nacerá en `false` para las capas nuevas de salud
 * y estas funciones las dejarán fuera sin tocar a los llamadores.
 *
 * Esto NO es un control de seguridad: el acceso directo a las tablas con la clave anon lo cubre solo RLS.
 */
export interface MaybeClientReady {
  id: string;
  client_ready?: boolean | null;
}

export const isClientReady = (layer: Pick<MaybeClientReady, "client_ready">): boolean => layer.client_ready !== false;

export const filterClientReady = <T extends MaybeClientReady>(layers: readonly T[]): T[] => layers.filter(isClientReady);

/**
 * Ids de capas del árbol que hay que APAGAR mientras se toma una foto para un informe: las que están visibles y NO
 * son `client_ready`. Las visibles que sí lo son (o que no traen la bandera) se dejan como las tiene el analista.
 * Las ids visibles que no corresponden a una capa cargada no se pintan, así que no hay nada que apagar.
 */
export const visibleIdsToHideForCapture = (visibleIds: ReadonlySet<string>, layers: readonly MaybeClientReady[]): string[] =>
  layers.filter((l) => visibleIds.has(l.id) && !isClientReady(l)).map((l) => l.id);
