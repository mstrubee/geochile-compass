import type { SyntheticEvent } from "react";

/**
 * Arrastrar un archivo del escritorio sobre el árbol: lo atiende la fila (carpeta o capa) o, si no hay
 * fila bajo el cursor, el panel. NO se usa `stopPropagation()`: react-dnd escucha esos eventos en `window`
 * y, si no los ve, se queda "arrastrando" y rechaza los arrastres internos que vienen después.
 * En su lugar la fila marca el evento como atendido y el panel lo salta.
 */
const handled = new WeakSet<Event>();

export const hasFiles = (e: { dataTransfer?: DataTransfer | null }): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files");

export const markFileDropHandled = (e: SyntheticEvent): void => {
  handled.add(e.nativeEvent);
};

export const isFileDropHandled = (e: SyntheticEvent): boolean => handled.has(e.nativeEvent);
