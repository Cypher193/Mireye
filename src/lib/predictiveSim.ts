import type { HexCell } from '@/types';

export interface PredictiveSpreadState {
  cellId: string;
  isOnFire: boolean;
  arrivalTimeMin: number;
  burnIntensity: number; // 0 (unburned) to 1 (fully engulfed/charred)
}

/**
 * Computes the fire spread propagation times for all cells in a grid,
 * simulating FireSenseNet / FireCast dynamics based on slope, fuel, and wind vector alignment.
 */
export function computePredictiveSpread(
  cells: HexCell[],
  ignitionCell: HexCell | null,
  windAngleDeg: number,
  windSpeedMph: number,
  simTimeMin: number
): Record<string, PredictiveSpreadState> {
  const result: Record<string, PredictiveSpreadState> = {};
  if (!ignitionCell || cells.length === 0) {
    cells.forEach((c) => {
      result[c.id] = { cellId: c.id, isOnFire: false, arrivalTimeMin: Infinity, burnIntensity: 0 };
    });
    return result;
  }

  const windRad = (windAngleDeg * Math.PI) / 180;
  // Wind vector unit coordinates (direction of travel)
  const windX = Math.sin(windRad);
  const windY = -Math.cos(windRad);

  cells.forEach((cell) => {
    if (cell.id === ignitionCell.id) {
      result[cell.id] = {
        cellId: cell.id,
        isOnFire: true,
        arrivalTimeMin: 0,
        burnIntensity: Math.min(1.0, 0.4 + simTimeMin * 0.05),
      };
      return;
    }

    // Distance in geodetic approximations (degrees)
    const dx = (cell.lng ?? 0) - (ignitionCell.lng ?? 0);
    const dy = (cell.lat ?? 0) - (ignitionCell.lat ?? 0);
    const distanceDegrees = Math.hypot(dx, dy);
    
    // ~111,000 meters per degree latitude
    const distanceM = distanceDegrees * 111000;

    // Vector angle from ignition point to cell
    const cellAngleRad = Math.atan2(dx, dy); // angle in radians

    // Dot product to find wind alignment (1 = inline with wind, -1 = headwind)
    const travelX = Math.sin(cellAngleRad);
    const travelY = Math.cos(cellAngleRad);
    const windAlignment = travelX * windX + travelY * windY;

    // ── Spread Rate Formulas (inspired by FireSenseNet & FireCast parameters) ──
    // Base rate driven by combustibility fuel proxy (canopy density and NDVI moisture)
    const baseRate = 8.0 + cell.ips * 20.0; // meters per minute

    // Wind contribution: speeds up spread in downwind direction, slows upwind
    const windRate = windSpeedMph * 0.6 * windAlignment;

    // Slope contribution: fire spreads faster uphill
    // If the slope vector goes up in the direction of travel, speed increases.
    // Approximate that traveling away from ignition is uphill for positive slopes
    const slopeRate = cell.slope * 0.5;

    // Final front velocity (meters / minute), minimum 1.5m/min so fire eventually spreads
    const velocity = Math.max(1.5, baseRate + windRate + slopeRate);

    // Arrival time in minutes
    const arrivalTimeMin = distanceM / velocity;

    const isOnFire = simTimeMin >= arrivalTimeMin;

    // Calculate burn intensity (grows over time once fire arrives, clamps to 1)
    let burnIntensity = 0;
    if (isOnFire) {
      const timeOnFire = simTimeMin - arrivalTimeMin;
      burnIntensity = Math.min(1.0, 0.2 + timeOnFire * 0.08);
    }

    result[cell.id] = {
      cellId: cell.id,
      isOnFire,
      arrivalTimeMin,
      burnIntensity,
    };
  });

  return result;
}
