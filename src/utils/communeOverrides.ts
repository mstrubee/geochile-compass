// Overrides locales (persistentes) para coordenadas de comunas reposicionadas por el usuario.
const KEY = "commune_coord_overrides_v1";

export type CoordOverride = { lat: number; lng: number };
export type CoordOverrides = Record<string, CoordOverride>;

export const loadCommuneOverrides = (): CoordOverrides => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CoordOverrides;
  } catch {
    return {};
  }
};

export const saveCommuneOverride = (name: string, lat: number, lng: number): void => {
  const all = loadCommuneOverrides();
  all[name] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ignore quota
  }
};

export const clearCommuneOverride = (name: string): void => {
  const all = loadCommuneOverrides();
  delete all[name];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
};

export const exportOverridesAsJson = (): string => {
  return JSON.stringify(loadCommuneOverrides(), null, 2);
};
