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

export interface IsoMinutesOptions {
  rmMinutes?: number;
  regionsMinutes?: number;
  /** Población de la comuna, para evaluar el umbral de comuna pequeña. */
  communePop?: number | null;
  /** Comunas con población <= a este valor usan `smallCommuneMinutes`. 0 = off. */
  smallCommunePopThreshold?: number;
  smallCommuneMinutes?: number;
}

/**
 * Tiempo de isócrona en minutos según comuna.
 * Defaults: 5 (RM) / 7 (regiones). Ambos en modo "auto".
 *
 * Permite override desde analysis_settings.iso_minutes_rm/regions, y una regla
 * adicional por tamaño de comuna: bajo cierto umbral de población conviene una
 * isócrona mayor, porque una corta captura muy poca gente y subestima el área
 * de influencia del local.
 */
export const isoMinutesForCommune = (
  comuna: string | null | undefined,
  rmMinutesOrOpts: number | IsoMinutesOptions = 5,
  regionsMinutesArg: number = 7,
): { minutes: number; isRm: boolean; usedSmallCommuneRule: boolean } => {
  const opts: IsoMinutesOptions =
    typeof rmMinutesOrOpts === "number"
      ? { rmMinutes: rmMinutesOrOpts, regionsMinutes: regionsMinutesArg }
      : rmMinutesOrOpts;

  const {
    rmMinutes = 5,
    regionsMinutes = 7,
    communePop = null,
    smallCommunePopThreshold = 0,
    smallCommuneMinutes = 10,
  } = opts;

  const isRm = isRmCommune(comuna);

  // La regla por tamaño manda sobre RM/regiones: aplica a cualquier comuna
  // bajo el umbral, esté o no en la RM.
  const isSmall =
    smallCommunePopThreshold > 0 &&
    communePop != null &&
    communePop > 0 &&
    communePop <= smallCommunePopThreshold;

  return {
    minutes: isSmall ? smallCommuneMinutes : isRm ? rmMinutes : regionsMinutes,
    isRm,
    usedSmallCommuneRule: isSmall,
  };
};
