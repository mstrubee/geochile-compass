/**
 * `client_ready` (regla 6 del proyecto «Inteligencia territorial de salud», docs/salud/BRIEF.md): una capa con
 * `client_ready === false` NO entra a informes ni exportaciones (imágenes del informe, XLSX/PDF/PPTX/CSV, KMZ).
 *
 * La bandera vive en `thematic_layers` (migración 20261102000100): `undefined`/`null` cuentan como «lista» y el comportamiento
 * previo no cambia. Las capas nuevas de salud nacen en `false`; `withThematicClientReady` la une a las capas del árbol.
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

/**
 * Une la bandera de `thematic_layers` (renderer propio de cada capa temática) a las capas del árbol, que son las que consultan las capturas de mapa.
 * Solo se pisa `client_ready` cuando la tabla temática lo define (no nulo): una capa sin evaluar conserva lo que ya traía.
 */
export const withThematicClientReady = <T extends MaybeClientReady>(
  layers: readonly T[], thematic: ReadonlyArray<{ layer_id: string; client_ready?: boolean | null }> | undefined,
): T[] => {
  const flag = new Map((thematic ?? []).filter((t) => t.client_ready != null).map((t) => [t.layer_id, t.client_ready as boolean]));
  if (flag.size === 0) return [...layers];
  return layers.map((l) => (flag.has(l.id) ? { ...l, client_ready: flag.get(l.id) } : l));
};
