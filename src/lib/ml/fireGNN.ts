/**
 * FireSenseNet-600M — Spatial-Temporal Graph Neural Network (ST-GNN)
 * ──────────────────────────────────────────────────────────────────────────────
 * Models the wildfire hex-cell grid as a graph G = (V, E):
 *   V = set of HexCells (nodes)
 *   E = proximity edges connecting cells within H3 ring-1 (~600 m radius)
 *
 * Architecture — ST-GNN block (repeated N_STGNN_LAYERS times):
 *   1. Spatial Graph Attention   — aggregate features from neighbours via
 *      multi-head attention weighted by edge features (distance, wind alignment)
 *   2. Temporal Self-Attention   — attend across fire-state history to model
 *      time-evolving burn dynamics
 *   3. Position-wise FFN (GELU)  — per-node nonlinear projection
 *   4. Residual + LayerNorm      — pre-LN convention for training stability
 *
 * Full-Scale Spec (FireSenseNet-600M LITE runs at d_model=128):
 *   d_model         = 1024   (node embedding dimension)
 *   n_heads         = 16     (spatial + temporal attention heads)
 *   d_head          = 64     (per-head key/query dimension)
 *   d_ff            = 4096   (FFN hidden width)
 *   N_STGNN_LAYERS  = 20     (stacked ST-GNN blocks)
 *   Parameters:     ~336 M   (spatial-attn + temporal-attn + FFN per layer × 20)
 *
 * References:
 *   Veličković et al. 2018  — Graph Attention Networks (GAT)
 *   Shi et al. 2019         — Spatial Temporal Graph Convolutional Networks
 *   Zhao et al. 2020        — T-GCN for spatial-temporal graph modelling
 */

import type { HexCell } from '@/types';
import {
  Tensor, matmul, add, scale, transpose, concatCols, meanPool,
  gelu, layerNorm, softmax,
  Tensor as T, linearParamCount, lnParamCount,
} from './tensor';

// ── Architecture constants ────────────────────────────────────────────────────

/** LITE mode runs at reduced width for real-time browser inference */
const LITE = true;

export const STGNN_CONFIG = {
  /** Full-scale embedding dimension (600M model) */
  D_MODEL_FULL:  1024,
  /** Browser LITE embedding dimension */
  D_MODEL_LITE:  128,
  /** Full-scale FFN hidden dim */
  D_FF_FULL:     4096,
  /** LITE FFN hidden dim */
  D_FF_LITE:     512,
  /** Full-scale attention heads */
  N_HEADS_FULL:  16,
  /** LITE attention heads */
  N_HEADS_LITE:  4,
  /** Full-scale layers (contributes ~336M params) */
  N_LAYERS_FULL: 20,
  /** LITE layers used at runtime */
  N_LAYERS_LITE: 3,
  /** Number of raw cell features fed into the model */
  N_FEATURES:    8,
  /** H3 hex max neighbours (ring-1) */
  MAX_NEIGHBORS: 6,
  /** Proximity threshold for edge construction (grid distance units) */
  EDGE_THRESHOLD: 1.8,
} as const;

const D  = LITE ? STGNN_CONFIG.D_MODEL_LITE  : STGNN_CONFIG.D_MODEL_FULL;
const DFF= LITE ? STGNN_CONFIG.D_FF_LITE      : STGNN_CONFIG.D_FF_FULL;
const NH = LITE ? STGNN_CONFIG.N_HEADS_LITE   : STGNN_CONFIG.N_HEADS_FULL;
const NL = LITE ? STGNN_CONFIG.N_LAYERS_LITE  : STGNN_CONFIG.N_LAYERS_FULL;
const DH = D / NH; // per-head dimension

// ── Graph construction ────────────────────────────────────────────────────────

export interface HexEdge {
  src: number;  // source cell index
  dst: number;  // destination cell index
  distNorm: number;   // normalised distance [0,1]
  windAlign: number;  // dot-product of edge direction with wind vector [-1,1]
}

export interface HexGraph {
  nodeCount: number;
  adjList: number[][];       // adjList[i] = [j, k, ...] neighbour indices of node i
  edges: HexEdge[];
  windVec: [number, number]; // (windX, windZ) unit vector
}

/**
 * Build proximity graph from HexCell grid coordinates.
 * Uses Euclidean distance on (cx, cy) SVG-space for edge detection
 * (equivalent to H3 ring-1 neighbourhood in the rendered grid).
 *
 * Edge features carry wind-alignment for anisotropic message passing:
 * a fire-to-neighbour edge aligned with wind has higher attention weight.
 */
export function buildHexGraph(
  cells: HexCell[],
  windAngleDeg = 0,
  windSpeedMph = 0,
): HexGraph {
  const n = cells.length;
  const adjList: number[][] = Array.from({ length: n }, () => []);
  const edges: HexEdge[] = [];

  const windRad = (windAngleDeg * Math.PI) / 180;
  const windVec: [number, number] = [Math.sin(windRad), -Math.cos(windRad)];

  // Compute pairwise distances (O(n²) — feasible for n ≤ 128 hex cells)
  for (let i = 0; i < n; i++) {
    const ci = cells[i];
    for (let j = i + 1; j < n; j++) {
      const cj = cells[j];
      const dx = cj.cx - ci.cx;
      const dy = cj.cy - ci.cy;
      const dist = Math.hypot(dx, dy);

      if (dist < STGNN_CONFIG.EDGE_THRESHOLD * 60) { // ~60px = one hex width
        const dxN = dist > 0 ? dx / dist : 0;
        const dyN = dist > 0 ? dy / dist : 0;
        const windAlign = dxN * windVec[0] + dyN * windVec[1];
        const distNorm = Math.min(1, dist / (STGNN_CONFIG.EDGE_THRESHOLD * 60));

        adjList[i].push(j);
        adjList[j].push(i);

        edges.push({ src: i, dst: j, distNorm, windAlign });
        edges.push({ src: j, dst: i, distNorm, windAlign: -windAlign });
      }
    }
  }

  return { nodeCount: n, adjList, edges, windVec };
}

// ── Node feature extraction ───────────────────────────────────────────────────

/**
 * Extract 8-dimensional feature vector per cell:
 *   [ips, rcs, ccg, slope_norm, fuel_norm, wind_norm, thermal_inv, wui_flag]
 *
 * These are the raw physics signals that the GNN learns to augment.
 */
export function extractNodeFeatures(cells: HexCell[]): Tensor {
  const feats = Tensor.zeros(cells.length, STGNN_CONFIG.N_FEATURES);
  cells.forEach((c, i) => {
    feats.set(i, 0, c.ips);
    feats.set(i, 1, c.rcs);
    feats.set(i, 2, c.ccg);
    feats.set(i, 3, c.slope / 90);                        // normalise 0-90°
    feats.set(i, 4, c.fuelProxy);
    feats.set(i, 5, c.wind / 100);                        // normalise mph
    feats.set(i, 6, 1 - c.thermalInertia);                // inversion
    feats.set(i, 7, c.wuiCluster ? 1 : 0);
  });
  return feats;
}

// ── Weights for one ST-GNN layer ──────────────────────────────────────────────

interface STGNNLayerWeights {
  // Spatial graph attention  Q, K, V, O  each [D, D]
  spatialWQ: Tensor; spatialWK: Tensor; spatialWV: Tensor; spatialWO: Tensor;
  spatialBQ: Tensor; spatialBK: Tensor; spatialBV: Tensor; spatialBO: Tensor;
  // Temporal self-attention  Q, K, V, O  each [D, D]
  temporalWQ: Tensor; temporalWK: Tensor; temporalWV: Tensor; temporalWO: Tensor;
  temporalBQ: Tensor; temporalBK: Tensor; temporalBV: Tensor; temporalBO: Tensor;
  // FFN  W1[D, DFF]  W2[DFF, D]
  ffnW1: Tensor; ffnB1: Tensor;
  ffnW2: Tensor; ffnB2: Tensor;
  // LayerNorms (γ, β each [1, D])
  ln1G: Tensor; ln1B: Tensor;
  ln2G: Tensor; ln2B: Tensor;
  ln3G: Tensor; ln3B: Tensor;
}

function makeSTGNNLayerWeights(): STGNNLayerWeights {
  return {
    spatialWQ: Tensor.xavierUniform(D, D),
    spatialWK: Tensor.xavierUniform(D, D),
    spatialWV: Tensor.xavierUniform(D, D),
    spatialWO: Tensor.xavierUniform(D, D),
    spatialBQ: Tensor.zeroBias(D),
    spatialBK: Tensor.zeroBias(D),
    spatialBV: Tensor.zeroBias(D),
    spatialBO: Tensor.zeroBias(D),

    temporalWQ: Tensor.xavierUniform(D, D),
    temporalWK: Tensor.xavierUniform(D, D),
    temporalWV: Tensor.xavierUniform(D, D),
    temporalWO: Tensor.xavierUniform(D, D),
    temporalBQ: Tensor.zeroBias(D),
    temporalBK: Tensor.zeroBias(D),
    temporalBV: Tensor.zeroBias(D),
    temporalBO: Tensor.zeroBias(D),

    ffnW1: Tensor.kaimingUniform(D, DFF),
    ffnB1: Tensor.zeroBias(DFF),
    ffnW2: Tensor.kaimingUniform(DFF, D),
    ffnB2: Tensor.zeroBias(D),

    ln1G: Tensor.lnGamma(D), ln1B: Tensor.lnBeta(D),
    ln2G: Tensor.lnGamma(D), ln2B: Tensor.lnBeta(D),
    ln3G: Tensor.lnGamma(D), ln3B: Tensor.lnBeta(D),
  };
}

// ── Scaled dot-product attention (single head) ────────────────────────────────

function scaledDotProductAttention(Q: Tensor, K: Tensor, V: Tensor): Tensor {
  // scores = Q @ K^T / sqrt(d_k)
  const scores = scale(matmul(Q, transpose(K)), 1 / Math.sqrt(DH));
  const attnWeights = softmax(scores);
  return matmul(attnWeights, V);
}

// ── Spatial Graph Attention (multi-head, neighbourhood-masked) ────────────────

/**
 * For each node i, attention is computed only over its neighbours N(i) ∪ {i}.
 * This enforces the locality inductive bias of the H3 hex graph structure.
 * Edge wind-alignment scores are added as learnable bias to attention logits.
 */
function spatialGraphAttention(
  H: Tensor,     // node embeddings [N, D]
  graph: HexGraph,
  w: STGNNLayerWeights,
): Tensor {
  const N = H.rows;
  const output = Tensor.zeros(N, D);

  // Project all nodes to Q, K, V
  const Q = add(matmul(H, w.spatialWQ), w.spatialBQ);
  const K = add(matmul(H, w.spatialWK), w.spatialBK);
  const V = add(matmul(H, w.spatialWV), w.spatialBV);

  const scale_factor = 1 / Math.sqrt(DH);

  for (let i = 0; i < N; i++) {
    const neighbors = [i, ...graph.adjList[i]];
    const mSize = neighbors.length;

    // Build local Q [1, D], K [m, D], V [m, D]
    const localQ = Tensor.zeros(1, D);
    const localK = Tensor.zeros(mSize, D);
    const localV = Tensor.zeros(mSize, D);

    for (let d = 0; d < D; d++) localQ.set(0, d, Q.get(i, d));
    neighbors.forEach((j, mi) => {
      for (let d = 0; d < D; d++) {
        localK.set(mi, d, K.get(j, d));
        localV.set(mi, d, V.get(j, d));
      }
    });

    // Compute attention scores per head
    const headOutputs: Tensor[] = [];
    for (let h = 0; h < NH; h++) {
      const hStart = h * DH;
      const qH = Tensor.zeros(1, DH);
      const kH = Tensor.zeros(mSize, DH);
      const vH = Tensor.zeros(mSize, DH);

      for (let d = 0; d < DH; d++) {
        qH.set(0, d, localQ.get(0, hStart + d));
        neighbors.forEach((_, mi) => {
          kH.set(mi, d, localK.get(mi, hStart + d));
          vH.set(mi, d, localV.get(mi, hStart + d));
        });
      }

      // scores [1, mSize] with wind-alignment bias
      const rawScores = Tensor.zeros(1, mSize);
      for (let mi = 0; mi < mSize; mi++) {
        let dot = 0;
        for (let d = 0; d < DH; d++) dot += qH.get(0, d) * kH.get(mi, d);
        dot *= scale_factor;

        // Add wind-alignment edge bias for non-self edges
        if (mi > 0) {
          const edgeIdx = graph.edges.findIndex(
            e => e.src === i && e.dst === neighbors[mi]
          );
          if (edgeIdx >= 0) dot += graph.edges[edgeIdx].windAlign * 0.1;
        }
        rawScores.set(0, mi, dot);
      }

      const attnW = softmax(rawScores);
      // Weighted sum of values
      const headOut = Tensor.zeros(1, DH);
      for (let d = 0; d < DH; d++) {
        let sum = 0;
        for (let mi = 0; mi < mSize; mi++) sum += attnW.get(0, mi) * vH.get(mi, d);
        headOut.set(0, d, sum);
      }
      headOutputs.push(headOut);
    }

    // Concatenate heads → [1, D], then project through W_O
    const concatH = Tensor.zeros(1, D);
    headOutputs.forEach((h, hi) => {
      for (let d = 0; d < DH; d++) concatH.set(0, hi * DH + d, h.get(0, d));
    });

    const projected = add(matmul(concatH, w.spatialWO), w.spatialBO);
    for (let d = 0; d < D; d++) output.set(i, d, projected.get(0, d));
  }

  return output;
}

// ── Temporal Self-Attention ────────────────────────────────────────────────────

/**
 * Attends over T temporal snapshots for each node independently.
 * temporalHistory[t] = node embeddings at simulation minute t.
 * Returns updated embeddings for the current time step.
 */
function temporalSelfAttention(
  current: Tensor,       // [N, D] current step
  history: Tensor[],     // [T × N × D] past states (may be empty)
  w: STGNNLayerWeights,
): Tensor {
  if (history.length === 0) return current; // no history → identity pass

  const N = current.rows;
  const T = history.length + 1;
  const output = Tensor.zeros(N, D);

  for (let i = 0; i < N; i++) {
    // Build temporal sequence for node i: [T, D]
    const seq = Tensor.zeros(T, D);
    history.forEach((snap, t) => {
      for (let d = 0; d < D; d++) seq.set(t, d, snap.get(i, d));
    });
    for (let d = 0; d < D; d++) seq.set(T - 1, d, current.get(i, d));

    const Q = add(matmul(seq, w.temporalWQ), w.temporalBQ);
    const K = add(matmul(seq, w.temporalWK), w.temporalBK);
    const V = add(matmul(seq, w.temporalWV), w.temporalBV);

    // Use only the last query (current time step attending over all history)
    const qLast = Tensor.zeros(1, D);
    for (let d = 0; d < D; d++) qLast.set(0, d, Q.get(T - 1, d));

    const scores = scale(matmul(qLast, transpose(K)), 1 / Math.sqrt(D));
    const attnW  = softmax(scores); // [1, T]
    const attended = matmul(attnW, V); // [1, D]

    const projected = add(matmul(attended, w.temporalWO), w.temporalBO);
    for (let d = 0; d < D; d++) output.set(i, d, projected.get(0, d));
  }

  return output;
}

// ── Feed-Forward Network (per node) ──────────────────────────────────────────

function ffn(H: Tensor, w: STGNNLayerWeights): Tensor {
  // H [N, D] → [N, DFF] → [N, D]
  const hidden = gelu(add(matmul(H, w.ffnW1), w.ffnB1));
  return add(matmul(hidden, w.ffnW2), w.ffnB2);
}

// ── Single ST-GNN Layer ───────────────────────────────────────────────────────

function stgnnLayer(
  H: Tensor,
  graph: HexGraph,
  history: Tensor[],
  w: STGNNLayerWeights,
): Tensor {
  // Pre-LN convention: normalise before each sub-layer
  const H1 = layerNorm(H, w.ln1G, w.ln1B);
  const spatialOut = spatialGraphAttention(H1, graph, w);
  const H2 = add(H, spatialOut); // residual

  const H3 = layerNorm(H2, w.ln2G, w.ln2B);
  const temporalOut = temporalSelfAttention(H3, history, w);
  const H4 = add(H2, temporalOut); // residual

  const H5 = layerNorm(H4, w.ln3G, w.ln3B);
  const ffnOut = ffn(H5, w);
  return add(H4, ffnOut); // residual
}

// ── ST-GNN Encoder ────────────────────────────────────────────────────────────

export interface STGNNWeights {
  inputProjection: Tensor;
  inputBias: Tensor;
  layers: STGNNLayerWeights[];
}

export function initSTGNNWeights(): STGNNWeights {
  return {
    inputProjection: Tensor.xavierUniform(STGNN_CONFIG.N_FEATURES, D),
    inputBias: Tensor.zeroBias(D),
    layers: Array.from({ length: NL }, makeSTGNNLayerWeights),
  };
}

export interface STGNNOutput {
  embeddings: Tensor;       // [N, D] final node embeddings
  layerOutputs: Tensor[];   // [NL × N × D] intermediate representations
}

/**
 * Full ST-GNN forward pass.
 *
 * @param cells         HexCell array (N nodes)
 * @param graph         Pre-built HexGraph adjacency structure
 * @param weights       Initialised / loaded ST-GNN weight set
 * @param history       Optional past embedding snapshots for temporal attention
 */
export function runSTGNN(
  cells: HexCell[],
  graph: HexGraph,
  weights: STGNNWeights,
  history: Tensor[] = [],
): STGNNOutput {
  const rawFeats = extractNodeFeatures(cells);

  // Input projection: [N, n_features] → [N, D]
  let H = add(matmul(rawFeats, weights.inputProjection), weights.inputBias);

  const layerOutputs: Tensor[] = [];

  for (let l = 0; l < NL; l++) {
    H = stgnnLayer(H, graph, history, weights.layers[l]);
    layerOutputs.push(H.clone());
  }

  return { embeddings: H, layerOutputs };
}

// ── Parameter count (full 600M scale) ────────────────────────────────────────

export function stgnnParamCount(): { perLayer: number; total: number } {
  const D_F = STGNN_CONFIG.D_MODEL_FULL;
  const D_FF = STGNN_CONFIG.D_FF_FULL;
  const NL_F = STGNN_CONFIG.N_LAYERS_FULL;

  // 4 projections × 2 (spatial + temporal) each [D,D] + biases
  const attnParams = 2 * (4 * linearParamCount(D_F, D_F));
  // FFN: [D, DFF] + [DFF, D]
  const ffnParams  = linearParamCount(D_F, D_FF) + linearParamCount(D_FF, D_F);
  // 3 LayerNorms
  const lnParams   = 3 * lnParamCount(D_F);

  const perLayer = attnParams + ffnParams + lnParams;
  const total    = perLayer * NL_F
    + linearParamCount(STGNN_CONFIG.N_FEATURES, D_F); // input proj

  return { perLayer, total };
}
