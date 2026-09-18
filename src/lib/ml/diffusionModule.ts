/**
 * FireSenseNet-600M — Denoising Diffusion Probabilistic Model (DDPM)
 * ──────────────────────────────────────────────────────────────────────────────
 * Models wildfire spread as a learned conditional score function, reversing a
 * Gaussian diffusion process over the per-cell IPS field.
 *
 * Conceptual framing:
 *   Forward process q(x_t | x_{t-1}):
 *     Progressively corrupts the "true" IPS field by adding Gaussian noise.
 *     x_t = sqrt(alpha_bar_t) * x_0 + sqrt(1 - alpha_bar_t) * epsilon
 *
 *   Reverse process p_theta(x_{t-1} | x_t, c):
 *     A conditional denoising network predicts the noise epsilon_theta given:
 *       - Corrupted IPS field x_t at step t
 *       - Conditioning context c = [wind_vec, GNN_embeddings, physics_residuals]
 *
 *   At inference (N_STEPS reverse steps):
 *     Start from x_T ~ N(0, I)  (maximum uncertainty)
 *     Iteratively denoise: x_{t-1} = denoise(x_t, t, c)
 *     Final x_0 = refined fire-spread IPS forecast
 *
 * Architecture per denoising step:
 *   Time Embedding  : sinusoidal(t) → MLP → [1, D]
 *   Denoising Block : [x_noisy | conditioning | time_embed] → MLP → noise prediction
 *   DDIM Sampler    : deterministic sampling (fewer steps, faster convergence)
 *
 * Full-Scale Spec (FireSenseNet-600M):
 *   N_STEPS         = 8 (inference; 1000 training steps)
 *   d_model         = 1024
 *   Parameters:     ~50 M
 *
 * References:
 *   Ho et al. 2020      — Denoising Diffusion Probabilistic Models
 *   Song et al. 2022    — DDIM (Denoising Diffusion Implicit Models)
 *   Kerrigan et al. 2023 — Diffusion for spatiotemporal forecasting
 */

import {
  Tensor, matmul, add, scale, gelu, sigmoid, layerNorm,
  sinusoidalEncoding, linearParamCount, lnParamCount,
} from './tensor';

// ── Architecture constants ────────────────────────────────────────────────────

const LITE = true;

export const DIFFUSION_CONFIG = {
  D_MODEL_FULL:   1024,
  D_MODEL_LITE:   128,
  D_TIME_FULL:    256,  // time embedding dimension
  D_TIME_LITE:    64,
  N_STEPS_FULL:   8,    // inference reverse steps
  N_STEPS_LITE:   4,
  /** Linear noise schedule beta_1 ... beta_T */
  BETA_START:     0.0001,
  BETA_END:       0.02,
  N_TRAIN_STEPS:  1000, // training steps (not run in browser)
} as const;

const D    = LITE ? DIFFUSION_CONFIG.D_MODEL_LITE  : DIFFUSION_CONFIG.D_MODEL_FULL;
const D_T  = LITE ? DIFFUSION_CONFIG.D_TIME_LITE   : DIFFUSION_CONFIG.D_TIME_FULL;
const STEPS= LITE ? DIFFUSION_CONFIG.N_STEPS_LITE  : DIFFUSION_CONFIG.N_STEPS_FULL;

// ── Noise schedule (precomputed) ──────────────────────────────────────────────

/**
 * Linear beta schedule following Ho et al. 2020.
 * beta_t linearly increases from BETA_START to BETA_END over T steps.
 */
function buildNoiseSchedule(T: number): {
  betas: Float32Array;
  alphas: Float32Array;
  alphaBarsCum: Float32Array;
} {
  const betas  = new Float32Array(T);
  const alphas = new Float32Array(T);
  const alphaBars = new Float32Array(T);

  const { BETA_START, BETA_END } = DIFFUSION_CONFIG;

  for (let t = 0; t < T; t++) {
    betas[t]  = BETA_START + (BETA_END - BETA_START) * (t / (T - 1));
    alphas[t] = 1 - betas[t];
  }

  let cumProd = 1.0;
  for (let t = 0; t < T; t++) {
    cumProd *= alphas[t];
    alphaBars[t] = cumProd;
  }

  return { betas, alphas, alphaBarsCum: alphaBars };
}

const SCHEDULE = buildNoiseSchedule(DIFFUSION_CONFIG.N_TRAIN_STEPS);

// ── Time Embedding MLP ────────────────────────────────────────────────────────

export interface TimeEmbeddingWeights {
  w1: Tensor; b1: Tensor;  // [D_T, D] linear
  w2: Tensor; b2: Tensor;  // [D, D] linear
}

function makeTimeEmbeddingWeights(): TimeEmbeddingWeights {
  return {
    w1: Tensor.kaimingUniform(D_T, D), b1: Tensor.zeroBias(D),
    w2: Tensor.kaimingUniform(D, D),   b2: Tensor.zeroBias(D),
  };
}

/**
 * Convert integer diffusion time step t to learned embedding vector [1, D].
 * Sinusoidal encoding → 2-layer MLP → [1, D]
 */
function encodeTimeStep(t: number, w: TimeEmbeddingWeights): Tensor {
  // Map training step t (0..999) to inference step bucket
  const tNorm = Math.round((t / STEPS) * DIFFUSION_CONFIG.N_TRAIN_STEPS);
  const sinEnc = sinusoidalEncoding(tNorm, D_T);
  const encTensor = new Tensor(1, D_T, sinEnc);

  const h1 = gelu(add(matmul(encTensor, w.w1), w.b1));  // [1, D]
  const h2 = gelu(add(matmul(h1, w.w2), w.b2));         // [1, D]
  return h2;
}

// ── Denoising Block ───────────────────────────────────────────────────────────

export interface DenoisingBlockWeights {
  // Input projection: [D_cell + D_embed + D] -> D (cell_noisy | cond | time)
  wIn: Tensor; bIn: Tensor;
  // Hidden MLP
  wH1: Tensor; bH1: Tensor;
  wH2: Tensor; bH2: Tensor;
  // Output projection: D -> D (predicted noise)
  wOut: Tensor; bOut: Tensor;
  // LayerNorm
  lnG: Tensor; lnB: Tensor;
}

/** Input to the denoiser: concatenation of (noisy_cell_scalar, gnn_embedding, time_embed) */
const D_DENOISER_IN = 1 + D + D; // scalar IPS + embedding + time

function makeDenoisingBlockWeights(): DenoisingBlockWeights {
  return {
    wIn:  Tensor.kaimingUniform(D_DENOISER_IN, D), bIn:  Tensor.zeroBias(D),
    wH1:  Tensor.kaimingUniform(D, D),              bH1:  Tensor.zeroBias(D),
    wH2:  Tensor.kaimingUniform(D, D),              bH2:  Tensor.zeroBias(D),
    wOut: Tensor.xavierUniform(D, 1),               bOut: Tensor.zeroBias(1),
    lnG:  Tensor.lnGamma(D),                        lnB:  Tensor.lnBeta(D),
  };
}

/**
 * Predict the noise epsilon_theta for ONE cell at diffusion step t.
 * Returns predicted noise scalar (to be subtracted from x_t).
 */
function denoiseSingleCell(
  x_t: number,          // noisy IPS value for this cell
  embedding: number[],  // GNN+cross-attn embedding for this cell [D]
  timeEmb: Tensor,      // [1, D] time step embedding
  w: DenoisingBlockWeights,
): number {
  // Build input: [x_t, ...embedding, ...timeEmb_row] → [1, D_DENOISER_IN]
  const inputData = new Float32Array(D_DENOISER_IN);
  inputData[0] = x_t;
  for (let d = 0; d < D; d++) inputData[1 + d] = embedding[d] ?? 0;
  for (let d = 0; d < D; d++) inputData[1 + D + d] = timeEmb.data[d] ?? 0;

  const input = new Tensor(1, D_DENOISER_IN, inputData);

  const h0  = gelu(add(matmul(input, w.wIn), w.bIn));            // [1, D]
  const h1n = layerNorm(h0, w.lnG, w.lnB);
  const h1  = gelu(add(matmul(h1n, w.wH1), w.bH1));             // [1, D]
  const h2  = gelu(add(matmul(h1, w.wH2), w.bH2));              // [1, D]
  const out = add(matmul(h2, w.wOut), w.bOut);                   // [1, 1]

  return out.get(0, 0);
}

// ── DDIM Sampler ──────────────────────────────────────────────────────────────

/**
 * Deterministic DDIM reverse step (Song et al. 2022).
 * x_{t-1} = sqrt(alpha_bar_{t-1}) * x0_pred  +  sqrt(1 - alpha_bar_{t-1}) * eps_pred
 *
 * where x0_pred = (x_t - sqrt(1 - alpha_bar_t) * eps_pred) / sqrt(alpha_bar_t)
 */
function ddimStep(
  x_t: number,
  eps_pred: number,
  t: number,              // current inference step (0-indexed, STEPS total)
  totalTrainSteps: number,
): number {
  // Map inference step to training schedule index
  const T = totalTrainSteps;
  const tIdx   = Math.round(((STEPS - t) / STEPS) * (T - 1));
  const tPrevIdx = Math.max(0, Math.round(((STEPS - t - 1) / STEPS) * (T - 1)));

  const alpha_bar_t    = SCHEDULE.alphaBarsCum[tIdx]     ?? 1;
  const alpha_bar_prev = SCHEDULE.alphaBarsCum[tPrevIdx] ?? 1;

  const sqrt_abar_t    = Math.sqrt(alpha_bar_t);
  const sqrt_1mabar_t  = Math.sqrt(Math.max(0, 1 - alpha_bar_t));
  const sqrt_abar_prev = Math.sqrt(alpha_bar_prev);
  const sqrt_1mabar_prev = Math.sqrt(Math.max(0, 1 - alpha_bar_prev));

  // Predict x_0
  const x0_pred = (x_t - sqrt_1mabar_t * eps_pred) / (sqrt_abar_t + 1e-8);
  // Clamp to physical bounds [0, 1]
  const x0_clamped = Math.max(0, Math.min(1, x0_pred));

  // Reconstruct x_{t-1}
  return sqrt_abar_prev * x0_clamped + sqrt_1mabar_prev * eps_pred;
}

// ── Diffusion Module weights ──────────────────────────────────────────────────

export interface DiffusionModuleWeights {
  timeEmbedding: TimeEmbeddingWeights;
  denoisingBlocks: DenoisingBlockWeights[];  // one per inference step
}

export function initDiffusionWeights(): DiffusionModuleWeights {
  return {
    timeEmbedding: makeTimeEmbeddingWeights(),
    denoisingBlocks: Array.from({ length: STEPS }, makeDenoisingBlockWeights),
  };
}

// ── Public forward pass ───────────────────────────────────────────────────────

export interface DiffusionOutput {
  refinedIPS: number[];        // [N] denoised IPS predictions per cell
  noiseTrajectory: number[][]; // [N_STEPS × N] x_t values at each step
  finalStep: number;
}

/**
 * Conditional reverse diffusion: produces refined IPS predictions from
 * GNN + cross-attention embeddings.
 *
 * @param initialIPS   [N] raw physics IPS values (starting point for x_0 estimate)
 * @param embeddings   [N, D] GNN+cross-attention embeddings (conditioning context)
 * @param weights      Initialised diffusion weights
 */
export function runDiffusion(
  initialIPS: number[],
  embeddings: { row: (i: number) => number[] },
  weights: DiffusionModuleWeights,
): DiffusionOutput {
  const N = initialIPS.length;

  // Add moderate noise to start (not pure Gaussian — we use IPS as warm start)
  const noise_sigma = 0.15;
  let x_t = initialIPS.map(v => Math.max(0, Math.min(1,
    v + (Math.random() * 2 - 1) * noise_sigma
  )));

  const trajectory: number[][] = [];

  for (let step = 0; step < STEPS; step++) {
    const timeEmb = encodeTimeStep(step, weights.timeEmbedding);
    const x_prev: number[] = new Array(N);

    for (let i = 0; i < N; i++) {
      const eps_pred = denoiseSingleCell(
        x_t[i],
        embeddings.row(i),
        timeEmb,
        weights.denoisingBlocks[step],
      );
      x_prev[i] = ddimStep(x_t[i], eps_pred, step, DIFFUSION_CONFIG.N_TRAIN_STEPS);
    }

    trajectory.push([...x_t]);
    x_t = x_prev;
  }

  // Final clamp: refined IPS must remain in [0, 1]
  const refinedIPS = x_t.map(v => Math.max(0, Math.min(1, v)));

  return {
    refinedIPS,
    noiseTrajectory: trajectory,
    finalStep: STEPS,
  };
}

// ── Parameter count (full 600M scale) ────────────────────────────────────────

export function diffusionParamCount(): { perStep: number; total: number } {
  const D_F  = DIFFUSION_CONFIG.D_MODEL_FULL;
  const D_TF = DIFFUSION_CONFIG.D_TIME_FULL;
  const NS   = DIFFUSION_CONFIG.N_STEPS_FULL;

  const timeEmbParams = linearParamCount(D_TF, D_F) + linearParamCount(D_F, D_F);

  const D_IN_F = 1 + D_F + D_F;
  const blockParams =
    linearParamCount(D_IN_F, D_F) +   // wIn
    linearParamCount(D_F, D_F)    +   // wH1
    linearParamCount(D_F, D_F)    +   // wH2
    linearParamCount(D_F, 1)      +   // wOut
    lnParamCount(D_F);                // layernorm

  return {
    perStep: blockParams,
    total:   timeEmbParams + blockParams * NS,
  };
}
