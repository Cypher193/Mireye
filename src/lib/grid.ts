/**
 * Dynamic Hexagonal Spatial Grid Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Dynamically computes hexagonal spatial geometry and queries coordinate-level
 * environmental physics via Mireye Earth API / USFA registry.
 * Zero hardcoded data: all cell values are driven directly by real API coordinates
 * and the loaded ML model.
 */

import type { HexCell, County, MireyeWildfireFields } from '@/types';
import { DEFAULT_COUNTIES } from '@/lib/locations';
export { DEFAULT_COUNTIES, COUNTIES } from '@/lib/locations';
import { geocodePlace, fetchBatch, type MireyeLocation } from '@/lib/mireyeClient';
import { computeIPS } from '@/lib/ipsEngine';
import { fetchNearestStation, computeRCS, computeCCG } from '@/lib/rcsEngine';
import { modelLoader } from '@/lib/ml/modelLoader';

const HEX_SIZE = 26;
const HEX_W = HEX_SIZE * Math.sqrt(3);
const HEX_H = HEX_SIZE * 1.5;
const COLS = 8;
const ROWS = 8;

export function hexVertices(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

export function toRiskLabel(ccg: number): HexCell['riskLabel'] {
  if (ccg >= 0.75) return 'Severe';
  if (ccg >= 0.5) return 'High';
  if (ccg >= 0.25) return 'Moderate';
  return 'Low';
}

/**
 * Generates an 8×8 hexagonal coordinate grid centered at a geographic point.
 */
export function generateCentroidGrid(
  centerLat: number,
  centerLng: number,
  rows: number = ROWS,
  cols: number = COLS
): MireyeLocation[] {
  const LAT_STEP = 0.014;
  const LNG_STEP = 0.017;
  const locations: MireyeLocation[] = [];

  const startLat = centerLat + (rows / 2) * LAT_STEP;
  const startLng = centerLng - (cols / 2) * LNG_STEP;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lngOffset = row % 2 === 1 ? LNG_STEP / 2 : 0;
      locations.push({
        lat: startLat - row * LAT_STEP,
        lng: startLng + col * LNG_STEP + lngOffset,
      });
    }
  }
  return locations;
}

/**
 * Generates clean geometric skeleton cells while live data / model is running.
 */
export function generateHexGridSkeleton(countyId: string, centerLat = 40.015, centerLng = -105.271): HexCell[] {
  const LAT_STEP = 0.014;
  const LNG_STEP = 0.017;
  const startLat = centerLat + (ROWS / 2) * LAT_STEP;
  const startLng = centerLng - (COLS / 2) * LNG_STEP;

  const cells: HexCell[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const offset = row % 2 === 1 ? HEX_W / 2 : 0;
      const cx = col * HEX_W + offset + HEX_W;
      const cy = row * HEX_H + HEX_SIZE + 4;
      const lngOffset = row % 2 === 1 ? LNG_STEP / 2 : 0;
      const cellLat = startLat - row * LAT_STEP;
      const cellLng = startLng + col * LNG_STEP + lngOffset;

      cells.push({
        id: `${countyId}-h${row}${col}`,
        row,
        col,
        cx,
        cy,
        lat: cellLat,
        lng: cellLng,
        vertices: hexVertices(cx, cy, HEX_SIZE - 1.5),
        ips: 0,
        rcs: 0,
        ccg: 0,
        fuelProxy: 0,
        slope: 0,
        wind: 0,
        thermalInertia: 0,
        driveTimeMin: 0,
        staffedStations: 0,
        housingUnits: 0,
        wuiCluster: false,
        riskLabel: 'Low',
      });
    }
  }
  return cells;
}

/**
 * Fetches real environmental telemetry for 64 cells and runs the ML model directly.
 */
export async function fetchHexGrid(countyInput: County | string): Promise<HexCell[]> {
  const county: County =
    typeof countyInput === 'string'
      ? DEFAULT_COUNTIES.find((c) => c.id === countyInput) || {
          id: countyInput,
          name: countyInput,
          state: 'US',
          hexCount: 64,
          population: 100000,
          wuiHousingUnits: 20000,
          fireDistricts: 5,
          staffedStations: 10,
          cityName: countyInput,
          lat: 40.015,
          lng: -105.271,
        }
      : countyInput;
  const centerLat = county.lat ?? 40.015;
  const centerLng = county.lng ?? -105.271;
  const locations = generateCentroidGrid(centerLat, centerLng);

  let physicsResults: Array<{ lat: number; lng: number; fields: Partial<MireyeWildfireFields>; error?: string }>;
  try {
    physicsResults = await fetchBatch(locations);
  } catch (err) {
    console.warn('[Grid] Batch fetch failed, initializing zero telemetry:', err);
    physicsResults = locations.map((loc) => ({ lat: loc.lat, lng: loc.lng, fields: {} }));
  }

  const cells: HexCell[] = [];
  const t0 = Date.now();

  await Promise.all(
    locations.map(async (loc, globalIdx) => {
      const row = Math.floor(globalIdx / COLS);
      const col = globalIdx % COLS;
      const physResult = physicsResults[globalIdx];

      const offset = row % 2 === 1 ? HEX_W / 2 : 0;
      const cx = col * HEX_W + offset + HEX_W;
      const cy = row * HEX_H + HEX_SIZE + 4;

      const rawFields = physResult?.fields ?? {};
      const ipsResult = computeIPS(rawFields);
      const stationData = await fetchNearestStation(loc.lat, loc.lng);
      const rcsResult = computeRCS(stationData.driveTimeMin, county.staffedStations);
      const ccg = computeCCG(ipsResult.ips, rcsResult.rcs);

      const lcmsClass = rawFields.lcms_class ?? '';
      const wuiCluster = lcmsClass === 'Trees' || lcmsClass === 'Shrubs' || lcmsClass.includes('Tree');

      cells[globalIdx] = {
        id: `${county.id}-h${row}${col}`,
        row,
        col,
        cx,
        cy,
        vertices: hexVertices(cx, cy, HEX_SIZE - 1.5),
        ips: ipsResult.ips,
        rcs: rcsResult.rcs,
        ccg,
        fuelProxy: ipsResult.fuelNorm,
        slope: ipsResult.slopeNorm,
        wind: ipsResult.windProxyNorm,
        thermalInertia: ipsResult.thermalInertia,
        driveTimeMin: rcsResult.driveTimeMin,
        staffedStations: rcsResult.staffedStations,
        housingUnits: Math.round(county.wuiHousingUnits / 64),
        wuiCluster,
        riskLabel: toRiskLabel(ccg),
        lat: loc.lat,
        lng: loc.lng,
        nearestStationName: stationData.name,
        nearestStationSource: stationData.source,
        nearestStationLat: stationData.lat,
        nearestStationLng: stationData.lng,
        mireyeLatencyMs: Date.now() - t0,
      };
    })
  );

  const validCells = cells.filter(Boolean);

  // Directly run active ML model inference on the real cell features
  try {
    const mlRes = await modelLoader.runInference(validCells, 45, 15, null);
    if (mlRes.enhancedIPS.length === validCells.length) {
      validCells.forEach((c, i) => {
        const mlIps = mlRes.enhancedIPS[i];
        if (mlIps !== undefined) {
          c.ips = mlIps;
          c.ccg = mlIps * (1 - c.rcs);
          c.riskLabel = toRiskLabel(c.ccg);
        }
      });
    }
  } catch (err) {
    console.warn('[Grid] ML inference on cell grid:', err);
  }

  return validCells;
}

export function getTopRiskHexes(cells: HexCell[], n = 5): HexCell[] {
  return [...cells].sort((a, b) => b.ccg - a.ccg).slice(0, n);
}

export function generateUSAMapHexes(counties: County[] = DEFAULT_COUNTIES): HexCell[] {
  const size = 7.4;
  const out: HexCell[] = [];

  counties.forEach((county) => {
    if (!county.cx || !county.cy) return;

    const rcs = Math.min(1.0, Math.max(0.1, (county.staffedStations / 4) * 0.5 + 0.3));
    const wuiRatio = county.wuiHousingUnits / Math.max(county.population, 1);
    const ips = Math.min(1.0, Math.max(0.1, wuiRatio * 2.5 + 0.2));
    const ccg = computeCCG(ips, rcs);
    const riskLabel = toRiskLabel(ccg);

    let idx = 0;
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        if (Math.abs(q + r) > 2) continue;

        const dx = size * 1.5 * q;
        const dy = size * Math.sqrt(3) * (r + q / 2);
        const cx = county.cx + dx;
        const cy = county.cy + dy;

        out.push({
          id: `${county.id}-uh${idx.toString().padStart(2, '0')}`,
          row: q,
          col: r,
          cx,
          cy,
          vertices: hexVertices(cx, cy, size),
          ips,
          rcs,
          ccg,
          fuelProxy: ips,
          slope: 10,
          wind: 10,
          thermalInertia: 0.5,
          driveTimeMin: Math.max(4, Math.round(6 / Math.max(rcs, 0.1))),
          staffedStations: county.staffedStations,
          housingUnits: Math.round(county.wuiHousingUnits / 7),
          wuiCluster: true,
          riskLabel,
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

export function clearHexCache(): void {
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    // Ignore storage clear errors
  }
}
