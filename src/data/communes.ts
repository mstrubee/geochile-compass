export type NSE = 1 | 2 | 3 | 4 | 5;

export interface Commune {
  name: string;
  lat: number;
  lng: number;
  pop: number;       // Población
  nse: NSE;          // 1=E, 2=D, 3=C3, 4=C2, 5=ABC1
  traffic: number;   // 0-100
  density: number;   // hab/km²
  area: number;      // km²
  hh: number;        // hogares
}

// 20 comunas RM con datos aproximados (INE 2017 / proyecciones)
export const COMMUNES: Commune[] = [
  { name: "Santiago",      lat: -33.4489, lng: -70.6693, pop: 503147, nse: 3, traffic: 92, density: 17094, area: 22.4,  hh: 215000 },
  { name: "Providencia",   lat: -33.4314, lng: -70.6093, pop: 158837, nse: 5, traffic: 85, density: 11900, area: 14.4,  hh: 78000  },
  { name: "Las Condes",    lat: -33.4172, lng: -70.5476, pop: 330759, nse: 5, traffic: 88, density: 3950,  area: 99.4,  hh: 130000 },
  { name: "Ñuñoa",         lat: -33.4569, lng: -70.5961, pop: 249907, nse: 4, traffic: 78, density: 14600, area: 16.9,  hh: 105000 },
  { name: "Maipú",         lat: -33.5110, lng: -70.7580, pop: 578605, nse: 3, traffic: 72, density: 4640,  area: 133.0, hh: 170000 },
  { name: "La Florida",    lat: -33.5520, lng: -70.5985, pop: 402433, nse: 3, traffic: 76, density: 5430,  area: 70.8,  hh: 132000 },
  { name: "Puente Alto",   lat: -33.6107, lng: -70.5754, pop: 645909, nse: 2, traffic: 70, density: 6440,  area: 88.0,  hh: 188000 },
  { name: "Quilicura",     lat: -33.3593, lng: -70.7281, pop: 254694, nse: 2, traffic: 68, density: 4500,  area: 56.6,  hh: 76000  },
  { name: "San Bernardo",  lat: -33.5928, lng: -70.7060, pop: 334716, nse: 2, traffic: 65, density: 1670,  area: 200.5, hh: 100000 },
  { name: "Vitacura",      lat: -33.3989, lng: -70.5836, pop: 96774,  nse: 5, traffic: 62, density: 3380,  area: 28.3,  hh: 35000  },
  { name: "Lo Barnechea",  lat: -33.3517, lng: -70.5168, pop: 124076, nse: 5, traffic: 55, density: 122,   area: 1023.7, hh: 38000  },
  { name: "Peñalolén",     lat: -33.4862, lng: -70.5333, pop: 266798, nse: 3, traffic: 74, density: 4050,  area: 65.9,  hh: 86000  },
  { name: "La Reina",      lat: -33.4467, lng: -70.5403, pop: 99099,  nse: 4, traffic: 58, density: 4620,  area: 21.4,  hh: 38000  },
  { name: "Macul",         lat: -33.4920, lng: -70.5972, pop: 137748, nse: 3, traffic: 73, density: 11380, area: 12.1,  hh: 50000  },
  { name: "San Miguel",    lat: -33.4940, lng: -70.6512, pop: 132520, nse: 3, traffic: 75, density: 14060, area: 9.4,   hh: 56000  },
  { name: "La Cisterna",   lat: -33.5400, lng: -70.6650, pop: 100434, nse: 3, traffic: 70, density: 9360,  area: 10.7,  hh: 38000  },
  { name: "El Bosque",     lat: -33.5650, lng: -70.6740, pop: 175594, nse: 2, traffic: 71, density: 13470, area: 13.0,  hh: 53000  },
  { name: "Renca",         lat: -33.4080, lng: -70.7280, pop: 147151, nse: 2, traffic: 73, density: 6450,  area: 22.8,  hh: 44000  },
  { name: "Conchalí",      lat: -33.3839, lng: -70.6791, pop: 126955, nse: 2, traffic: 74, density: 12060, area: 10.5,  hh: 41000  },
  { name: "Independencia", lat: -33.4135, lng: -70.6692, pop: 100281, nse: 3, traffic: 81, density: 13540, area: 7.4,   hh: 42000  },
];

export const NSE_LABELS: Record<NSE, string> = {
  1: "E",
  2: "D",
  3: "C3",
  4: "C2",
  5: "ABC1",
};

// CLP/mes/hogar
export const NSE_INCOME: Record<NSE, number> = {
  1: 420_000,
  2: 580_000,
  3: 960_000,
  4: 2_100_000,
  5: 5_200_000,
};

// HSL strings — coordinated with design tokens but specific to NSE viz
export const NSE_COLOR_HSL: Record<NSE, string> = {
  1: "0 73% 51%",      // #dc2626  E
  2: "24 95% 53%",     // #f97316  D
  3: "47 95% 53%",     // #eab308  C3
  4: "217 91% 60%",    // #3b82f6  C2
  5: "224 76% 38%",    // #1e40af  ABC1
};
