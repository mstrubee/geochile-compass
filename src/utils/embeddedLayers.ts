/**
 * Capas temáticas que NO tienen nodo propio en el árbol porque viven DENTRO del panel de otra capa.
 *
 * Hoy: `panel_casen_region` (Previsión regional, CASEN 2024, estimada) es una sección plegable del panel «Isapre: beneficiarios por comuna». Sola no pinta nada (D6: la encuesta no es
 * representativa a nivel comunal), así que un nodo propio solo ofrecía un interruptor sin efecto.
 *
 * Por qué se oculta en el FRONT y no se archiva el nodo (`layer_nodes.archived_at`): lo archivado cae en la papelera y `purge_archived_layer_nodes` (cron diario, 30 días) borra la
 * raíz, y con ella —por cascade— la fila de `thematic_layers` que conserva el `client_ready` propio de CASEN, su dataset y sus parámetros. Ocultarlo en el cliente no toca la base,
 * no depende de aplicar nada en producción y se revierte quitando el renderer de esta lista.
 */
import { fetchThematicLayers } from "@/services/permitsService";

export const EMBEDDED_RENDERERS = ["panel_casen_region"] as const;

/** `layer_id` de las capas temáticas incrustadas. Si la lectura falla (tabla ausente, permisos), no se oculta nada: el árbol sigue como estaba. */
export const fetchEmbeddedLayerIds = async (): Promise<Set<string>> => {
  try {
    const rows = await fetchThematicLayers();
    return new Set(rows.filter((r) => (EMBEDDED_RENDERERS as readonly string[]).includes(r.renderer)).map((r) => r.layer_id));
  } catch (e) {
    console.warn("[embeddedLayers] no se pudo leer thematic_layers:", e);
    return new Set();
  }
};

export const withoutEmbedded = <T extends { id: string }>(items: readonly T[], embedded: ReadonlySet<string>): T[] =>
  embedded.size === 0 ? [...items] : items.filter((i) => !embedded.has(i.id));
