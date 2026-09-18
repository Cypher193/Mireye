/**
 * FireSenseNet-600M — ML Package Barrel Exports
 *
 * Import from '@/lib/ml' to access the full model stack:
 *
 *   import { getFireSenseNet, computePINNsLoss, FIRESENSENET_CONFIG } from '@/lib/ml';
 */

// Model configuration (single source of truth for all hyperparameters)
export {
  FIRESENSENET_CONFIG,
  MODEL_VERSION,
  ARCHITECTURE_CONFIG,
  TRAINING_CONFIG,
  DATA_CONFIG,
  INFERENCE_CONFIG,
  PINNS_CONFIG,
  DIFFUSION_SCHEDULE_CONFIG,
  GRAPH_CONFIG,
  CROSS_ATTN_CONFIG,
  getConfigSummary,
} from './modelConfig';
export type { FireSenseNetConfig } from './modelConfig';

// Tensor primitives
export {
  Tensor,
  matmul, add, scale, transpose, concatCols, meanPool,
  relu, gelu, sigmoid, softmax, layerNorm,
  sinusoidalEncoding, linearParamCount, lnParamCount,
} from './tensor';

// ST-GNN
export {
  buildHexGraph, extractNodeFeatures, runSTGNN, initSTGNNWeights,
  stgnnParamCount, STGNN_CONFIG,
} from './fireGNN';
export type { HexGraph, HexEdge, STGNNOutput, STGNNWeights } from './fireGNN';

// Cross-Attention
export {
  applyFireCrossAttention, initCrossAttentionWeights,
  crossAttnParamCount, CROSSATTN_CONFIG,
} from './crossAttention';
export type { CrossAttentionResult, CrossAttentionWeights } from './crossAttention';

// Diffusion Module
export {
  runDiffusion, initDiffusionWeights, diffusionParamCount, DIFFUSION_CONFIG,
} from './diffusionModule';
export type { DiffusionOutput, DiffusionModuleWeights } from './diffusionModule';

// PINNs Loss
export {
  computePINNsLoss, formatPINNsLossReport,
  PINNS_PHYSICS, PINNS_LOSS_WEIGHTS,
} from './pinnsLoss';
export type { PINNsLossResult } from './pinnsLoss';

// FireSenseNet — top-level model
export { FireSenseNet, getFireSenseNet, resetFireSenseNet } from './fireSenseNet';

// Universal Model Loader (ONNX & custom files)
export { modelLoader } from './modelLoader';
export type { ModelStatus, ModelInferenceResult } from './modelLoader';

