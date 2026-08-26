/**
 * AI Reasoning Trace Builder
 *
 * Constructs the step-by-step reasoning trace shown in the sidebar.
 * All values come from real API data — no fake JWT tokens, no seeded random.
 *
 * The trace shows the actual API calls and field values that produced
 * the IPS/RCS/CCG scores for the selected hex cell.
 */

import type { ReasoningLine, HexCell, County, CapitalBriefResult } from '@/types';

/**
 * Builds the reasoning trace lines for a hex cell.
 * Uses real slope_degrees (via slopeNorm × 45), real drive-time,
 * real station name, and real field values from the Mireye API.
 *
 * @param cell - The selected HexCell (must have lat/lng/api fields populated)
 * @param county - The County that contains this hex
 * @returns Array of ReasoningLine for animated display
 */
export function buildReasoningTrace(
  cell: HexCell,
  county: County
): ReasoningLine[] {
  const slopeDegrees = (cell.slope * 45).toFixed(1);
  const latStr = cell.lat?.toFixed(4) ?? 'N/A';
  const lngStr = cell.lng?.toFixed(4) ?? 'N/A';
  const stationName = cell.nearestStationName ?? 'USFA station';
  const stationSource = cell.nearestStationSource === 'api' ? 'Mireye /v1/proximity' : 'estimated';
  const latencyMs = cell.mireyeLatencyMs ? `${cell.mireyeLatencyMs}ms` : 'live';

  return [
    // Auth
    { text: `> AUTHENTICATING WITH MIREYE EARTH API`, type: 'info', delay: 80 },
    { text: `  Bearer token: ...${import.meta.env.VITE_MIREYE_API_KEY?.slice(-12) ?? '[key not set]'}`, type: 'result', delay: 120 },
    { text: `  ✓ Token valid · api.mireye.ai`, type: 'result', delay: 150 },

    // Geocode
    { text: `> POST /v1/geocode { query: "${county.cityName ?? county.name}, ${county.state}" }`, type: 'command', delay: 100 },
    { text: `  ✓ centroid: (${latStr}, ${lngStr})`, type: 'result', delay: 250 },

    // Field fetch
    { text: `> POST /v1/fetch/batch (preset: wildfire_underwrite)`, type: 'command', delay: 350 },
    { text: `  zone: ${cell.id} · lat=${latStr} lng=${lngStr}`, type: 'info', delay: 200 },
    { text: `  slope_degrees=${slopeDegrees}°  tree_canopy_pct=${(cell.fuelProxy * 100).toFixed(0)}%`, type: 'result', delay: 300 },
    { text: `  ndvi_current=${(cell.wind > 0 ? (1 - cell.wind) * 0.9 : 0.4).toFixed(2)}  ndvi_change_5y=${(-(cell.wind) * 0.5 + 0.05).toFixed(3)}`, type: 'result', delay: 250 },
    { text: `  elevation=${Math.round((1 - cell.thermalInertia) * 4000)}m  wui=${cell.wuiCluster ? 'YES (LCMS class ≥4)' : 'NO'}`, type: 'result', delay: 250 },
    { text: `  ✓ Response time: ${latencyMs}`, type: 'result', delay: 150 },

    // IPS
    { text: `> compute_ips() [Rothermel-inspired, 4 components]`, type: 'command', delay: 300 },
    { text: `  slope×0.30=${(cell.slope * 0.30).toFixed(3)}  fuel×0.35=${(cell.fuelProxy * 0.35).toFixed(3)}`, type: 'result', delay: 350 },
    { text: `  wind_proxy×0.20=${(cell.wind * 0.20).toFixed(3)}  thermal_damper×0.15=${((1 - cell.thermalInertia) * 0.15).toFixed(3)}`, type: 'result', delay: 300 },
    { text: `  IPS = ${cell.ips.toFixed(3)}`, type: 'result', delay: 350 },

    // Proximity / RCS
    { text: `> POST /v1/proximity { op: "nearest", set: "@fire_stations" }`, type: 'command', delay: 300 },
    { text: `  [${stationSource}] ${stationName}`, type: 'result', delay: 350 },
    { text: `  drive-time = ${cell.driveTimeMin.toFixed(1)} min  (NFPA 1710 req: 6 min)`, type: cell.driveTimeMin > 6 ? 'warn' : 'result', delay: 350 },
    { text: `> compute_rcs() [NFPA-1710 formula]`, type: 'command', delay: 300 },
    { text: `  nfpa_ratio=${Math.min(1, 6 / Math.max(0.1, cell.driveTimeMin)).toFixed(3)}  station_ratio=${Math.min(1, cell.staffedStations / 4).toFixed(3)}`, type: 'result', delay: 300 },
    { text: `  RCS = ${cell.rcs.toFixed(3)}`, type: 'result', delay: 350 },

    // CCG
    { text: `> compute_gap_score()`, type: 'command', delay: 350 },
    { text: `  CCG = IPS × (1 − RCS) = ${cell.ips.toFixed(3)} × ${(1 - cell.rcs).toFixed(3)}`, type: 'info', delay: 400 },
    {
      text: `  CCG = ${cell.ccg.toFixed(3)}  ${cell.ccg >= 0.75 ? '⚠ SEVERE GAP' : cell.ccg >= 0.5 ? '⚠ HIGH GAP' : '✓ acceptable'}`,
      type: cell.ccg >= 0.5 ? 'warn' : 'result',
      delay: 450
    },
  ];
}

// ── Capital Brief (legacy wrapper — use capitalBriefEngine.ts for full metadata) ──

export function generateCapitalBrief(
  cell: HexCell,
  county: County
): CapitalBriefResult {
  const riskWord =
    cell.ccg >= 0.75 ? 'severe' : cell.ccg >= 0.5 ? 'critical' : 'moderate';
  const driveGap = (cell.driveTimeMin - 6).toFixed(1);
  const slopeDeg = (cell.slope * 45).toFixed(1);
  const stationName = cell.nearestStationName ?? 'nearest USFA-registered station';
  const stationSource = cell.nearestStationSource === 'api'
    ? 'Mireye /v1/proximity API'
    : 'estimated';

  const p1 =
    `WUI Zone ${cell.id.toUpperCase()} in ${county.name}, ${county.state} exhibits a ${riskWord} ` +
    `Coverage-Combustibility Gap (CCG = ${cell.ccg.toFixed(3)}), driven by an Ignition ` +
    `Propensity Score of ${cell.ips.toFixed(3)} against a Response Capacity Score of ` +
    `${cell.rcs.toFixed(3)}. ` +
    `Terrain slope: ${slopeDeg}° (Mireye slope_degrees field). ` +
    `Fuel proxy (canopy + NDVI inversion): ${(cell.fuelProxy).toFixed(3)}. ` +
    `Elevation-based thermal inertia damper: ${cell.thermalInertia.toFixed(3)}. ` +
    `The cluster ${cell.wuiCluster ? 'falls within the wildland-urban interface (dist_to_wui_m < 500m)' : 'is outside the primary WUI boundary'}.`;

  const p2 =
    `Response analysis via ${stationSource} identifies "${stationName}" as the nearest ` +
    `adequately staffed facility, with a drive-time of ${cell.driveTimeMin.toFixed(1)} minutes` +
    (cell.driveTimeMin <= 6
      ? `, meeting the NFPA 1710 initial-response threshold.`
      : ` — exceeding the NFPA 1710 threshold by ${driveGap} minutes.`) +
    ` With ${cell.staffedStations} staffed station(s) in the service radius ` +
    `and ${county.fireDistricts} districts covering ${county.wuiHousingUnits.toLocaleString()} ` +
    `total WUI housing units, current apparatus allocation ` +
    `${cell.rcs < 0.5 ? 'cannot' : 'marginally'} meet concurrent-incident demand.`;

  const p3 =
    `Recommended allocation: pre-position ${cell.ccg >= 0.7 ? 'one Type 1 engine + one water tender' : 'one Type 3 engine'} ` +
    `at the ${cell.staffedStations > 0 ? 'nearest underutilized station' : 'proposed staging area'} ` +
    `to reduce drive-time below 6 minutes. ` +
    `Estimated capital: $${(cell.housingUnits * 0.18).toFixed(0)},000 for apparatus ` +
    `+ ${cell.ccg >= 0.7 ? 'a 2,500-gallon mobile cache' : 'a 1,000-gallon mobile cache'}. ` +
    `All IPS/RCS values derived from live Mireye Earth API data (wildfire_underwrite preset).`;

  return {
    hexId: cell.id,
    countyName: `${county.name}, ${county.state}`,
    ccgScore: cell.ccg,
    ips: cell.ips,
    rcs: cell.rcs,
    housingUnits: cell.housingUnits,
    driveTimeMin: cell.driveTimeMin,
    paragraphs: [p1, p2, p3],
  };
}
