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
