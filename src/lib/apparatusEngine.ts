import type { HexCell } from '@/types';

export interface ApparatusRecommendation {
  apparatusList: { name: string; count: number; description: string }[];
  dispatchLevel: 'Standard' | 'Elevated' | 'Extended';
  compliance: {
    status: 'compliant' | 'warning' | 'restricted';
    label: string;
    description: string;
  };
}

/**
 * Calculates recommended fire apparatus resources and NFPA compliance alerts
 * based on physical fuel, slope, and drive-time factors of a grid cell.
 */
export function getApparatusRecommendations(cell: HexCell | null): ApparatusRecommendation {
  if (!cell) {
    return {
      apparatusList: [],
      dispatchLevel: 'Standard',
      compliance: {
        status: 'compliant',
        label: 'No Risk Selected',
        description: 'Select a hotspot cell to evaluate resource dispatch.',
      },
    };
  }

  const list: { name: string; count: number; description: string }[] = [];
  let score = 0;

  // 1. Slopes & Heavy Terrain Access
  if (cell.slope >= 20) {
    list.push({
      name: 'Wildland Hand Crew (Type 1)',
      count: 1,
      description: 'Required for steep slopes where vehicular access is restricted.',
    });
    list.push({
      name: 'Helitack Air Support',
      count: 1,
      description: 'Aerial suppression drops recommended for high-incline terrain.',
    });
    score += 3;
  }

  // 2. Canopy Cover and Brush (Type 3 Wildland Engines)
  if (cell.fuelProxy >= 0.5) {
    const count = cell.ccg >= 0.6 ? 2 : 1;
    list.push({
      name: 'Type 3 Wildland Engine',
      count,
      description: 'Maneuverable 4WD apparatus specialized for heavy vegetation fuel loads.',
    });
    score += 2;
  } else {
    // Standard structural protection
    list.push({
      name: 'Type 1 Structural Engine',
      count: 1,
      description: 'Standard pumper engine for perimeter structural protection.',
    });
    score += 1;
  }

  // 3. Hydrant/Infrastructure Water Tenders (Drive time distance)
  if (cell.driveTimeMin >= 8) {
    list.push({
      name: 'Tactical Water Tender',
      count: 1,
      description: 'Auxiliary water supply required due to remoteness and lack of hydrants.',
    });
    score += 2;
  }

  // Dispatch levels
  let dispatchLevel: ApparatusRecommendation['dispatchLevel'] = 'Standard';
  if (cell.ccg >= 0.6) {
    dispatchLevel = 'Extended';
  } else if (cell.ccg >= 0.35) {
    dispatchLevel = 'Elevated';
  }

  // Compliance Status based on NFPA-1710 guidelines
  let complianceStatus: ApparatusRecommendation['compliance']['status'] = 'compliant';
  let complianceLabel = 'NFPA Compliant';
  let complianceDesc = 'Drive time is within standard initial attack guidelines (≤ 6 minutes).';

  if (cell.slope >= 20) {
    complianceStatus = 'restricted';
    complianceLabel = 'Terrain Restricted';
    complianceDesc = 'Extreme slopes (≥ 20°) prevent heavy engine deployment. Air support and hand crews prioritized.';
  } else if (cell.driveTimeMin > 10) {
    complianceStatus = 'warning';
    complianceLabel = 'Response Delayed';
    complianceDesc = 'Primary response time exceeds 10 minutes. Mutual aid tenders dispatched automatically.';
  } else if (cell.driveTimeMin > 6) {
    complianceStatus = 'warning';
    complianceLabel = 'Outside NFPA 1710 Window';
    complianceDesc = 'Drive time exceeds the 6-minute initial response window for career departments.';
  }

  return {
    apparatusList: list,
    dispatchLevel,
    compliance: {
      status: complianceStatus,
      label: complianceLabel,
      description: complianceDesc,
    },
  };
}
