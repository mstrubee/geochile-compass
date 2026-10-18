/**
 * Interruptor «Mostrar en mapa» de los POIs guardados (Sidebar → Puntos de interés).
 *
 * Arranca APAGADO en cada carga de la app. Estado solo de sesión: no se lee ni se escribe en localStorage ni en la base
 * (antes era `useState(true)` en Index: los POIs aparecían siempre al abrir la app). Lo enciende solo el usuario en la sesión
 * (el interruptor, o activar una carpeta en el administrador de POIs).
 */
import { useCallback, useState } from "react";

export const SAVED_POIS_VISIBLE_DEFAULT = false;

export const useSavedPoisVisible = () => {
  const [visible, setVisible] = useState(SAVED_POIS_VISIBLE_DEFAULT);
  const toggle = useCallback(() => setVisible((v) => !v), []);
  const enable = useCallback(() => setVisible(true), []);
  return { visible, toggle, enable };
};
