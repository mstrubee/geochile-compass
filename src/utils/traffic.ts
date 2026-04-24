export type TrafficLevel = "low" | "mid" | "high";

export const TRAFFIC_LEVELS: Record<TrafficLevel, { label: string; min: number; max: number; hsl: string }> = {
  low: { label: "Fluido", min: 0, max: 49, hsl: "hsl(142 71% 45%)" },
  mid: { label: "Moderado", min: 50, max: 72, hsl: "hsl(47 95% 53%)" },
  high: { label: "Alto", min: 73, max: 100, hsl: "hsl(0 84% 60%)" },
};

export const trafficLevelOf = (t: number): TrafficLevel => {
  if (t < 50) return "low";
  if (t <= 72) return "mid";
  return "high";
};
