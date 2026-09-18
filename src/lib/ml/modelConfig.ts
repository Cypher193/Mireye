/**
 * FireSenseNet-600M — Model Configuration
 * ──────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL hyperparameters across the FireSenseNet-600M
 * architecture.  Every module (fireGNN, crossAttention, diffusionModule,
 * pinnsLoss, fireSenseNet) derives its constants from this file.
 *
 * NOTE: Trained model weights are NOT stored in this repository.
 *       See do_not_push_model_weights.onnx for the weight-exclusion notice.
 *       Weights must be loaded from a secure model registry at inference time.
 *
 * Config sections:
 *   MODEL_VERSION    — versioning and registry metadata
 *   ARCHITECTURE     — layer counts, dimensions, heads (full-scale & LITE)
 *   TRAINING         — optimizer, scheduler, loss weights, batch config
 *   DATA             — feature schema, normalisation stats, augmentation
 *   INFERENCE        — runtime flags, quantisation, ONNX export spec
 *   PINNS            — PDE physics constants and loss weight schedule
 *   ONNX_EXPORT      — operator set, input/output tensor spec for ONNX runtime
 */

// ── Model Version & Registry ──────────────────────────────────────────────────

export const MODEL_VERSION = {
  name:          'FireSenseNet',
  version:       '1.0.0-600M',
  variant:       '600M',                    // parameter scale tag
  architecture:  'ST-GNN + CrossAttn + DDPM + PINNs',
  checkpoint:    'firesensenet_600m_v1.onnx',
  registry:      'https://registry.mireye.com/models/firesensenet',
  releaseDate:   '2026-09-18',
  license:       'Proprietary — Mireye CCG Engine',
  authors:       ['Mireye AI Research'],
  description:   'Real-time wildfire spread prediction using Spatial-Temporal GNN, ' +
                 'multi-head cross-attention, diffusion-based IPS refinement, and ' +
                 'Rothermel PDE-constrained PINNs loss.',
} as const;

// ── Architecture Hyperparameters ──────────────────────────────────────────────

export const ARCHITECTURE_CONFIG = {
  // ── Shared across all sub-modules ──────────────────────────────────────────
  /**
   * Whether to run in LITE mode (browser-compatible reduced dimensions).
   * Set to false for GPU server inference with full 600M params.
   */
  LITE_MODE: true as boolean,

  // ── Input feature schema ────────────────────────────────────────────────────
  INPUT: {
    N_FEATURES:        8,          // raw features per cell fed to input projection
    FEATURE_NAMES:     [
      'ips',           // Rothermel IPS (0-1)
      'rcs',           // Response Capacity Score (0-1)
      'ccg',           // Coverage-Combustibility Gap (0-1)
      'slope_norm',    // slope_degrees / 90 (0-1)
      'fuel_proxy',    // canopy + NDVI moisture inversion (0-1)
      'wind_norm',     // wind speed / 100 mph (0-1)
      'thermal_inv',   // 1 - thermalInertia (0-1)
      'wui_flag',      // WUI cluster boolean → 0|1
    ] as const,
    /** H3 resolution of the hex grid (res 7 ≈ 600m edge length) */
    H3_RESOLUTION:     7,
    MAX_CELLS:         128,        // maximum grid size for LITE mode
    MAX_CELLS_FULL:    4096,       // maximum grid size for full-scale GPU inference
  },

  // ── Full-scale (600M) dimensions ────────────────────────────────────────────
  FULL: {
    D_MODEL:           1024,       // node embedding dimension
    D_FF:              4096,       // FFN hidden width (4× d_model)
    D_HEAD:            64,         // per attention head dimension
    N_HEADS_SPATIAL:   16,         // spatial graph attention heads
    N_HEADS_TEMPORAL:  8,          // temporal self-attention heads
    N_HEADS_CROSS:     16,         // cross-attention heads
    D_TIME_EMBED:      256,        // diffusion time step embedding dim
    D_DECODER:         512,        // decoder MLP hidden dim

    // Layer counts
    N_STGNN_LAYERS:    20,         // ST-GNN encoder blocks  (~336M params)
    N_CROSSATTN_LAYERS:12,         // Cross-attention blocks (~201M params)
    N_DIFFUSION_STEPS: 8,          // DDIM inference reverse steps (~50M params)
    N_DIFFUSION_TRAIN: 1000,       // DDPM training forward steps

    // Graph
    MAX_NEIGHBORS:     6,          // H3 ring-1 hex max neighbours
    EDGE_THRESHOLD_M:  600,        // edge connection threshold [metres]

    PARAM_COUNT_M:     590,        // approximate total parameters (millions)
  },

  // ── LITE mode (browser, ~5.65M) ─────────────────────────────────────────────
  LITE: {
    D_MODEL:           128,
    D_FF:              512,
    D_HEAD:            32,
    N_HEADS_SPATIAL:   4,
    N_HEADS_TEMPORAL:  4,
    N_HEADS_CROSS:     4,
    D_TIME_EMBED:      64,
    D_DECODER:         64,

    N_STGNN_LAYERS:    3,
    N_CROSSATTN_LAYERS:2,
    N_DIFFUSION_STEPS: 4,
    N_DIFFUSION_TRAIN: 1000,

    MAX_NEIGHBORS:     6,
    EDGE_THRESHOLD_M:  600,

    PARAM_COUNT_M:     5.65,
  },
} as const;

// ── Training Configuration ────────────────────────────────────────────────────

export const TRAINING_CONFIG = {
  // ── Optimiser ────────────────────────────────────────────────────────────────
  OPTIMIZER: {
    type:            'AdamW',
    lr:              1e-4,           // initial learning rate
    lr_min:          1e-6,           // cosine annealing minimum
    weight_decay:    0.01,
    beta1:           0.9,
    beta2:           0.999,
    epsilon:         1e-8,
    gradient_clip:   1.0,            // global gradient norm clipping
  },

  // ── Learning rate schedule ────────────────────────────────────────────────
  SCHEDULER: {
    type:            'CosineAnnealingWithWarmup',
    warmup_steps:    2000,
    total_steps:     200_000,
    decay_factor:    0.1,
  },

  // ── Batch & epoch config ──────────────────────────────────────────────────
  BATCH: {
    batch_size:      32,             // counties per batch
    grad_accum_steps:4,              // effective batch = 128 counties
    epochs:          50,
    early_stopping_patience: 5,
    val_split:       0.15,
    test_split:      0.10,
  },

  // ── Regularisation ────────────────────────────────────────────────────────
  REGULARISATION: {
    dropout:         0.1,
    stochastic_depth:0.05,           // layer drop probability (deep network)
    label_smoothing: 0.05,
  },

  // ── Mixed precision ───────────────────────────────────────────────────────
  PRECISION: {
    dtype:           'float32' as 'float32' | 'float16' | 'bfloat16',
    amp_enabled:     false,          // Automatic Mixed Precision (GPU only)
  },

  // ── Loss weight schedule ──────────────────────────────────────────────────
  /** PINNs loss weights — ramped up after warmup to avoid early instability */
  LOSS_WEIGHTS: {
    // Step 0–2000 (warmup): data fidelity only
    WARMUP: {
      pde:          0.0,
      boundary:     0.5,
      initial:      0.5,
      conservation: 0.0,
      data_fidelity:1.0,
    },
    // Step 2000+ (main training): full physics enforcement
    MAIN: {
      pde:          1.0,
      boundary:     2.0,
      initial:      1.5,
      conservation: 0.5,
      data_fidelity:1.0,
    },
    /** Diffusion denoising MSE weight */
    diffusion_mse:  1.0,
    /** GNN embedding auxiliary contrastive loss weight */
    gnn_contrastive:0.1,
  },
} as const;

// ── Data & Pre-processing Configuration ──────────────────────────────────────

export const DATA_CONFIG = {
  // ── Feature normalisation statistics (pre-computed from training set) ──────
  // Values are (mean, std) for z-score normalisation
  FEATURE_STATS: {
    ips:           { mean: 0.382, std: 0.187 },
    rcs:           { mean: 0.541, std: 0.213 },
    ccg:           { mean: 0.198, std: 0.154 },
    slope_norm:    { mean: 0.142, std: 0.118 },
    fuel_proxy:    { mean: 0.468, std: 0.201 },
    wind_norm:     { mean: 0.127, std: 0.094 },
    thermal_inv:   { mean: 0.614, std: 0.229 },
    wui_flag:      { mean: 0.433, std: 0.495 },
  },

  // ── Augmentation (training only) ──────────────────────────────────────────
  AUGMENTATION: {
    enabled:             true,
    wind_angle_jitter:   15,      // ±15° random wind rotation
    ips_noise_sigma:     0.02,    // Gaussian noise added to IPS
    grid_flip_prob:      0.5,     // random horizontal flip of hex grid
    dropout_cell_prob:   0.05,    // randomly mask 5% of cells (robustness)
  },

  // ── Temporal sequence config ───────────────────────────────────────────────
  TEMPORAL: {
    history_steps:       3,       // past snapshots fed to temporal attention
    step_interval_min:   5,       // minutes between snapshots
    max_sim_duration_min:120,     // maximum simulation window
  },

  // ── Data sources ──────────────────────────────────────────────────────────
  SOURCES: {
    primary:   'Mireye Earth API /v1/fetch/batch',
    weather:   'Open-Meteo /v1/forecast',
    stations:  'USFA Registry + Mireye /v1/proximity',
    elevation: 'USGS 3DEP Digital Elevation Model',
    vegetation:'Sentinel-2 / Landsat-8 NDVI',
  },
} as const;

// ── Inference Configuration ───────────────────────────────────────────────────

export const INFERENCE_CONFIG = {
  // ── Runtime mode ──────────────────────────────────────────────────────────
  RUNTIME: {
    /** Maximum latency budget for browser LITE inference [ms] */
    MAX_LATENCY_MS:         200,
    /** Maximum cells for real-time inference */
    MAX_CELLS_REALTIME:     64,
    /** Cross-attention mode: 'local' for speed, 'global' for accuracy */
    DEFAULT_ATTN_MODE:      'local' as 'local' | 'global',
    /** ML/Rothermel blend weight α (40% ML, 60% physics) */
    ML_BLEND_ALPHA:         0.4,
    /** Temporal history buffer size */
    TEMPORAL_HISTORY_SIZE:  3,
  },

  // ── ONNX Runtime config (full-scale server inference) ─────────────────────
  ONNX: {
    opset_version:          17,
    input_names:            ['cell_features', 'adjacency_mask', 'wind_vector', 'time_step'],
    output_names:           ['enhanced_ips', 'attention_weights', 'pinns_residuals'],
    dynamic_axes: {
      cell_features:        { 0: 'batch', 1: 'n_cells' },
      adjacency_mask:       { 1: 'n_cells', 2: 'n_cells' },
      enhanced_ips:         { 0: 'batch', 1: 'n_cells' },
      attention_weights:    { 0: 'batch', 1: 'n_cells', 2: 'n_cells' },
    },
    /** Execution providers in priority order */
    execution_providers:    ['DmlExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider'],
    /** Enable graph optimisation */
    graph_optimisation:     true,
    /** INT8 quantisation for edge deployment */
    quantisation:           'none' as 'none' | 'int8' | 'fp16',
  },

  // ── Checkpoint loading ────────────────────────────────────────────────────
  CHECKPOINT: {
    /**
     * Weight file intentionally excluded from repository.
     * See do_not_push_model_weights.onnx for the exclusion notice.
     * Load from registry before inference:
     *   fetch(`${MODEL_VERSION.registry}/firesensenet_600m_v1.onnx`)
     */
    filename:               'firesensenet_600m_v1.onnx',
    sha256:                 'WEIGHTS_NOT_IN_REPO__LOAD_FROM_REGISTRY',
    size_gb:                2.4,     // float32: 600M × 4 bytes
    size_gb_fp16:           1.2,     // float16 quantised variant
    size_gb_int8:           0.6,     // int8 quantised variant
  },
} as const;

// ── PINNs Physics Constants ───────────────────────────────────────────────────

export const PINNS_CONFIG = {
  PDE: {
    /** Thermal diffusivity α [m²/min] — dry forest litter */
    alpha_diffusivity:      0.08,
    /** Minimum spread velocity [m/min] */
    v_min:                  1.5,
    /** Wind advection scale factor */
    wind_scale:             0.6,
    /** H3 res-7 hex edge ≈ cell spacing Δx [m] */
    delta_x:                600.0,
    /** Temporal finite difference Δt [min] */
    delta_t:                1.0,
    /** Rothermel R_max at IPS=1 [m/min] */
    r_max:                  28.0,
  },

  LOSS_WEIGHTS: {
    pde:          1.0,
    boundary:     2.0,
    initial:      1.5,
    conservation: 0.5,
    data_fidelity:1.0,
  },

  /** Compliance thresholds for reporting */
  COMPLIANCE: {
    GOOD:         0.05,   // total loss < 0.05 → ✅ physics compliant
    MODERATE:     0.20,   // total loss < 0.20 → ⚠️ moderate deviation
    // above 0.20 → ❌ physics violation
  },
} as const;

// ── Diffusion Noise Schedule ──────────────────────────────────────────────────

export const DIFFUSION_SCHEDULE_CONFIG = {
  type:           'linear' as 'linear' | 'cosine',
  beta_start:     0.0001,
  beta_end:       0.02,
  n_train_steps:  1000,
  n_infer_steps:  {
    full:         8,
    lite:         4,
  },
  sampler:        'DDIM' as 'DDPM' | 'DDIM',
  /** DDIM eta = 0 → fully deterministic sampling */
  ddim_eta:       0.0,
} as const;

// ── GNN Graph Config ──────────────────────────────────────────────────────────

export const GRAPH_CONFIG = {
  /** H3 ring-1 maximum neighbours */
  max_neighbors:      6,
  /** Edge creation distance threshold (multiples of hex width) */
  edge_threshold:     1.8,
  /** Wind-alignment edge bias scale */
  wind_bias_scale:    0.10,
  /** Number of message passing rounds per ST-GNN layer */
  message_passes:     1,
  /** Aggregation: 'mean' | 'max' | 'sum' */
  aggregation:        'mean' as 'mean' | 'max' | 'sum',
  /** Whether to include self-loops in adjacency */
  self_loops:         true,
} as const;

// ── Cross-Attention Config ────────────────────────────────────────────────────

export const CROSS_ATTN_CONFIG = {
  /** Default scope for attention in browser mode */
  default_mode:       'local' as 'local' | 'global',
  /** Log-wind-alignment spatial bias coefficient */
  spatial_bias_scale: 1.0,
  /** Attention dropout (training only) */
  attn_dropout:       0.1,
  /** Pre-LN vs Post-LN convention */
  norm_convention:    'pre' as 'pre' | 'post',
} as const;

// ── Composed full config object ───────────────────────────────────────────────

export const FIRESENSENET_CONFIG = {
  version:    MODEL_VERSION,
  arch:       ARCHITECTURE_CONFIG,
  training:   TRAINING_CONFIG,
  data:       DATA_CONFIG,
  inference:  INFERENCE_CONFIG,
  pinns:      PINNS_CONFIG,
  diffusion:  DIFFUSION_SCHEDULE_CONFIG,
  graph:      GRAPH_CONFIG,
  crossAttn:  CROSS_ATTN_CONFIG,
} as const;

export type FireSenseNetConfig = typeof FIRESENSENET_CONFIG;

/**
 * Returns a human-readable config summary for logging / debugging.
 */
export function getConfigSummary(): string {
  const a = ARCHITECTURE_CONFIG;
  const mode = a.LITE_MODE ? 'LITE' : 'FULL';
  const dim  = a.LITE_MODE ? a.LITE : a.FULL;
  return [
    `FireSenseNet-${a.FULL.PARAM_COUNT_M}M  [Mode: ${mode}]`,
    `  d_model        : ${dim.D_MODEL}`,
    `  d_ff           : ${dim.D_FF}`,
    `  attn_heads     : ${dim.N_HEADS_SPATIAL} spatial + ${dim.N_HEADS_TEMPORAL} temporal + ${dim.N_HEADS_CROSS} cross`,
    `  ST-GNN layers  : ${dim.N_STGNN_LAYERS}`,
    `  Cross-attn     : ${dim.N_CROSSATTN_LAYERS} blocks`,
    `  Diffusion steps: ${dim.N_DIFFUSION_STEPS} (DDIM)`,
    `  Optimizer      : ${TRAINING_CONFIG.OPTIMIZER.type} lr=${TRAINING_CONFIG.OPTIMIZER.lr}`,
    `  ONNX opset     : ${INFERENCE_CONFIG.ONNX.opset_version}`,
    `  Weights        : ${INFERENCE_CONFIG.CHECKPOINT.filename} (NOT in repo)`,
  ].join('\n');
}
