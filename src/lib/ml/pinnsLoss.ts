/**
 * FireSenseNet-600M — Physics-Informed Neural Network (PINNs) Loss Function
 * ──────────────────────────────────────────────────────────────────────────────
 * Enforces that model predictions satisfy the governing physical equations of
 * wildfire spread, preventing the neural components from producing physically
 * impossible fire behaviour.
 *
 * Governed by the Rothermel-inspired fire-spread PDE (advection-diffusion form):
 *
 *   ∂I/∂t  +  v⃗ · ∇I  =  α ∇²I  +  S(x, fuel, slope)       [1]
 *
 * where:
 *   I(x, t)  = Ignition Propensity Score field (0..1)
 *   v⃗        = (v_x, v_z) wind advection velocity [m/min]
 *   α        = thermal diffusivity coefficient [m²/min]
 *   S        = source term = Rothermel reaction intensity × fuel availability
 *
 * Loss decomposition (weighted sum):
 *
 *   L_total = w_pde  · L_pde           (PDE residual on interior cells)
 *           + w_bc   · L_bc            (boundary: IPS ∈ [0,1])
 *           + w_ic   · L_ic            (initial: IPS at ignition cell = 1)
 *           + w_cons · L_conservation  (fuel mass conservation)
 *           + w_data · L_data          (data fidelity vs Rothermel physics IPS)
 *
 * Finite-difference spatial gradient approximation:
 *   ∂I/∂x ≈ (I_right − I_left) / (2Δx)
 *   ∂²I/∂x² ≈ (I_right − 2I_center + I_left) / Δx²
 *
 * References:
 *   Raissi et al. 2019       — Physics-Informed Neural Networks
 *   Karniadakis et al. 2021  — PINNs for physics simulations (Nature Rev. Phys.)
 *   Rothermel 1972           — Fire spread equation
 *   Andrews 2018             — Fuel moisture effects on fire spread rate
 */

import type { HexCell } from '@/types';

// ── PDE constants ─────────────────────────────────────────────────────────────

export const PINNS_PHYSICS = {
  /** Thermal diffusivity [m²/min] — typical dry forest litter */
  ALPHA_DIFFUSIVITY:  0.08,
  /** Minimum fire spread rate [m/min] */
  V_MIN:              1.5,
  /** Wind advection scaling factor */
  WIND_SCALE:         0.6,
  /** Rothermel maximum forward spread [m/min] at IPS=1 */
  R_MAX:              28.0,
  /** Approximate hex-cell spacing [m] used for finite differences */
  DELTA_X:            600.0,  // H3 resolution 7 ≈ 600m edge length
  /** Time step for temporal derivative approximation [min] */
  DELTA_T:            1.0,
} as const;

// ── Loss weights ──────────────────────────────────────────────────────────────

export const PINNS_LOSS_WEIGHTS = {
  PDE:          1.0,
  BOUNDARY:     2.0,  // hard-penalise out-of-bounds predictions
  INITIAL:      1.5,
  CONSERVATION: 0.5,
  DATA_FIDELITY:1.0,
} as const;

// ── Result type ───────────────────────────────────────────────────────────────

export interface PINNsLossResult {
  /** PDE residual: how well predictions satisfy Rothermel advection-diffusion */
  pdeLoss:          number;
  /** Boundary condition: predictions violating [0,1] bounds */
  boundaryLoss:     number;
  /** Initial condition: IPS at ignition cell should be 1.0 */
  initialCondLoss:  number;
  /** Fuel conservation: total fuel monotonically decreasing */
  conservationLoss: number;
  /** Data fidelity: deviation from Rothermel-computed physics IPS */
  dataFidelityLoss: number;
  /** Weighted total loss */
  totalLoss:        number;
  /** Per-cell PDE residuals for visualisation */
  cellResiduals:    number[];
}

// ── Spatial neighbour lookup ──────────────────────────────────────────────────

/**
 * For each cell, find nearest left/right/up/down neighbours by grid position.
 * Returns indices into the cells array (or -1 if no neighbour).
 */
function buildCardinalNeighbours(cells: HexCell[]): {
  left: Int16Array; right: Int16Array;
  up: Int16Array;   down: Int16Array;
} {
  const N = cells.length;
  const left  = new Int16Array(N).fill(-1);
  const right = new Int16Array(N).fill(-1);
  const up    = new Int16Array(N).fill(-1);
  const down  = new Int16Array(N).fill(-1);

  const DX = PINNS_PHYSICS.DELTA_X * 0.8; // tolerance for proximity search

  for (let i = 0; i < N; i++) {
    const ci = cells[i];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const cj = cells[j];
      const dx = (cj.cx - ci.cx);
      const dy = (cj.cy - ci.cy);

      // Cardinal neighbours in grid space
      if (Math.abs(dy) < DX * 0.3) {
        if (dx > 0 && dx < DX && (right[i] < 0 || dx < cells[right[i]].cx - ci.cx))
          right[i] = j;
        if (dx < 0 && dx > -DX && (left[i] < 0 || dx > cells[left[i]].cx - ci.cx))
          left[i] = j;
      }
      if (Math.abs(dx) < DX * 0.3) {
        if (dy > 0 && dy < DX && (down[i] < 0 || dy < cells[down[i]].cy - ci.cy))
          down[i] = j;
        if (dy < 0 && dy > -DX && (up[i] < 0 || dy > cells[up[i]].cy - ci.cy))
          up[i] = j;
      }
    }
  }

  return { left, right, up, down };
}

// ── Rothermel source term ─────────────────────────────────────────────────────

/**
 * Reaction intensity source term S(x) from Rothermel 1972.
 * S = fuel_loading × (1 - moisture_inversion) × slope_factor
 * This drives self-sustaining combustion independent of advection.
 */
function rothermelSource(cell: HexCell): number {
  const fuelLoad    = cell.fuelProxy;                       // 0-1
  const moistureInv = 1 - cell.thermalInertia;              // dry = high
  const slopeFactor = 1 + cell.slope / 45;                  // steeper = faster
  return Math.max(0, Math.min(1, fuelLoad * moistureInv * slopeFactor * 0.3));
}

// ── PDE Residual ─────────────────────────────────────────────────────────────

/**
 * Compute Rothermel PDE residual for cell i:
 *
 *   R_i = dI/dt + v⃗·∇I − α∇²I − S_i
 *
 * Approximations:
 *   dI/dt ≈ (I_pred - I_physics) / Δt
 *   ∇I  via central finite difference with neighbours
 *   ∇²I via 5-point Laplacian stencil
 */
function pdeCellResidual(
  i: number,
  cells: HexCell[],
  predicted: number[],
  windX: number,
  windZ: number,
  neighbours: ReturnType<typeof buildCardinalNeighbours>,
): number {
  const cell = cells[i];
  const I_center = predicted[i];
  const I_physics = cell.ips;  // Rothermel-computed ground truth

  // ── Temporal derivative (forward Euler approximation) ─────────────────────
  const dI_dt = (I_center - I_physics) / PINNS_PHYSICS.DELTA_T;

  // ── Spatial gradients (central difference) ────────────────────────────────
  const l = neighbours.left[i] >= 0  ? predicted[neighbours.left[i]]  : I_center;
  const r = neighbours.right[i] >= 0 ? predicted[neighbours.right[i]] : I_center;
  const u = neighbours.up[i] >= 0    ? predicted[neighbours.up[i]]    : I_center;
  const d = neighbours.down[i] >= 0  ? predicted[neighbours.down[i]]  : I_center;

  const dx = PINNS_PHYSICS.DELTA_X;
  const dI_dx = (r - l) / (2 * dx);
  const dI_dz = (d - u) / (2 * dx);  // y-axis in grid = z in world space

  // ── Laplacian (5-point stencil) ───────────────────────────────────────────
  const laplacian = (r - 2 * I_center + l) / (dx * dx)
                  + (d - 2 * I_center + u) / (dx * dx);

  // ── Advection term ─────────────────────────────────────────────────────────
  // Wind speed in [m/min] from mph
  const vx = windX * cell.wind * PINNS_PHYSICS.WIND_SCALE * 0.0268; // mph→m/min
  const vz = windZ * cell.wind * PINNS_PHYSICS.WIND_SCALE * 0.0268;
  const advection = vx * dI_dx + vz * dI_dz;

  // ── Diffusion term ────────────────────────────────────────────────────────
  const diffusion = PINNS_PHYSICS.ALPHA_DIFFUSIVITY * laplacian;

  // ── Source term ───────────────────────────────────────────────────────────
  const source = rothermelSource(cell);

  // PDE residual: should be 0 if predictions satisfy the physics equation
  return dI_dt + advection - diffusion - source;
}

// ── Boundary Loss ─────────────────────────────────────────────────────────────

/**
 * Hard boundary penalty: predictions must stay in [0, 1].
 * L_bc = mean( max(0, I_pred - 1)² + max(0, -I_pred)² )
 */
function computeBoundaryLoss(predicted: number[]): number {
  const penalties = predicted.map(v => {
    const upper = Math.max(0, v - 1.0);
    const lower = Math.max(0, -v);
    return upper * upper + lower * lower;
  });
  return penalties.reduce((a, b) => a + b, 0) / predicted.length;
}

// ── Initial Condition Loss ────────────────────────────────────────────────────

/**
 * Ignition cell must have predicted IPS = 1.0 (fully ignited).
 * L_ic = (I_pred_ignition - 1)²
 */
function computeInitialCondLoss(
  cells: HexCell[],
  predicted: number[],
  ignitionIdx: number | null,
): number {
  if (ignitionIdx === null || ignitionIdx < 0 || ignitionIdx >= cells.length) {
    return 0;
  }
  const diff = predicted[ignitionIdx] - 1.0;
  return diff * diff;
}

// ── Fuel Conservation Loss ────────────────────────────────────────────────────

/**
 * Physical constraint: total available fuel (fuelProxy) can only decrease over time.
 * Penalises predictions that imply fuel creation.
 *
 * L_cons = mean( max(0, I_pred_i - fuel_i)² )
 * (prediction cannot exceed the cell's fuel load)
 */
function computeConservationLoss(cells: HexCell[], predicted: number[]): number {
  const violations = cells.map((cell, i) => {
    const excess = Math.max(0, predicted[i] - (cell.fuelProxy + 0.1));
    return excess * excess;
  });
  return violations.reduce((a, b) => a + b, 0) / cells.length;
}

// ── Data Fidelity Loss ────────────────────────────────────────────────────────

/**
 * MSE between model-predicted IPS and Rothermel-physics IPS.
 * L_data = mean( (I_pred - I_rothermel)² )
 */
function computeDataFidelityLoss(cells: HexCell[], predicted: number[]): number {
  const mse = cells.reduce((sum, cell, i) => {
    const diff = predicted[i] - cell.ips;
    return sum + diff * diff;
  }, 0);
  return mse / cells.length;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute full PINNs loss for a batch of cell predictions.
 *
 * @param cells         HexCell array with physics ground-truth fields
 * @param predicted     Model-predicted IPS values [N]
 * @param windAngleDeg  Wind direction in degrees (for advection)
 * @param windSpeedMph  Wind speed in mph
 * @param ignitionIdx   Index of the ignition cell (for IC loss), or null
 */
export function computePINNsLoss(
  cells: HexCell[],
  predicted: number[],
  windAngleDeg = 0,
  windSpeedMph = 0,
  ignitionIdx: number | null = null,
): PINNsLossResult {
  const N = cells.length;
  if (N === 0 || predicted.length !== N) {
    return {
      pdeLoss: 0, boundaryLoss: 0, initialCondLoss: 0,
      conservationLoss: 0, dataFidelityLoss: 0, totalLoss: 0,
      cellResiduals: [],
    };
  }

  const windRad = (windAngleDeg * Math.PI) / 180;
  const windX   = Math.sin(windRad);
  const windZ   = -Math.cos(windRad);

  const neighbours = buildCardinalNeighbours(cells);

  // ── PDE residuals ─────────────────────────────────────────────────────────
  const cellResiduals = cells.map((_, i) =>
    pdeCellResidual(i, cells, predicted, windX, windZ, neighbours)
  );
  const pdeLoss = cellResiduals.reduce((s, r) => s + r * r, 0) / N;

  // ── Component losses ──────────────────────────────────────────────────────
  const boundaryLoss     = computeBoundaryLoss(predicted);
  const initialCondLoss  = computeInitialCondLoss(cells, predicted, ignitionIdx);
  const conservationLoss = computeConservationLoss(cells, predicted);
  const dataFidelityLoss = computeDataFidelityLoss(cells, predicted);

  // ── Weighted total ────────────────────────────────────────────────────────
  const W = PINNS_LOSS_WEIGHTS;
  const totalLoss =
    W.PDE          * pdeLoss          +
    W.BOUNDARY     * boundaryLoss     +
    W.INITIAL      * initialCondLoss  +
    W.CONSERVATION * conservationLoss +
    W.DATA_FIDELITY * dataFidelityLoss;

  return {
    pdeLoss:          Math.round(pdeLoss * 1e6) / 1e6,
    boundaryLoss:     Math.round(boundaryLoss * 1e6) / 1e6,
    initialCondLoss:  Math.round(initialCondLoss * 1e6) / 1e6,
    conservationLoss: Math.round(conservationLoss * 1e6) / 1e6,
    dataFidelityLoss: Math.round(dataFidelityLoss * 1e6) / 1e6,
    totalLoss:        Math.round(totalLoss * 1e6) / 1e6,
    cellResiduals,
  };
}

/**
 * Returns a human-readable PINNs loss breakdown string for the AI reasoning trace.
 */
export function formatPINNsLossReport(loss: PINNsLossResult): string {
  const lines = [
    `PINNs Loss Report`,
    `─────────────────────────────────────────`,
    `  PDE Residual (Rothermel adv-diff):  ${loss.pdeLoss.toFixed(6)}`,
    `  Boundary Condition [0,1] penalty:   ${loss.boundaryLoss.toFixed(6)}`,
    `  Initial Condition (ignition cell):  ${loss.initialCondLoss.toFixed(6)}`,
    `  Fuel Conservation constraint:       ${loss.conservationLoss.toFixed(6)}`,
    `  Data Fidelity vs Rothermel IPS:     ${loss.dataFidelityLoss.toFixed(6)}`,
    `─────────────────────────────────────────`,
    `  Total Weighted Loss:                ${loss.totalLoss.toFixed(6)}`,
    `  Physics compliance: ${loss.totalLoss < 0.05 ? '✅ GOOD' : loss.totalLoss < 0.2 ? '⚠️  MODERATE' : '❌ VIOLATION'}`,
  ];
  return lines.join('\n');
}
