import type { ReasoningLine, HexCell, County, CapitalBriefResult } from '@/types';

export function buildReasoningTrace(
  cell: HexCell,
  county: County
): ReasoningLine[] {
  return [
    { text: `> select_county("${county.id}")`, type: 'command', delay: 100 },
    { text: `  ✓ loaded ${county.hexCount} hex cells · ${county.fireDistricts} fire districts`, type: 'result', delay: 250 },
    { text: `> get_hex_physics("${cell.id}")`, type: 'command', delay: 400 },
    { text: `  slope=${cell.slope.toFixed(3)} fuel=${cell.fuelProxy.toFixed(3)} wind=${cell.wind.toFixed(2)}m/s`, type: 'result', delay: 350 },
    { text: `  thermal_inertia=${cell.thermalInertia.toFixed(3)} housing_units=${cell.housingUnits}`, type: 'result', delay: 300 },
    { text: `> compute_ips()`, type: 'command', delay: 350 },
    { text: `  IPS = ${cell.ips.toFixed(3)}  [Rothermel-inspired fusion]`, type: 'result', delay: 400 },
    { text: `> get_nearest_stations(lat, lon)`, type: 'command', delay: 350 },
    { text: `  Found ${cell.staffedStations} staffed USFA station(s) within 15mi radius`, type: 'result', delay: 400 },
    { text: `> osrm_route(drive_time)`, type: 'command', delay: 350 },
    { text: `  nearest drive-time = ${cell.driveTimeMin.toFixed(1)} min (NFPA-1 req: 6 min)`, type: cell.driveTimeMin > 6 ? 'warn' : 'result', delay: 400 },
    { text: `> compute_rcs()`, type: 'command', delay: 350 },
    { text: `  RCS = ${cell.rcs.toFixed(3)}  [response capacity vs. NFPA-1]`, type: 'result', delay: 400 },
    { text: `> compute_gap_score()`, type: 'command', delay: 400 },
    { text: `  CCG = IPS × (1 − RCS) = ${cell.ips.toFixed(2)} × ${(1 - cell.rcs).toFixed(2)}`, type: 'info', delay: 450 },
    { text: `  CCG = ${cell.ccg.toFixed(3)}  ${cell.ccg >= 0.75 ? '⚠ SEVERE GAP' : cell.ccg >= 0.5 ? '⚠ HIGH GAP' : '✓ acceptable'}`, type: cell.ccg >= 0.5 ? 'warn' : 'result', delay: 500 },
  ];
}

export function generateCapitalBrief(
  cell: HexCell,
  county: County
): CapitalBriefResult {
  const riskWord =
    cell.ccg >= 0.75 ? 'severe' : cell.ccg >= 0.5 ? 'critical' : 'moderate';
  const driveGap = (cell.driveTimeMin - 6).toFixed(1);

  const p1 = `Hex ${cell.id.toUpperCase()} in ${county.name}, ${county.state} exhibits a ${riskWord} Coverage-Combustibility Gap (CCG = ${cell.ccg.toFixed(2)}), driven by an Ignition Propensity Score of ${cell.ips.toFixed(2)} against a Response Capacity Score of only ${cell.rcs.toFixed(2)}. The cluster contains an estimated ${cell.housingUnits} housing units situated on terrain with a mean slope of ${(cell.slope * 45).toFixed(1)}° and high fuel loading (proxy: ${cell.fuelProxy.toFixed(2)}), conditions consistent with rapid fire spread under prevailing winds of ${cell.wind.toFixed(1)} m/s.`;

  const p2 = `Response analysis indicates the nearest adequately staffed USFA-registered station reaches this cluster in ${cell.driveTimeMin.toFixed(1)} minutes — exceeding the NFPA 1710 initial-response threshold by ${driveGap} minutes. With only ${cell.staffedStations} staffed station(s) within a 15-mile service radius and ${county.fireDistricts} districts covering ${county.wuiHousingUnits.toLocaleString()} total WUI housing units, current apparatus allocation cannot meet concurrent-incident demand in this sector.`;

  const p3 = `Recommended allocation: prioritize ${cell.ccg >= 0.7 ? 'one Type 1 engine + one water tender' : 'one Type 3 engine'} pre-positioned at the ${cell.staffedStations > 0 ? 'nearest underutilized station' : 'proposed staging area'} to reduce drive-time below 6 minutes. Estimated capital requirement: $${(cell.housingUnits * 0.18).toFixed(0)},000 for apparatus and ${cell.ccg >= 0.7 ? 'a 2,500-gallon mobile cache' : 'a 1,000-gallon mobile cache'}. This investment addresses a quantified physics-grounded gap affecting ${cell.housingUnits} residences and is justified by the multiplicative CCG methodology integrating Rothermel-derived ignition physics with OSRM-validated response routing.`;

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
