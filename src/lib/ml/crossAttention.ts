/**
 * FireSenseNet-600M — Multi-Head Cross-Attention Between Fire Cells
 * ──────────────────────────────────────────────────────────────────────────────
 * Each hex cell queries its neighbours (and optionally all cells) to capture:
 *   • Short-range: fire corridor dependencies between adjacent cells
 *   • Long-range:  wind-aligned jump corridors across distant cells
 *
 * Mechanism — Scaled Dot-Product Cross-Attention  (Vaswani et al. 2017):
 *
 *   Q = H_i  W_Q          (query from current cell i)
 *   K = H_j  W_K          (keys  from neighbour / all cells j)
 *   V = H_j  W_V          (values from neighbour / all cells j)
 *
 *   head_h(i) = softmax( Q_h K_h^T / sqrt(d_k) + M_ij ) · V_h
 *
 *   M_ij = spatial bias: log(1 + wind_alignment) for downwind cells
 *                        –inf for cells outside neighbourhood mask (local mode)
 *
 *   CrossAttn(H) = Concat[head_1,...,head_H] W_O
 *
 * Full-Scale Spec (FireSenseNet-600M):
 *   d_model             = 1024
 *   n_heads             = 16   (d_head = 64)
 *   d_ff                = 4096
 *   N_CROSSATTN_LAYERS  = 12
 *   Parameters:         ~201 M
 *
 * Two attention modes:
 *   'local'  — attend only within H3 ring-1 (fast, O(N·k))
 *   'global' — full N×N attention (captures long-range fire corridors)
 */

import {
  Tensor, matmul, add, scale, transpose,
  layerNorm, softmax, gelu,
  linearParamCount, lnParamCount,
} from './tensor';
import type { HexGraph } from './fireGNN';
import { STGNN_CONFIG } from './fireGNN';

// ── Architecture constants ────────────────────────────────────────────────────

const LITE = true;

export const CROSSATTN_CONFIG = {
  D_MODEL_FULL:   1024,
  D_MODEL_LITE:   128,
  D_FF_FULL:      4096,
  D_FF_LITE:      512,
  N_HEADS_FULL:   16,
  N_HEADS_LITE:   4,
  N_LAYERS_FULL:  12,
  N_LAYERS_LITE:  2,
} as const;

const D  = LITE ? CROSSATTN_CONFIG.D_MODEL_LITE  : CROSSATTN_CONFIG.D_MODEL_FULL;
const DFF= LITE ? CROSSATTN_CONFIG.D_FF_LITE      : CROSSATTN_CONFIG.D_FF_FULL;
const NH = LITE ? CROSSATTN_CONFIG.N_HEADS_LITE   : CROSSATTN_CONFIG.N_HEADS_FULL;
const NL = LITE ? CROSSATTN_CONFIG.N_LAYERS_LITE  : CROSSATTN_CONFIG.N_LAYERS_FULL;
const DH = D / NH;

// ── Weight structures ─────────────────────────────────────────────────────────

export interface CrossAttentionLayerWeights {
  // Cross-attention projections [D, D]
  wQ: Tensor; bQ: Tensor;
  wK: Tensor; bK: Tensor;
  wV: Tensor; bV: Tensor;
  wO: Tensor; bO: Tensor;
  // Post-attention FFN [D, DFF] / [DFF, D]
  ffnW1: Tensor; ffnB1: Tensor;
  ffnW2: Tensor; ffnB2: Tensor;
  // LayerNorms
  ln1G: Tensor; ln1B: Tensor;
  ln2G: Tensor; ln2B: Tensor;
}

function makeCrossAttnLayerWeights(): CrossAttentionLayerWeights {
  return {
    wQ: Tensor.xavierUniform(D, D), bQ: Tensor.zeroBias(D),
    wK: Tensor.xavierUniform(D, D), bK: Tensor.zeroBias(D),
    wV: Tensor.xavierUniform(D, D), bV: Tensor.zeroBias(D),
    wO: Tensor.xavierUniform(D, D), bO: Tensor.zeroBias(D),
    ffnW1: Tensor.kaimingUniform(D, DFF), ffnB1: Tensor.zeroBias(DFF),
    ffnW2: Tensor.kaimingUniform(DFF, D), ffnB2: Tensor.zeroBias(D),
    ln1G: Tensor.lnGamma(D), ln1B: Tensor.lnBeta(D),
    ln2G: Tensor.lnGamma(D), ln2B: Tensor.lnBeta(D),
  };
}

export interface CrossAttentionWeights {
  layers: CrossAttentionLayerWeights[];
}

export function initCrossAttentionWeights(): CrossAttentionWeights {
  return { layers: Array.from({ length: NL }, makeCrossAttnLayerWeights) };
}

// ── Spatial bias matrix ───────────────────────────────────────────────────────

/**
 * Build [N, N] additive attention bias matrix:
 *   M_ij = +log(1 + windAlign)   if i and j are neighbours and aligned with wind
 *   M_ij = 0                     if neighbours but no wind alignment
 *   M_ij = -1e9                  if not in neighbourhood (local mode)
 *
 * This encoding lets the model learn to prioritise downwind fire corridors.
 */
function buildSpatialBias(
  n: number,
  graph: HexGraph,
  mode: 'local' | 'global',
): Tensor {
  const bias = Tensor.zeros(n, n);

  if (mode === 'local') {
    // Mask non-neighbours with –∞
    bias.data.fill(-1e9);
    for (let i = 0; i < n; i++) {
      bias.set(i, i, 0); // self always visible
      for (const j of graph.adjList[i]) bias.set(i, j, 0);
    }
  }

  // Add wind-alignment signal on edges
  for (const edge of graph.edges) {
    const existing = bias.get(edge.src, edge.dst);
    if (existing > -1e8) { // not masked
      const windBias = Math.log(1 + Math.max(0, edge.windAlign));
      bias.set(edge.src, edge.dst, existing + windBias);
    }
  }

  return bias;
}

// ── Single-head cross-attention with spatial bias ─────────────────────────────

function singleHeadAttn(
  Q: Tensor,    // [N, DH]
  K: Tensor,    // [N, DH]
  V: Tensor,    // [N, DH]
  bias: Tensor, // [N, N]
): { output: Tensor; weights: Tensor } {
  // scores [N, N]
  const rawScores = scale(matmul(Q, transpose(K)), 1 / Math.sqrt(DH));

  // Add spatial bias
  const biasedScores = Tensor.zeros(rawScores.rows, rawScores.cols);
  for (let i = 0; i < rawScores.rows; i++)
    for (let j = 0; j < rawScores.cols; j++)
      biasedScores.set(i, j, rawScores.get(i, j) + bias.get(i, j));

  const weights = softmax(biasedScores);
  const output  = matmul(weights, V);
  return { output, weights };
}

// ── Multi-head cross-attention ────────────────────────────────────────────────

export interface CrossAttentionResult {
  embeddings: Tensor;          // [N, D] refined embeddings
  attentionWeights: number[][]; // [N, N] averaged across heads and layers
}

function multiHeadCrossAttnLayer(
  H: Tensor,
  bias: Tensor,
  w: CrossAttentionLayerWeights,
): { out: Tensor; avgWeights: Tensor } {
  const N = H.rows;

  const Q = add(matmul(H, w.wQ), w.bQ); // [N, D]
  const K = add(matmul(H, w.wK), w.bK);
  const V = add(matmul(H, w.wV), w.bV);

  const headOutputs: Tensor[] = [];
  let accWeights = Tensor.zeros(N, N);

  for (let h = 0; h < NH; h++) {
    const s = h * DH;
    // Slice head dimension
    const Qh = Tensor.zeros(N, DH);
    const Kh = Tensor.zeros(N, DH);
    const Vh = Tensor.zeros(N, DH);
    for (let i = 0; i < N; i++)
      for (let d = 0; d < DH; d++) {
        Qh.set(i, d, Q.get(i, s + d));
        Kh.set(i, d, K.get(i, s + d));
        Vh.set(i, d, V.get(i, s + d));
      }

    const { output, weights } = singleHeadAttn(Qh, Kh, Vh, bias);
    headOutputs.push(output);

    // Accumulate weights for visualisation
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        accWeights.set(i, j, accWeights.get(i, j) + weights.get(i, j) / NH);
  }

  // Concat heads → [N, D] then project through W_O
  const concat = Tensor.zeros(N, D);
  headOutputs.forEach((ho, h) => {
    for (let i = 0; i < N; i++)
      for (let d = 0; d < DH; d++)
        concat.set(i, h * DH + d, ho.get(i, d));
  });

  const out = add(matmul(concat, w.wO), w.bO);
  return { out, avgWeights: accWeights };
}

// ── Cross-attention block (attn + FFN + residuals) ───────────────────────────

function crossAttentionBlock(
  H: Tensor,
  bias: Tensor,
  w: CrossAttentionLayerWeights,
): { H_out: Tensor; avgWeights: Tensor } {
  // Pre-LN attention
  const H_norm1 = layerNorm(H, w.ln1G, w.ln1B);
  const { out: attnOut, avgWeights } = multiHeadCrossAttnLayer(H_norm1, bias, w);
  const H_attn = add(H, attnOut); // residual

  // Pre-LN FFN
  const H_norm2 = layerNorm(H_attn, w.ln2G, w.ln2B);
  const ffnHidden = gelu(add(matmul(H_norm2, w.ffnW1), w.ffnB1));
  const ffnOut    = add(matmul(ffnHidden, w.ffnW2), w.ffnB2);
  const H_out     = add(H_attn, ffnOut); // residual

  return { H_out, avgWeights };
}

// ── Public forward pass ───────────────────────────────────────────────────────

/**
 * Apply N_LAYERS stacked cross-attention blocks to GNN embeddings.
 *
 * @param embeddings  [N, D] node embeddings from ST-GNN
 * @param graph       HexGraph for spatial bias construction
 * @param weights     Initialised cross-attention weight set
 * @param mode        'local' = neighbour-masked, 'global' = full N×N
 */
export function applyFireCrossAttention(
  embeddings: Tensor,
  graph: HexGraph,
  weights: CrossAttentionWeights,
  mode: 'local' | 'global' = 'local',
): CrossAttentionResult {
  const N = embeddings.rows;
  const spatialBias = buildSpatialBias(N, graph, mode);

  let H = embeddings.clone();
  let lastWeights = Tensor.zeros(N, N);

  for (let l = 0; l < NL; l++) {
    const { H_out, avgWeights } = crossAttentionBlock(H, spatialBias, weights.layers[l]);
    H = H_out;
    lastWeights = avgWeights;
  }

  return {
    embeddings: H,
    attentionWeights: lastWeights.toRows(),
  };
}

// ── Parameter count (full 600M scale) ────────────────────────────────────────

export function crossAttnParamCount(): { perLayer: number; total: number } {
  const D_F  = CROSSATTN_CONFIG.D_MODEL_FULL;
  const D_FF = CROSSATTN_CONFIG.D_FF_FULL;
  const NL_F = CROSSATTN_CONFIG.N_LAYERS_FULL;

  const attnParams = 4 * linearParamCount(D_F, D_F);   // Q K V O
  const ffnParams  = linearParamCount(D_F, D_FF) + linearParamCount(D_FF, D_F);
  const lnParams   = 2 * lnParamCount(D_F);

  const perLayer = attnParams + ffnParams + lnParams;
  return { perLayer, total: perLayer * NL_F };
}
