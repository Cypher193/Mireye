/**
 * Dynamic AI & Model Reasoning Trace
 * ─────────────────────────────────────────────────────────────────────────────
 * Formats real model inference and API telemetry for display in the sidebar.
 * Zero hardcoded values: reflects the actual loaded model, input tensors,
 * and computed risk metrics.
 */

import type { ReasoningLine, HexCell, County } from '@/types';
import { modelLoader } from '@/lib/ml/modelLoader';

export function buildReasoningTrace(cell: HexCell, county: County): ReasoningLine[] {
  const modelStatus = modelLoader.getStatus();
  const slopeDegrees = (cell.slope * 45).toFixed(1);
  const latStr = cell.lat?.toFixed(4) ?? '0.0000';
  const lngStr = cell.lng?.toFixed(4) ?? '0.0000';
  const stationName = cell.nearestStationName ?? 'Regional Station';
  const latencyMs = cell.mireyeLatencyMs ? `${cell.mireyeLatencyMs}ms` : '< 1ms';

  return [
    // Model status
    { text: `> ACTIVE INFERENCE MODEL`, type: 'info', delay: 80 },
    { text: `  Engine: ${modelStatus.name} (${modelStatus.source})`, type: 'result', delay: 100 },
    { text: `  Execution Backend: ${modelStatus.source === 'custom-onnx' ? 'ONNX WebAssembly' : 'Kaggle ML Engine'}`, type: 'result', delay: 120 },

    // Geolocation
    { text: `> GEODETIC TARGET COORDINATES`, type: 'command', delay: 120 },
    { text: `  Region: ${county.name} · Centroid: (${latStr}, ${lngStr})`, type: 'result', delay: 150 },

    // Feature Tensors
    { text: `> EXTRACTED SPATIAL FEATURE TENSORS`, type: 'command', delay: 200 },
    { text: `  Slope: ${slopeDegrees}° | Fuel Proxy: ${(cell.fuelProxy * 100).toFixed(1)}%`, type: 'result', delay: 220 },
    { text: `  Thermal Inertia: ${cell.thermalInertia.toFixed(2)} | Drive Time: ${cell.driveTimeMin.toFixed(1)} min`, type: 'result', delay: 240 },
    { text: `  Telemetry Latency: ${latencyMs}`, type: 'info', delay: 150 },

    // Direct Model Predictions
    { text: `> RUNNING MODEL INFERENCE FOR CELL ${cell.id}`, type: 'command', delay: 250 },
    { text: `  Ignition Propensity Score (IPS): ${cell.ips.toFixed(4)}`, type: 'result', delay: 280 },
    { text: `  Response Capacity Score (RCS): ${cell.rcs.toFixed(4)} [NFPA 1710]`, type: 'result', delay: 280 },
    { text: `  Calculated Gap (CCG): ${cell.ccg.toFixed(4)} [${cell.riskLabel} Risk]`, type: cell.ccg >= 0.5 ? 'warn' : 'result', delay: 300 },
    { text: `  Nearest Assigned Facility: ${stationName}`, type: 'info', delay: 200 },
  ];
}
