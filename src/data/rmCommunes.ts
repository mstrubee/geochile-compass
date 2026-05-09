/**
 * Comunas que pertenecen a la Región Metropolitana de Santiago.
 * Lista oficial INE: 52 comunas en 6 provincias (Santiago, Cordillera,
 * Maipo, Melipilla, Chacabuco, Talagante).
 *
 * Uso: determinar el tiempo de isócrona del análisis territorial.
 *  · RM:        5 minutos en auto
 *  · Regiones:  7 minutos en auto
 */

export const RM_COMMUNES: ReadonlyArray<string> = [
  // Provincia Santiago (32)
  "Santiago",
  "Cerrillos",
  "Cerro Navia",
  "Conchalí",
  "El Bosque",
  "Estación Central",
  "Huechuraba",
  "Independencia",
  "La Cisterna",
  "La Florida",
  "La Granja",
  "La Pintana",
  "La Reina",
  "Las Condes",
  "Lo Barnechea",
  "Lo Espejo",
  "Lo Prado",
  "Macul",
  "Maipú",
  "Ñuñoa",
  "Pedro Aguirre Cerda",
  "Peñalolén",
  "Providencia",
  "Pudahuel",
  "Quilicura",
  "Quinta Normal",
  "Recoleta",
  "Renca",
  "San Joaquín",
  "San Miguel",
  "San Ramón",
  "Vitacura",
  // Provincia Cordillera (3)
  "Puente Alto",
  "Pirque",
  "San José de Maipo",
  // Provincia Maipo (4)
  "San Bernardo",
  "Buin",
  "Calera de Tango",
  "Paine",
  // Provincia Melipilla (5)
  "Melipilla",
  "Alhué",
  "Curacaví",
  "María Pinto",
  "San Pedro",
  // Provincia Chacabuco (3)
  "Colina",
  "Lampa",
  "Tiltil",
  // Provincia Talagante (5)
  "Talagante",
  "El Monte",
  "Isla de Maipo",
  "Padre Hurtado",
  "Peñaflor",
];

/**
 * Versión normalizada (minúsculas, sin tildes) para matching robusto.
 */
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const RM_NORMALIZED: ReadonlySet<string> = new Set(
  RM_COMMUNES.map(normalize),
);

/**
 * Devuelve true si la comuna entregada (cualquier capitalización/tildes)
 * pertenece a la Región Metropolitana.
 */
export const isRmCommune = (comuna: string | null | undefined): boolean => {
  if (!comuna) return false;
  return RM_NORMALIZED.has(normalize(comuna));
};

/**
 * Tiempo de isócrona en minutos según comuna.
 * Defaults: 5 (RM) / 7 (regiones). Ambos en modo "auto".
 *
 * Permite override desde analysis_settings.iso_minutes_rm/regions.
 */
export const isoMinutesForCommune = (
  comuna: string | null | undefined,
  rmMinutes: number = 5,
  regionsMinutes: number = 7,
): { minutes: number; isRm: boolean } => {
  const isRm = isRmCommune(comuna);
  return {
    minutes: isRm ? rmMinutes : regionsMinutes,
    isRm,
  };
};
