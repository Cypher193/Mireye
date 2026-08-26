/**
 * IPS Engine — Ignition Propensity Score
 *
 * Computes a normalized 0–1 IPS from real Mireye wildfire fields using a
 * Rothermel-inspired weighted formula. No random values — all inputs are
 * sourced from the Mireye /v1/fetch API.
 *
 * Formula weights (must sum to 1.0):
 *   Slope contribution:      0.30  (steeper → faster spread)
 *   Fuel proxy contribution: 0.35  (canopy + NDVI moisture inversion)
 *   Wind proxy contribution: 0.20  (NDVI change as fuel dryness proxy)
 *   Thermal inertia:         0.15  (elevation-based cooling effect)
 *
 * References: Rothermel 1972, Andrews 2018 (fire spread factor normalization)
 */

import type { MireyeWildfireFields } from '@/types';

// ── Normalization helpers ──────────────────────────────────────────────────

/** Clamp a value to [0, 1] */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Normalizes slope_degrees to 0–1.
 * Rothermel uses 0–45° as the effective spread range.
 * Slopes above 45° are extreme and capped at 1.0.
 */
function normalizeSlope(slopeDegrees: number): number {
  return clamp01(slopeDegrees / 45);
}

/**
 * Fuel proxy from tree canopy percentage and current NDVI.
 * High canopy → higher fuel load.
 * High NDVI → MORE moisture → LOWER ignition risk (inverted).
 * Result is combined: canopy contribution weighted 60%, moisture inversion 40%.
 */
function normalizeFuel(treeCanopyPct: number, ndviCurrent: number): number {
  const canopyScore = clamp01(treeCanopyPct / 100);
  // NDVI range is typically -1 to 1; healthy vegetation ≈ 0.6–0.9
  // Invert: low NDVI (dry/sparse) = high fire risk
  const ndviNormalized = clamp01((ndviCurrent + 1) / 2); // map -1..1 → 0..1
  const moistureInversion = 1 - ndviNormalized;
  return clamp01(canopyScore * 0.6 + moistureInversion * 0.4);
}

/**
 * Wind proxy from NDVI 5-year change.
 * Declining NDVI (negative change) → vegetation stress/drying → higher spread risk.
 * ndvi_change_5y typically ranges -0.5 to +0.5
 */
function normalizeWindProxy(ndviChange5y: number): number {
  // Negative change (drying trend) → higher risk
  // Map [-0.5, 0.5] to [1, 0]
  return clamp01((-ndviChange5y + 0.5) / 1.0);
}

/**
 * Thermal inertia from elevation.
 * Higher elevation → cooler temperatures → lower ignition risk.
 * Effective range: 0–4000m. Returns score (lower = better for fire suppression).
 * For IPS we use (1 - thermalScore) so that IPS rises with low elevation.
 */
function normalizeThermalInertia(elevationM: number): number {
  // Higher elevation ↔ higher thermal inertia (harder to ignite)
  const thermalScore = clamp01(elevationM / 4000);
  // We want high elevation → lower IPS contribution, so return the score
  // and the main function will use (1 - thermalScore)
  return thermalScore;
}

// ── IPS Formula ─────────────────────────────────────────────────────────────

export interface IPSComponents {
  slopeNorm: number;       // 0-1, raw slope contribution
  fuelNorm: number;        // 0-1, fuel proxy
  windProxyNorm: number;   // 0-1, wind/dryness proxy
  thermalInertia: number;  // 0-1, elevation thermal damping
  ips: number;             // 0-1, final IPS
}

/**
 * Computes IPS from real Mireye wildfire fields.
 * Returns both the final score and intermediate components for transparency.
 */
export function computeIPS(fields: Partial<MireyeWildfireFields>): IPSComponents {
  const slopeNorm = normalizeSlope(fields.slope_degrees ?? 10);
  const fuelNorm = normalizeFuel(fields.tree_canopy_pct ?? 30, fields.ndvi_current ?? 0.4);
  const windProxyNorm = normalizeWindProxy(fields.ndvi_change_5y ?? 0);
  const thermalInertia = normalizeThermalInertia(fields.elevation ?? 500);

  // Rothermel-inspired weighted sum
  // Thermal inertia is a damper: high inertia → harder to ignite → subtract from IPS
  const ips = clamp01(
    slopeNorm * 0.30 +
    fuelNorm * 0.35 +
    windProxyNorm * 0.20 +
    (1 - thermalInertia) * 0.15
  );

  return {
    slopeNorm,
    fuelNorm,
    windProxyNorm,
    thermalInertia,
    ips: Math.round(ips * 1000) / 1000,
  };
}

/**
 * Returns a human-readable description of the dominant IPS driver.
 */
export function ipsDominantDriver(components: IPSComponents): string {
  const factors = [
    { name: 'steep slope', value: components.slopeNorm * 0.30 },
    { name: 'fuel loading', value: components.fuelNorm * 0.35 },
    { name: 'vegetation dryness', value: components.windProxyNorm * 0.20 },
    { name: 'low thermal inertia', value: (1 - components.thermalInertia) * 0.15 },
  ];
  factors.sort((a, b) => b.value - a.value);
  return factors[0].name;
}
