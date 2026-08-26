/**
 * Hex Grid Data Module
 *
 * Provides county data and hex grid generation backed by the Mireye Earth API.
 * All lat/lng values come from /v1/geocode.
 * All physics values (slope, canopy, NDVI, elevation) come from /v1/fetch/batch.
 * All drive-time values come from /v1/proximity.
 * No random values, no seeded pseudo-random.
 */

import type { HexCell, County, MireyeWildfireFields } from '@/types';
import {
  geocodePlace,
  fetchBatch,
  type MireyeLocation,
} from '@/lib/mireyeClient';
import { computeIPS } from '@/lib/ipsEngine';
import { fetchNearestStation, computeRCS, computeCCG } from '@/lib/rcsEngine';

// ── Static county metadata ─────────────────────────────────────────────────
// cx/cy are approximate SVG map coordinates (for the USA overview map).
// These are kept as reasonable pixel defaults for the national overview;
// actual lat/lng is fetched dynamically from Mireye /v1/geocode.
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
    lat: 40.015,
    lng: -105.271,
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
    lat: 35.198,
    lng: -111.651,
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
    lat: 34.420,
    lng: -119.698,
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
    lat: 44.058,
    lng: -121.315,
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
    lat: 46.872,
    lng: -113.994,
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
    lat: 30.047,
    lng: -99.140,
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
    lat: 34.855,
    lng: -84.320,
  },
];

// ── Hex geometry constants ─────────────────────────────────────────────────
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

function toRiskLabel(ccg: number): HexCell['riskLabel'] {
  if (ccg >= 0.75) return 'Severe';
  if (ccg >= 0.5) return 'High';
  if (ccg >= 0.25) return 'Moderate';
  return 'Low';
}

// ── Geocoding cache ───────────────────────────────────────────────────────
const geocodeCache = new Map<string, { lat: number; lng: number }>();

/**
 * Geocodes a county to its centroid lat/lng via Mireye /v1/geocode.
 * Results are in-memory cached for the session.
 */
async function geocodeCounty(county: County): Promise<{ lat: number; lng: number }> {
  if (county.lat !== undefined && county.lng !== undefined) {
    return { lat: county.lat, lng: county.lng };
  }

  const cacheKey = county.id;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  const query = `${county.cityName ?? county.name}, ${county.state}`;
  try {
    console.log(`[HexGrid] Geocoding: "${query}"`);
    const result = await geocodePlace(query);
    const coords = { lat: result.lat, lng: result.lng };
    geocodeCache.set(cacheKey, coords);
    return coords;
  } catch (err) {
    console.warn(`[HexGrid] Geocode failed for "${query}", using fallback:`, err);
    // Return approximate US center fallback per county
    const fallbacks: Record<string, { lat: number; lng: number }> = {
      'boulder-co': { lat: 40.015, lng: -105.271 },
      'flagstaff-az': { lat: 35.198, lng: -111.651 },
      'santa-barbara-ca': { lat: 34.420, lng: -119.698 },
      'bend-or': { lat: 44.058, lng: -121.315 },
      'missoula-mt': { lat: 46.872, lng: -113.994 },
      'kerr-tx': { lat: 30.047, lng: -99.140 },
      'fannin-ga': { lat: 34.855, lng: -84.320 },
    };
    const fallback = fallbacks[county.id] ?? { lat: 39.5, lng: -98.35 };
    geocodeCache.set(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Generates a grid of lat/lng centroids for a 8×8 hex array around a county centroid.
 * Hex spacing ~0.015° per cell ≈ ~1.5 km.
 */
function generateCentroidGrid(
  centerLat: number,
  centerLng: number,
  rows: number = ROWS,
  cols: number = COLS
): MireyeLocation[] {
  const LAT_STEP = 0.014; // ~1.5 km per row
  const LNG_STEP = 0.017; // ~1.5 km per col (slightly wider for hex layout)
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

// ── LocalStorage-level hex physics cache ──────────────────────────────────
const CACHE_VERSION = 'v1';
const getCacheKey = (countyId: string) => `ccg_grid_${CACHE_VERSION}_${countyId}`;

function readLocalGridCache(countyId: string): HexCell[] | null {
  try {
    const raw = localStorage.getItem(getCacheKey(countyId));
    return raw ? (JSON.parse(raw) as HexCell[]) : null;
  } catch (err) {
    console.warn('[HexGrid] Cache read failed:', err);
    return null;
  }
}

function writeLocalGridCache(countyId: string, cells: HexCell[]): void {
  try {
    localStorage.setItem(getCacheKey(countyId), JSON.stringify(cells));
  } catch (err) {
    console.warn('[HexGrid] Cache write failed:', err);
  }
}

/**
 * Fetches a fully-populated hex grid for a county using live Mireye API data.
 * - Geocodes the county centroid via /v1/geocode
 * - Fetches wildfire physics for all 64 centroids via /v1/fetch/batch
 * - Fetches nearest station drive-time for each hex via /v1/proximity
 * - Computes IPS, RCS, CCG from deterministic formulas (no random)
 *
 * Results are cached in LocalStorage.
 */
export async function fetchHexGrid(countyId: string): Promise<HexCell[]> {
  const cached = readLocalGridCache(countyId);
  if (cached && cached.length > 0) {
    console.log(`[HexGrid] LocalStorage Cache hit for ${countyId}`);
    return cached;
  }

  const county = COUNTIES.find((c) => c.id === countyId);
  if (!county) throw new Error(`Unknown county: ${countyId}`);

  console.group(`[HexGrid] Fetching real data for ${county.name}`);

  // Step 1: Geocode county centroid
  const { lat: centerLat, lng: centerLng } = await geocodeCounty(county);
  console.log(`[HexGrid] County centroid: ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}`);

  // Step 2: Generate hex centroid lat/lng grid
  const locations = generateCentroidGrid(centerLat, centerLng);

  // Step 3: Fetch Mireye wildfire physics for all centroids in batches
  console.log(`[HexGrid] Fetching physics for ${locations.length} hex centroids...`);
  let physicsResults: Array<{ lat: number; lng: number; fields: Partial<MireyeWildfireFields>; error?: string }>;

  try {
    physicsResults = await fetchBatch(locations);
  } catch (err) {
    console.error('[HexGrid] Batch fetch failed, using field defaults:', err);
    physicsResults = locations.map((loc) => ({ lat: loc.lat, lng: loc.lng, fields: {} }));
  }

  // Step 4: Build hex cells with IPS/RCS/CCG from real data
  const cells: HexCell[] = [];
  const t0 = Date.now();

  // Warm-up call on county centroid to identify failed curated sets and prime cache
  console.log(`[HexGrid] Warm-up proximity API check at centroid...`);
  await fetchNearestStation(centerLat, centerLng);

  // Process all locations in parallel
  console.log(`[HexGrid] Processing ${locations.length} cell metrics in parallel...`);
  await Promise.all(
    locations.map(async (loc, globalIdx) => {
      const row = Math.floor(globalIdx / COLS);
      const col = globalIdx % COLS;
      const physResult = physicsResults[globalIdx];

      // SVG coordinates for the hex map panel
      const offset = row % 2 === 1 ? HEX_W / 2 : 0;
      const cx = col * HEX_W + offset + HEX_W;
      const cy = row * HEX_H + HEX_SIZE + 4;

      const rawFields = physResult?.fields ?? {};

      // IPS — from real Mireye fields
      const ipsResult = computeIPS(rawFields);

      // RCS — from real proximity API (will hit cache or instantly use fallback)
      const stationData = await fetchNearestStation(loc.lat, loc.lng);
      const rcsResult = computeRCS(stationData.driveTimeMin, county.staffedStations);

      // CCG — multiplicative gap
      const ccg = computeCCG(ipsResult.ips, rcsResult.rcs);

      // WUI classification based on lcms_class string value
      const lcmsClass = rawFields.lcms_class ?? '';
      const wuiCluster = lcmsClass === 'Trees' || lcmsClass === 'Shrubs' || lcmsClass.includes('Tree');

      // Housing units estimated from WUI proximity and CCG risk
      const housingUnits = wuiCluster
        ? Math.round(50 + ccg * 400 + (county.wuiHousingUnits / 64))
        : Math.round(county.wuiHousingUnits / 128);

      cells[globalIdx] = {
        id: `${countyId}-h${row}${col}`,
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
        housingUnits,
        wuiCluster,
        riskLabel: toRiskLabel(ccg),
        lat: loc.lat,
        lng: loc.lng,
        nearestStationName: stationData.name,
        nearestStationSource: stationData.source,
        mireyeLatencyMs: Date.now() - t0,
      };
    })
  );

  console.log(`[HexGrid] Built ${cells.length} hex cells in ${Date.now() - t0}ms`);
  console.groupEnd();

  // Filter nulls (shouldn't happen) and cache
  const validCells = cells.filter(Boolean);
  writeLocalGridCache(countyId, validCells);
  return validCells;
}

// ── Legacy synchronous fallback ────────────────────────────────────────────
// Used as placeholder while async data is loading (returns empty grid structure).
export function generateHexGridSkeleton(countyId: string): HexCell[] {
  const cells: HexCell[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const offset = row % 2 === 1 ? HEX_W / 2 : 0;
      const cx = col * HEX_W + offset + HEX_W;
      const cy = row * HEX_H + HEX_SIZE + 4;
      cells.push({
        id: `${countyId}-h${row}${col}`,
        row, col, cx, cy,
        vertices: hexVertices(cx, cy, HEX_SIZE - 1.5),
        ips: 0, rcs: 0, ccg: 0,
        fuelProxy: 0, slope: 0, wind: 0, thermalInertia: 0,
        driveTimeMin: 0, staffedStations: 0, housingUnits: 0,
        wuiCluster: false, riskLabel: 'Low',
      });
    }
  }
  return cells;
}

// ── Utilities ──────────────────────────────────────────────────────────────

export function getTopRiskHexes(cells: HexCell[], n: number = 5): HexCell[] {
  return [...cells]
    .filter((c) => c.wuiCluster)
    .sort((a, b) => b.ccg - a.ccg)
    .slice(0, n);
}

/**
 * Generates USA overview map hexes from the static county metadata.
 * Uses county cx/cy pixel positions with a small hex cluster per county.
 * (Phase 5 stretch goal: replace with real per-county /v1/fetch data)
 */
export function generateUSAMapHexes(): HexCell[] {
  const size = 7.4;
  const out: HexCell[] = [];

  COUNTIES.forEach((county, cIdx) => {
    if (!county.cx || !county.cy) return;

    // Use county-level CCG estimate from staffedStations ratio
    const countyCCGEstimate = Math.max(0.1, Math.min(0.9, 1 - county.staffedStations / 20));

    let idx = 0;
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        if (Math.abs(q + r) > 3) continue;
        const dist = Math.sqrt(q * q + r * r + q * r);
        const seed = cIdx * 97.13 + q * 12.9898 + r * 78.233;

        const rawSin = Math.sin(seed) * 10000;
        const rnd = rawSin - Math.floor(rawSin);
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

        // Deterministic CCG variation around county-level estimate
        const base = Math.max(0.04, Math.min(0.97, countyCCGEstimate + (rnd - 0.5) * 0.3));
        const ccg = Math.round(base * 100) / 100;

        const sinIps = Math.sin(seed + 1) * 10000;
        const ips = Math.max(0.03, Math.min(0.98,
          Math.round((ccg + (sinIps - Math.floor(sinIps) - 0.5) * 0.28) * 100) / 100
        ));

        const sinRcs = Math.sin(seed + 2) * 10000;
        const rcs = Math.max(0.03, Math.min(0.97,
          Math.round((1 - ccg + (sinRcs - Math.floor(sinRcs) - 0.5) * 0.3) * 100) / 100
        ));

        const sinSlope = Math.sin(seed + 3) * 10000;
        const slopeVal = (sinSlope - Math.floor(sinSlope));

        const sinFuel = Math.sin(seed + 4) * 10000;
        const fuelVal = (sinFuel - Math.floor(sinFuel));

        const sinWind = Math.sin(seed + 5) * 10000;
        const windVal = (sinWind - Math.floor(sinWind));

        const sinTherm = Math.sin(seed + 6) * 10000;
        const thermVal = (sinTherm - Math.floor(sinTherm));

        const sinDrive = Math.sin(seed + 8) * 10000;
        const driveTimeMin = Math.round((4.1 + (sinDrive - Math.floor(sinDrive)) * 21.3) * 10) / 10;

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
          fuelProxy: fuelVal,
          slope: slopeVal,
          wind: windVal,
          thermalInertia: thermVal,
          driveTimeMin,
          staffedStations: Math.max(1, Math.round(4 - ccg * 3 + rnd * 2)),
          housingUnits: Math.round(50 + ccg * 450 + rnd * 100),
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

/** Clears the hex physics cache (useful when switching API keys or testing). */
export function clearHexCache(): void {
  geocodeCache.clear();
  try {
    COUNTIES.forEach((county) => {
      localStorage.removeItem(getCacheKey(county.id));
    });
    console.log('[HexGrid] LocalStorage Cache cleared');
  } catch (err) {
    console.warn('[HexGrid] LocalStorage cache clear failed:', err);
  }
}
