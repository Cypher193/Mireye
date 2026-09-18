import { useState, useEffect } from 'react';
import { Hexagon, RefreshCw, Cpu, Sparkles } from 'lucide-react';
import { modelLoader, type ModelStatus } from '@/lib/ml/modelLoader';

interface TopNavProps {
  onHowItWorks: () => void;
  onClearCache: () => void;
}

export function TopNav({
  onHowItWorks,
  onClearCache,
}: TopNavProps) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>(modelLoader.getStatus());

  useEffect(() => {
    return modelLoader.subscribe((s) => setModelStatus(s));
  }, []);

  return (
    <header className="relative z-30 flex h-14 items-center justify-between border-b border-ink-800 bg-ink-950/80 px-4 backdrop-blur-md lg:px-6 select-none">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <Hexagon className="h-7 w-7 text-heat-500" strokeWidth={1.5} />
          <Hexagon
            className="absolute inset-0 h-7 w-7 text-heat-400/40 animate-glow-pulse"
            strokeWidth={1.5}
          />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold tracking-tight text-ink-100">
            CCG <span className="text-heat-500">Engine</span>
          </span>
          <span className="text-[10px] font-medium text-ink-500">
            Coverage-Combustibility Gap
          </span>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2.5">
        {/* Model Status Badge */}
        <div
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold ${
            modelStatus.source === 'custom-onnx'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-ink-800 bg-ink-900/60 text-ink-300'
          }`}
          title={
            modelStatus.source === 'custom-onnx'
              ? `Running custom model: ${modelStatus.name} (${modelStatus.latencyMs.toFixed(1)}ms)`
              : 'Running built-in FireSenseNet ML Engine'
          }
        >
          <Cpu className="h-3.5 w-3.5 text-heat-400" />
          <span className="truncate max-w-[160px]">
            {modelStatus.source === 'custom-onnx' ? modelStatus.name : 'Model: FireSenseNet'}
          </span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>

        <button
          onClick={onClearCache}
          className="flex items-center gap-1.5 rounded-md border border-ink-800 bg-ink-900/30 px-3 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          title="Clear local geocode and physics cache"
        >
          <RefreshCw className="h-3 w-3" />
          Clear Cache
        </button>
        <button
          onClick={onHowItWorks}
          className="hidden rounded-md border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100 md:block"
        >
          How it Works
        </button>
      </div>
    </header>
  );
}

