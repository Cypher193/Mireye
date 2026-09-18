/**
 * Universal Model Loader for Mireye / FireSenseNet
 * ─────────────────────────────────────────────────────────────────────────────
 * Supports loading:
 * 1. Custom ONNX models:
 *    - Auto-detects /model.onnx, /weights/model.onnx, /model.bin if placed in public/ or weights/
 *    - User drag-and-drop or file upload (model.onnx, model.something)
 * 2. Real-time browser inference via onnxruntime-web (WebAssembly / WebGPU)
 * 3. Graceful zero-latency fallback to built-in FireSenseNet-600M Lite
 */

import * as ort from 'onnxruntime-web';
import type { HexCell } from '@/types';
import { getFireSenseNet } from './fireSenseNet';
import { extractNodeFeatures, buildHexGraph } from './fireGNN';

export interface ModelStatus {
  source: 'custom-onnx' | 'custom-json' | 'firesensenet-lite';
  name: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  latencyMs: number;
  inputNames?: string[];
  outputNames?: string[];
  error?: string | null;
  fileSizeBytes?: number;
}

export interface ModelInferenceResult {
  enhancedIPS: number[];
  source: string;
  latencyMs: number;
  attentionWeights?: number[][];
  rawOutput?: Record<string, unknown>;
}

type ModelChangeListener = (status: ModelStatus) => void;

class UniversalModelLoader {
  private session: ort.InferenceSession | null = null;
  private status: ModelStatus = {
    source: 'firesensenet-lite',
    name: 'FireSenseNet-600M (Lite Built-in)',
    status: 'ready',
    latencyMs: 0,
  };
  private listeners: Set<ModelChangeListener> = new Set();
  private autoCheckAttempted = false;

  constructor() {
    // Configure ONNX environment for optimal browser performance
    try {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
    } catch {
      // Ignore if wasm env settings aren't configurable
    }
  }

  public getStatus(): ModelStatus {
    return { ...this.status };
  }

  public subscribe(listener: ModelChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const s = this.getStatus();
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Automatically scans default locations for a custom model on startup
   */
  public async autoDetectModel(): Promise<boolean> {
    if (this.autoCheckAttempted) return this.session !== null;
    this.autoCheckAttempted = true;

    const candidateUrls = [
      '/model.onnx',
      '/weights/model.onnx',
      '/model.bin',
      '/firesensenet_600m_v1.onnx',
      '/weights/firesensenet_600m_v1.onnx',
    ];

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          // Ensure it's not returning an index.html 404 fallback
          if (!contentType.includes('text/html')) {
            console.log(`[ModelLoader] Detected custom model at ${url}, loading...`);
            const loaded = await this.loadFromUrl(url);
            if (loaded) return true;
          }
        }
      } catch {
        // Continue to next candidate
      }
    }
    return false;
  }

  /**
   * Loads an ONNX model from an ArrayBuffer (e.g. from file upload or drag-and-drop)
   */
  public async loadFromArrayBuffer(buffer: ArrayBuffer, fileName: string): Promise<boolean> {
    this.status = {
      source: 'custom-onnx',
      name: fileName,
      status: 'loading',
      latencyMs: 0,
      fileSizeBytes: buffer.byteLength,
    };
    this.notify();

    try {
      const t0 = performance.now();
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      const loadTime = performance.now() - t0;

      this.session = session;
      this.status = {
        source: 'custom-onnx',
        name: fileName,
        status: 'ready',
        latencyMs: loadTime,
        inputNames: [...session.inputNames],
        outputNames: [...session.outputNames],
        fileSizeBytes: buffer.byteLength,
      };
      console.log(`[ModelLoader] Successfully loaded ${fileName} in ${loadTime.toFixed(1)}ms. Inputs:`, session.inputNames);
      this.notify();
      return true;
    } catch (err) {
      console.error(`[ModelLoader] Failed to load ONNX model ${fileName}:`, err);
      this.status = {
        source: 'firesensenet-lite',
        name: 'FireSenseNet-600M (Lite Built-in)',
        status: 'error',
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      this.notify();
      return false;
    }
  }

  /**
   * Loads an ONNX model from a URL
   */
  public async loadFromUrl(url: string, displayName?: string): Promise<boolean> {
    const name = displayName || url.split('/').pop() || 'custom-model.onnx';
    this.status = {
      source: 'custom-onnx',
      name,
      status: 'loading',
      latencyMs: 0,
    };
    this.notify();

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const buffer = await res.arrayBuffer();
      return await this.loadFromArrayBuffer(buffer, name);
    } catch (err) {
      console.warn(`[ModelLoader] Could not load model from ${url}:`, err);
      this.status = {
        source: 'firesensenet-lite',
        name: 'FireSenseNet-600M (Lite Built-in)',
        status: 'ready',
        latencyMs: 0,
        error: `Could not load ${url}`,
      };
      this.notify();
      return false;
    }
  }

  /**
   * Resets the active model back to the built-in FireSenseNet Lite
   */
  public resetToBuiltIn() {
    this.session = null;
    this.status = {
      source: 'firesensenet-lite',
      name: 'FireSenseNet-600M (Lite Built-in)',
      status: 'ready',
      latencyMs: 0,
    };
    this.notify();
  }

  /**
   * Executes inference on the active model (custom ONNX or built-in FireSenseNet)
   */
  public async runInference(
    cells: HexCell[],
    windAngleDeg: number,
    windSpeedMph: number,
    ignitionIdx: number | null = null
  ): Promise<ModelInferenceResult> {
    const N = cells.length;
    if (N === 0) {
      return { enhancedIPS: [], source: this.status.name, latencyMs: 0 };
    }

    // ── If custom ONNX session is active, run ONNX Runtime ───────────────────
    if (this.session) {
      const t0 = performance.now();
      try {
        const feeds: Record<string, ort.Tensor> = {};

        // 1. Build cell_features [1, N, 8]
        const featuresTensor = extractNodeFeatures(cells);
        const cellFeaturesData = new Float32Array(featuresTensor.data);
        const cellFeaturesInput = new ort.Tensor('float32', cellFeaturesData, [1, N, 8]);

        // 2. Build adjacency_mask [1, N, N]
        const graph = buildHexGraph(cells, windAngleDeg, windSpeedMph);
        const adjData = new Float32Array(N * N);
        for (const edge of graph.edges) {
          adjData[edge.src * N + edge.dst] = edge.windAlign;
        }
        const adjInput = new ort.Tensor('float32', adjData, [1, N, N]);

        // 3. Build wind_vector [1, 2]
        const windRad = (windAngleDeg * Math.PI) / 180;
        const windData = new Float32Array([Math.sin(windRad), -Math.cos(windRad)]);
        const windInput = new ort.Tensor('float32', windData, [1, 2]);

        // Map inputs to matching model input names or fallbacks
        const inputNames = this.session.inputNames;
        for (const name of inputNames) {
          const lower = name.toLowerCase();
          if (lower.includes('feature') || lower.includes('cell') || lower.includes('input') || lower === 'x') {
            feeds[name] = cellFeaturesInput;
          } else if (lower.includes('adj') || lower.includes('mask') || lower.includes('graph')) {
            feeds[name] = adjInput;
          } else if (lower.includes('wind')) {
            feeds[name] = windInput;
          } else if (lower.includes('time') || lower.includes('step')) {
            feeds[name] = new ort.Tensor('int64', BigInt64Array.from([BigInt(0)]), [1]);
          } else {
            // Default fallback tensor
            feeds[name] = cellFeaturesInput;
          }
        }

        // If the model expects a single generic input name like 'input' or 'data'
        if (inputNames.length === 1 && !feeds[inputNames[0]]) {
          feeds[inputNames[0]] = cellFeaturesInput;
        }

        const outputs = await this.session.run(feeds);
        const elapsed = performance.now() - t0;

        // Extract primary output tensor (enhanced_ips, output, etc.)
        let outTensor: ort.Tensor | undefined;
        if (outputs['enhanced_ips']) {
          outTensor = outputs['enhanced_ips'];
        } else if (outputs['output']) {
          outTensor = outputs['output'];
        } else {
          // Take first available output
          const firstKey = Object.keys(outputs)[0];
          outTensor = outputs[firstKey];
        }

        if (outTensor && outTensor.data) {
          const rawData = outTensor.data as Float32Array | number[];
          const enhancedIPS: number[] = [];
          for (let i = 0; i < N; i++) {
            const val = Number(rawData[i] ?? cells[i].ips);
            // Clamp strictly between 0 and 1
            enhancedIPS.push(Math.max(0, Math.min(1, val)));
          }

          this.status.latencyMs = elapsed;
          return {
            enhancedIPS,
            source: this.status.name,
            latencyMs: elapsed,
          };
        }
      } catch (err) {
        console.warn('[ModelLoader] ONNX run failed, falling back to FireSenseNet Lite:', err);
      }
    }

    // ── Fallback: Run built-in FireSenseNet Lite ──────────────────────────────
    const t0 = performance.now();
    const net = getFireSenseNet();
    const out = net.forward(cells, windAngleDeg, windSpeedMph, ignitionIdx, 'local');
    const elapsed = performance.now() - t0;

    return {
      enhancedIPS: out.enhancedIPS,
      source: 'FireSenseNet-600M (Lite Built-in)',
      latencyMs: elapsed,
      attentionWeights: out.attentionWeights,
    };
  }
}

export const modelLoader = new UniversalModelLoader();
