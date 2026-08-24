import type { HexCell, County } from '@/types';

export const COUNTIES: County[] = [
  {
    id: 'boulder-co',
    name: 'Boulder County',
    state: 'CO',
    hexCount: 64,
    population: 332000,
    wuiHousingUnits: 18400,
    fireDistricts: 7,
    staffedStations: 12,
    cx: 317,
    cy: 255,
    cityName: 'Boulder',
  },
  {
    id: 'flagstaff-az',
    name: 'Coconino County',
    state: 'AZ',
    hexCount: 64,
    population: 145000,
    wuiHousingUnits: 9200,
    fireDistricts: 5,
    staffedStations: 8,
    cx: 194,
    cy: 345,
    cityName: 'Flagstaff',
  },
  {
    id: 'santa-barbara-ca',
    name: 'Santa Barbara County',
    state: 'CA',
    hexCount: 64,
    population: 448000,
    wuiHousingUnits: 12100,
    fireDistricts: 6,
    staffedStations: 14,
    cx: 95,
    cy: 310,
    cityName: 'Santa Barbara',
  },
  {
    id: 'bend-or',
    name: 'Deschutes County',
    state: 'OR',
    hexCount: 64,
    population: 198000,
    wuiHousingUnits: 14700,
    fireDistricts: 4,
    staffedStations: 9,
    cx: 96,
    cy: 118,
    cityName: 'Bend',
  },
  {
    id: 'missoula-mt',
    name: 'Missoula County',
    state: 'MT',
    hexCount: 64,
    population: 119000,
    wuiHousingUnits: 8600,
    fireDistricts: 5,
    staffedStations: 7,
    cx: 225,
    cy: 90,
    cityName: 'Missoula',
  },
  {
    id: 'kerr-tx',
    name: 'Kerr County',
    state: 'TX',
    hexCount: 64,
    population: 53000,
    wuiHousingUnits: 6500,
    fireDistricts: 3,
    staffedStations: 5,
    cx: 390,
    cy: 470,
    cityName: 'Kerrville',
  },
  {
    id: 'fannin-ga',
    name: 'Fannin County',
    state: 'GA',
    hexCount: 64,
    population: 26000,
    wuiHousingUnits: 4800,
    fireDistricts: 2,
    staffedStations: 4,
    cx: 714,
    cy: 380,
    cityName: 'Blue Ridge',
  },
];

// Deterministic pseudo-random based on seed
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const HEX_SIZE = 26;
const HEX_W = HEX_SIZE * Math.sqrt(3);
const HEX_H = HEX_SIZE * 1.5;
const COLS = 8;
const ROWS = 8;

function hexVertices(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function riskLabel(ccg: number): HexCell['riskLabel'] {
  if (ccg >= 0.75) return 'Severe';
  if (ccg >= 0.5) return 'High';
  if (ccg >= 0.25) return 'Moderate';
  return 'Low';
}

export function generateHexGrid(countyId: string): HexCell[] {
  const seedBase = countyId
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = seeded(seedBase);

  const cells: HexCell[] = [];

  // Create a few "hot zones" — clusters of high risk
  const hotZones = [
    { col: 1 + Math.floor(rand() * 3), row: 2 + Math.floor(rand() * 3), intensity: 0.8 + rand() * 0.2 },
    { col: 4 + Math.floor(rand() * 2), row: 4 + Math.floor(rand() * 2), intensity: 0.7 + rand() * 0.3 },
    { col: 2 + Math.floor(rand() * 2), row: 5 + Math.floor(rand() * 2), intensity: 0.6 + rand() * 0.3 },
  ];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const offset = row % 2 === 1 ? HEX_W / 2 : 0;
      const cx = col * HEX_W + offset + HEX_W;
      const cy = row * HEX_H + HEX_SIZE + 4;

      // Distance to nearest hot zone
      let maxInfluence = 0;
      for (const hz of hotZones) {
        const dist = Math.sqrt((col - hz.col) ** 2 + (row - hz.row) ** 2);
        const influence = Math.max(0, hz.intensity * (1 - dist / 3.5));
        maxInfluence = Math.max(maxInfluence, influence);
      }

      const baseNoise = rand() * 0.25;
      const wuiCluster = maxInfluence > 0.3 || rand() > 0.6;

      // IPS — Ignition Propensity Score (0-1)
      const slope = Math.min(1, maxInfluence * 0.6 + rand() * 0.4);
      const fuelProxy = Math.min(1, maxInfluence * 0.7 + rand() * 0.3);
      const wind = Math.min(1, 0.3 + maxInfluence * 0.4 + rand() * 0.3);
      const thermalInertia = Math.max(0.1, 0.8 - maxInfluence * 0.5 + rand() * 0.2);
      const ips = Math.min(
        1,
        Math.max(
          0.05,
          slope * 0.3 + fuelProxy * 0.35 + wind * 0.2 + (1 - thermalInertia) * 0.15
        )
      );

      // RCS — Response Capacity Score (0-1, higher = better coverage)
      const driveTimeMin = Math.max(2, 25 - maxInfluence * 18 + rand() * 12);
      const staffedStations = Math.max(0, Math.round(4 - maxInfluence * 3.5 + rand() * 2));
      const nfpa1Requirement = 6; // minutes for initial response
      const rcs = Math.min(
        1,
        Math.max(
          0.05,
          (nfpa1Requirement / driveTimeMin) * 0.5 + (staffedStations / 4) * 0.5
        )
      );

      // CCG — Coverage-Combustibility Gap (multiplicative gap)
      const ccg = Math.min(1, Math.max(0, ips * (1 - rcs)));

      const housingUnits = wuiCluster
        ? Math.round(50 + maxInfluence * 450 + rand() * 100)
        : Math.round(rand() * 30);

      cells.push({
        id: `${countyId}-h${row}${col}`,
        row,
        col,
        cx,
        cy,
        vertices: hexVertices(cx, cy, HEX_SIZE - 1.5),
        ips,
        rcs,
        ccg,
        fuelProxy,
        slope,
        wind,
        thermalInertia,
        driveTimeMin,
        staffedStations,
        housingUnits,
        wuiCluster,
        riskLabel: riskLabel(ccg),
      });
    }
  }

  return cells;
}

export function getTopRiskHexes(cells: HexCell[], n: number = 5): HexCell[] {
  return [...cells]
    .filter((c) => c.wuiCluster)
    .sort((a, b) => b.ccg - a.ccg)
    .slice(0, n);
}

export function generateUSAMapHexes(): HexCell[] {
  const size = 7.4;
  const out: HexCell[] = [];
  
  COUNTIES.forEach((county, cIdx) => {
    if (!county.cx || !county.cy) return;
    
    let idx = 0;
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        if (Math.abs(q + r) > 3) continue;
        const dist = Math.sqrt(q * q + r * r + q * r);
        const seed = cIdx * 97.13 + q * 12.9898 + r * 78.233;
        
        const rand = () => {
          const x = Math.sin(seed) * 10000;
          return x - Math.floor(x);
        };
        const rnd = rand();
        if (dist > 2.2 + rnd * 0.8) continue;
        if (rnd < 0.14) continue;
        
        const dx = size * 1.5 * q;
        const dy = size * Math.sqrt(3) * (r + q / 2);
        
        const cx = county.cx + dx;
        const cy = county.cy + dy;
        
        const pts: string[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 180) * (60 * i);
          pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
        }
        const vertices = pts.join(' ');
        
        const base = Math.max(0.04, Math.min(0.97, 0.88 - dist * 0.22 + (rnd - 0.5) * 0.34));
        const ccg = Math.round(base * 100) / 100;
        
        const seed1 = seed + 1;
        const x1 = Math.sin(seed1) * 10000;
        const rand1 = x1 - Math.floor(x1);
        const ips = Math.max(0.03, Math.min(0.98, Math.round((ccg + (rand1 - 0.5) * 0.28) * 100) / 100));
        
        const seed2 = seed + 2;
        const x2 = Math.sin(seed2) * 10000;
        const rand2 = x2 - Math.floor(x2);
        const rcs = Math.max(0.03, Math.min(0.97, Math.round((1 - ccg + (rand2 - 0.5) * 0.3) * 100) / 100));
        
        const seed3 = seed + 3;
        const x3 = Math.sin(seed3) * 10000;
        const rand3 = x3 - Math.floor(x3);
        const slope = Math.round((8 + rand3 * 34) * 10) / 10;
        
        const seed4 = seed + 4;
        const x4 = Math.sin(seed4) * 10000;
        const rand4 = x4 - Math.floor(x4);
        const fuelProxy = Math.round((4 + rand4 * 29) * 10) / 10;
        
        const seed5 = seed + 5;
        const x5 = Math.sin(seed5) * 10000;
        const rand5 = x5 - Math.floor(x5);
        const wind = Math.round((3 + rand5 * 21) * 10) / 10;
        
        const seed6 = seed + 6;
        const x6 = Math.sin(seed6) * 10000;
        const rand6 = x6 - Math.floor(x6);
        const thermalInertia = Math.round((0.11 + rand6 * 0.86) * 100) / 100;
        
        const seed8 = seed + 8;
        const x8 = Math.sin(seed8) * 10000;
        const rand8 = x8 - Math.floor(x8);
        const driveTimeMin = Math.round((4.1 + rand8 * 21.3) * 10) / 10;
        
        const staffedStations = Math.max(1, Math.round(4 - ccg * 3 + rnd * 2));
        const housingUnits = Math.round(50 + ccg * 450 + rnd * 100);
        
        out.push({
          id: `${county.id}-uh${idx.toString().padStart(2, '0')}`,
          row: q,
          col: r,
          cx,
          cy,
          vertices,
          ips,
          rcs,
          ccg,
          fuelProxy,
          slope,
          wind,
          thermalInertia,
          driveTimeMin,
          staffedStations,
          housingUnits,
          wuiCluster: true,
          riskLabel: ccg >= 0.75 ? 'Severe' : ccg >= 0.5 ? 'High' : ccg >= 0.25 ? 'Moderate' : 'Low',
          state: county.state,
          county: county.name,
          region: county.id,
        });
        idx++;
      }
    }
  });
  
  return out;
}
