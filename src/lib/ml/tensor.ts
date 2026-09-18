/**
 * FireSenseNet-600M — Tensor Primitives
 * ──────────────────────────────────────────────────────────────────────────────
 * Lightweight 2-D tensor operations backing ALL FireSenseNet forward-pass math.
 * Storage is Float32Array for numerical precision and cache efficiency.
 *
 * At full 600M-parameter scale these operations would be dispatched to the
 * WebGPU compute engine (see services/webGpuCompute.ts). In the browser LITE
 * mode (d_model = 128) they run synchronously on the CPU with numerically
 * identical results at lower resolution.
 *
 * References:
 *   Glorot & Bengio 2010  — Xavier initialisation
 *   He et al. 2015        — Kaiming initialisation
 *   Vaswani et al. 2017   — Sinusoidal positional encoding
 */

// ── Tensor class ──────────────────────────────────────────────────────────────

export class Tensor {
  readonly data: Float32Array;
  readonly rows: number;
  readonly cols: number;

  constructor(rows: number, cols: number, data?: Float32Array | number[]) {
    this.rows = rows;
    this.cols = cols;
    if (data) {
      this.data = data instanceof Float32Array ? data : new Float32Array(data);
    } else {
      this.data = new Float32Array(rows * cols);
    }
  }

  get(i: number, j: number): number {
    return this.data[i * this.cols + j];
  }

  set(i: number, j: number, val: number): void {
    this.data[i * this.cols + j] = val;
  }

  clone(): Tensor {
    return new Tensor(this.rows, this.cols, new Float32Array(this.data));
  }

  row(i: number): number[] {
    return Array.from(this.data.slice(i * this.cols, (i + 1) * this.cols));
  }

  static zeros(rows: number, cols: number): Tensor {
    return new Tensor(rows, cols);
  }

  static ones(rows: number, cols: number): Tensor {
    const t = new Tensor(rows, cols);
    t.data.fill(1.0);
    return t;
  }

  /**
   * Xavier/Glorot uniform: W ~ Uniform[-sqrt(6/(fan_in+fan_out)), sqrt(6/(fan_in+fan_out))]
   * Optimal for attention projections.
   */
  static xavierUniform(rows: number, cols: number): Tensor {
    const t = new Tensor(rows, cols);
    const bound = Math.sqrt(6.0 / (rows + cols));
    for (let i = 0; i < t.data.length; i++) {
      t.data[i] = (Math.random() * 2 - 1) * bound;
    }
    return t;
  }

  /**
   * Kaiming He uniform: W ~ Uniform[-sqrt(2/fan_in), sqrt(2/fan_in)]
   * Optimal for ReLU/GELU FFN layers.
   */
  static kaimingUniform(rows: number, cols: number): Tensor {
    const t = new Tensor(rows, cols);
    const bound = Math.sqrt(2.0 / rows);
    for (let i = 0; i < t.data.length; i++) {
      t.data[i] = (Math.random() * 2 - 1) * bound;
    }
    return t;
  }

  static zeroBias(size: number): Tensor { return Tensor.zeros(1, size); }
  static lnGamma(size: number): Tensor  { return Tensor.ones(1, size);  }
  static lnBeta(size: number): Tensor   { return Tensor.zeros(1, size); }

  static fromRows(data: number[][]): Tensor {
    const r = data.length, c = data[0]?.length ?? 0;
    const t = new Tensor(r, c);
    for (let i = 0; i < r; i++)
      for (let j = 0; j < c; j++)
        t.set(i, j, data[i][j] ?? 0);
    return t;
  }

  toRows(): number[][] {
    return Array.from({ length: this.rows }, (_, i) => this.row(i));
  }
}

// ── Linear algebra ────────────────────────────────────────────────────────────

/** Matrix multiply C = A @ B  [M,K] @ [K,N] -> [M,N] */
export function matmul(A: Tensor, B: Tensor): Tensor {
  if (A.cols !== B.rows)
    throw new Error(`matmul shape mismatch: [${A.rows},${A.cols}] @ [${B.rows},${B.cols}]`);
  const C = Tensor.zeros(A.rows, B.cols);
  for (let i = 0; i < A.rows; i++)
    for (let k = 0; k < A.cols; k++) {
      const aik = A.get(i, k);
      if (aik === 0) continue;
      for (let j = 0; j < B.cols; j++)
        C.data[i * C.cols + j] += aik * B.get(k, j);
    }
  return C;
}

/** Element-wise add. B is broadcast along rows when B.rows === 1. */
export function add(A: Tensor, B: Tensor): Tensor {
  const C = A.clone();
  if (B.rows === 1 && A.cols === B.cols) {
    for (let i = 0; i < A.rows; i++)
      for (let j = 0; j < A.cols; j++)
        C.data[i * A.cols + j] += B.data[j];
  } else {
    for (let i = 0; i < Math.min(A.data.length, B.data.length); i++)
      C.data[i] += B.data[i];
  }
  return C;
}

export function scale(A: Tensor, s: number): Tensor {
  const C = A.clone();
  for (let i = 0; i < C.data.length; i++) C.data[i] *= s;
  return C;
}

export function transpose(A: Tensor): Tensor {
  const B = Tensor.zeros(A.cols, A.rows);
  for (let i = 0; i < A.rows; i++)
    for (let j = 0; j < A.cols; j++)
      B.set(j, i, A.get(i, j));
  return B;
}

/** Column-wise concatenation [A | B] — same row count required */
export function concatCols(A: Tensor, B: Tensor): Tensor {
  if (A.rows !== B.rows) throw new Error(`concatCols row mismatch: ${A.rows} vs ${B.rows}`);
  const C = Tensor.zeros(A.rows, A.cols + B.cols);
  for (let i = 0; i < A.rows; i++) {
    for (let j = 0; j < A.cols; j++) C.set(i, j, A.get(i, j));
    for (let j = 0; j < B.cols; j++) C.set(i, A.cols + j, B.get(i, j));
  }
  return C;
}

/** Mean-pool rows into [1, cols] */
export function meanPool(A: Tensor): Tensor {
  const out = Tensor.zeros(1, A.cols);
  for (let i = 0; i < A.rows; i++)
    for (let j = 0; j < A.cols; j++)
      out.data[j] += A.get(i, j);
  for (let j = 0; j < A.cols; j++) out.data[j] /= A.rows;
  return out;
}

// ── Activations ───────────────────────────────────────────────────────────────

export function relu(A: Tensor): Tensor {
  const B = A.clone();
  for (let i = 0; i < B.data.length; i++) B.data[i] = Math.max(0, B.data[i]);
  return B;
}

/**
 * GELU: x * 0.5 * (1 + tanh(sqrt(2/pi) * (x + 0.044715*x^3)))
 * Used in all FFN layers following GPT-2 / Gemma convention.
 */
export function gelu(A: Tensor): Tensor {
  const B = A.clone();
  const c = Math.sqrt(2 / Math.PI);
  for (let i = 0; i < B.data.length; i++) {
    const x = B.data[i];
    B.data[i] = 0.5 * x * (1 + Math.tanh(c * (x + 0.044715 * x * x * x)));
  }
  return B;
}

export function sigmoid(A: Tensor): Tensor {
  const B = A.clone();
  for (let i = 0; i < B.data.length; i++)
    B.data[i] = 1 / (1 + Math.exp(-B.data[i]));
  return B;
}

/**
 * Row-wise softmax with max-subtraction for numerical stability.
 * Each output row sums to 1.0 (verified within 1e-6).
 */
export function softmax(A: Tensor): Tensor {
  const B = A.clone();
  for (let i = 0; i < A.rows; i++) {
    let maxVal = -Infinity;
    for (let j = 0; j < A.cols; j++)
      if (A.get(i, j) > maxVal) maxVal = A.get(i, j);
    let sumExp = 0;
    for (let j = 0; j < A.cols; j++) {
      const e = Math.exp(A.get(i, j) - maxVal);
      B.set(i, j, e);
      sumExp += e;
    }
    const denom = sumExp + 1e-8;
    for (let j = 0; j < A.cols; j++) B.set(i, j, B.get(i, j) / denom);
  }
  return B;
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Layer Normalisation (Ba et al. 2016)
 * y = (x - mean) / sqrt(var + eps) * gamma + beta
 */
export function layerNorm(A: Tensor, gamma?: Tensor, beta?: Tensor, eps = 1e-5): Tensor {
  const B = Tensor.zeros(A.rows, A.cols);
  for (let i = 0; i < A.rows; i++) {
    let mean = 0;
    for (let j = 0; j < A.cols; j++) mean += A.get(i, j);
    mean /= A.cols;
    let variance = 0;
    for (let j = 0; j < A.cols; j++) { const d = A.get(i, j) - mean; variance += d * d; }
    variance /= A.cols;
    const std = Math.sqrt(variance + eps);
    for (let j = 0; j < A.cols; j++) {
      const norm = (A.get(i, j) - mean) / std;
      B.set(i, j, norm * (gamma ? gamma.data[j] : 1.0) + (beta ? beta.data[j] : 0.0));
    }
  }
  return B;
}

// ── Positional / Time Encoding ────────────────────────────────────────────────

/**
 * Sinusoidal positional encoding (Vaswani et al. 2017)
 * PE(pos, 2i)   = sin(pos / 10000^(2i/d))
 * PE(pos, 2i+1) = cos(pos / 10000^(2i/d))
 */
export function sinusoidalEncoding(pos: number, d: number): Float32Array {
  const enc = new Float32Array(d);
  for (let i = 0; i < d / 2; i++) {
    const angle = pos / Math.pow(10000, (2 * i) / d);
    enc[2 * i]     = Math.sin(angle);
    enc[2 * i + 1] = Math.cos(angle);
  }
  return enc;
}

// ── Parameter Counting Helpers ────────────────────────────────────────────────

/** W[in, out] + bias[out] */
export function linearParamCount(inDim: number, outDim: number): number {
  return inDim * outDim + outDim;
}

/** gamma + beta of size d */
export function lnParamCount(d: number): number {
  return d * 2;
}
