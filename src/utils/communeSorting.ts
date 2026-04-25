import type { Commune } from "@/data/communes";

export type CommunePreset =
  | "north-south"
  | "south-north"
  | "alpha-asc"
  | "alpha-desc"
  | "gse-high"
  | "gse-low";

export type CommuneSortKey =
  | "name"
  | "pop"
  | "hh"
  | "nse"
  | "density"
  | "area"
  | "traffic"
  | "lat"
  | "lng";

export type SortDir = "asc" | "desc";

export const PRESET_LABELS: Record<CommunePreset, string> = {
  "north-south": "Norte → Sur",
  "south-north": "Sur → Norte",
  "alpha-asc": "Alfabético A–Z",
  "alpha-desc": "Alfabético Z–A",
  "gse-high": "GSE: ABC1 → E",
  "gse-low": "GSE: E → ABC1",
};

export const sortCommunesByPreset = (
  rows: Commune[],
  preset: CommunePreset,
): Commune[] => {
  const arr = [...rows];
  switch (preset) {
    case "north-south":
      return arr.sort((a, b) => b.lat - a.lat);
    case "south-north":
      return arr.sort((a, b) => a.lat - b.lat);
    case "alpha-asc":
      return arr.sort((a, b) => a.name.localeCompare(b.name, "es"));
    case "alpha-desc":
      return arr.sort((a, b) => b.name.localeCompare(a.name, "es"));
    case "gse-high":
      return arr.sort((a, b) => b.nse - a.nse);
    case "gse-low":
      return arr.sort((a, b) => a.nse - b.nse);
  }
};

export const sortCommunesByKey = (
  rows: Commune[],
  key: CommuneSortKey,
  dir: SortDir,
): Commune[] => {
  const arr = [...rows];
  arr.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") {
      return dir === "asc"
        ? av.localeCompare(bv, "es")
        : bv.localeCompare(av, "es");
    }
    return dir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });
  return arr;
};
