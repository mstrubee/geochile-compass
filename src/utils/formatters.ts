export const fmtNum = (n: number): string =>
  new Intl.NumberFormat("es-CL").format(Math.round(n));

export const fmtCLP = (n: number): string =>
  "$" + new Intl.NumberFormat("es-CL").format(Math.round(n));

export const fmtArea = (km2: number): string =>
  `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(km2)} km²`;

export const fmtDensity = (d: number): string =>
  `${new Intl.NumberFormat("es-CL").format(Math.round(d))} hab/km²`;
