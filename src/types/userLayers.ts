import type { FeatureCollection } from "geojson";

export interface UserLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  data: FeatureCollection;
}

export const USER_LAYER_COLORS = [
  "#34D399", // green
  "#F472B6", // pink
  "#FBBF24", // amber
  "#60A5FA", // blue
  "#A78BFA", // purple
  "#FB7185", // rose
  "#22D3EE", // cyan
  "#FB923C", // orange
];
