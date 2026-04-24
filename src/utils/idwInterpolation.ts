import { COMMUNES, type Commune } from "@/data/communes";

const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export type CommuneField = "pop" | "nse" | "traffic" | "density" | "hh";

/**
 * Inverse Distance Weighted interpolation using the K nearest communes.
 * Returns weighted mean of `field` and the nearest commune.
 */
export const idwValue = (
  lat: number,
  lng: number,
  field: CommuneField,
  power = 2,
  k = 5
): { value: number; nearest: Commune } => {
  const distances = COMMUNES.map((c) => ({
    c,
    d: haversine(lat, lng, c.lat, c.lng),
  })).sort((a, b) => a.d - b.d);

  const top = distances.slice(0, k);
  const nearest = top[0].c;

  // Exact hit guard
  if (top[0].d < 1e-6) {
    return { value: top[0].c[field] as number, nearest };
  }

  let num = 0;
  let den = 0;
  for (const { c, d } of top) {
    const w = 1 / Math.pow(d, power);
    num += (c[field] as number) * w;
    den += w;
  }
  return { value: num / den, nearest };
};
