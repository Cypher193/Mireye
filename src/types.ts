// ── Core domain types ─────────────────────────────────────────────────────

export interface HexCell {
  id: string;
  row: number;
  col: number;
  cx: number;
  cy: number;
  vertices: string;
  ips: number;
  rcs: number;
  ccg: number;
  fuelProxy: number;
  slope: number;
  wind: number;
  thermalInertia: number;
  driveTimeMin: number;
  staffedStations: number;
  housingUnits: number;
  wuiCluster: boolean;
  riskLabel: 'Low' | 'Moderate' | 'High' | 'Severe';
  state?: string;
  county?: string;
  region?: string;
  // Real API metadata (populated when data comes from Mireye)
  lat?: number;
  lng?: number;
  nearestStationName?: string;
  nearestStationSource?: 'api' | 'fallback';
  nearestStationLat?: number;
  nearestStationLng?: number;
  mireyeLatencyMs?: number;
}

export interface County {
  id: string;
  name: string;
  state: string;
  hexCount: number;
  population: number;
  wuiHousingUnits: number;
  fireDistricts: number;
  staffedStations: number;
  cx?: number;
  cy?: number;
  cityName?: string;
  // Real geocoded lat/lng (populated from Mireye /v1/geocode)
  lat?: number;
  lng?: number;
}

export interface ReasoningLine {
  text: string;
  type: 'command' | 'result' | 'info' | 'warn';
  delay: number;
}

export interface CapitalBriefResult {
  hexId: string;
  countyName: string;
  ccgScore: number;
  ips: number;
  rcs: number;
  housingUnits: number;
  driveTimeMin: number;
  paragraphs: string[];
}

// ── Mireye API types ───────────────────────────────────────────────────────

/**
 * Raw field shape returned by Mireye /v1/fetch with wildfire_underwrite preset.
 */
export interface MireyeWildfireFields {
  slope_degrees: number;
  tree_canopy_pct: number;
  ndvi_current: number;
  ndvi_change_5y: number;
  lcms_class: string;  // e.g. 'Trees', 'Shrubs', 'Barren or Impervious', 'Water'
  elevation: number;
}

/**
 * USFA fire station record with geocoded coordinates.
 */
export interface StationRecord {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  staffed: boolean;
  type: 'career' | 'volunteer' | 'combination';
}

/**
 * API loading status across the application.
 */
export type ApiStatus = 'idle' | 'loading' | 'error' | 'ok';

// ── FireSenseNet-600M ML Output Types ─────────────────────────────────────────

/**
 * PINNs loss breakdown from the Rothermel advection-diffusion PDE constraint.
 * ∂I/∂t + v⃗·∇I = α∇²I + S(fuel, slope)
 */
export interface PINNsLossResult {
  /** PDE residual: how well predictions satisfy Rothermel advection-diffusion */
  pdeLoss:          number;
  /** Boundary condition penalty: predictions outside [0,1] */
  boundaryLoss:     number;
  /** Initial condition: IPS at ignition cell = 1.0 */
  initialCondLoss:  number;
  /** Fuel conservation: Σfuel monotonically decreasing */
  conservationLoss: number;
  /** Data fidelity: MSE vs Rothermel physics IPS */
  dataFidelityLoss: number;
  /** Total weighted PINNs loss */
  totalLoss:        number;
  /** Per-cell PDE residuals for spatial visualisation */
  cellResiduals:    number[];
}

/**
 * Full output of the FireSenseNet-600M forward pass.
 * Returned by FireSenseNet.forward(cells, windAngleDeg, windSpeedMph).
 */
export interface ModelOutput {
  /** ML-enhanced IPS per cell [N], refined by GNN + attention + diffusion */
  enhancedIPS:      number[];
  /** Cross-attention weight matrix [N × N] — shows inter-cell attention */
  attentionWeights: number[][];
  /** Full PINNs physics loss decomposition */
  pinnsLoss:        PINNsLossResult;
  /** Raw GNN node embeddings [N × d_model_lite] for debugging */
  gnnEmbeddings:    number[][];
  /** Number of diffusion denoising steps completed */
  diffusionSteps:   number;
  /** ASCII model card string from getModelSummary() */
  modelSummary:     string;
}
