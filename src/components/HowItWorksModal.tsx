import { useEffect } from 'react';
import {
  X,
  Database,
  Building2,
  Cpu,
  Map,
  ArrowRight,
  ArrowDown,
  Layers,
  Flame,
  Truck,
  FileText,
} from 'lucide-react';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HowItWorksModal({ isOpen, onClose }: HowItWorksModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in-fast"
      onClick={onClose}
    >
      <div
        className="glass-panel relative mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto scroll-thin rounded-2xl p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-ink-500 transition-colors hover:text-ink-200"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div className="mb-6">
          <div className="mb-1 flex items-center gap-2">
            <Layers className="h-5 w-5 text-heat-500" />
            <h2 className="text-lg font-bold text-ink-100">
              How it Works — Physics-Aware Fusion
            </h2>
          </div>
          <p className="text-xs text-ink-400">
            The CCG Engine fuses static ignition physics with real-time response routing to produce
            a ranked, quantitatively justified shortlist of at-risk WUI clusters.
          </p>
        </div>

        {/* Flowchart */}
        <div className="space-y-3">
          {/* Inputs row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Input 1 */}
            <div className="rounded-xl border border-heat-700/30 bg-heat-700/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-heat-700/20">
                  <Database className="h-4 w-4 text-heat-400" />
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-heat-400">
                    Input 1
                  </div>
                  <div className="text-sm font-bold text-ink-100">Mireye</div>
                </div>
              </div>
              <p className="text-[10px] text-ink-400">
                Ignition risk & static structural fields — building footprints, vegetation density,
                parcel-level fuel models, slope from DEM.
              </p>
            </div>

            {/* Input 2 */}
            <div className="rounded-xl border border-cool-600/30 bg-cool-600/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cool-600/20">
                  <Building2 className="h-4 w-4 text-cool-400" />
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-cool-400">
                    Input 2
                  </div>
                  <div className="text-sm font-bold text-ink-100">USFA Registry</div>
                </div>
              </div>
              <p className="text-[10px] text-ink-400">
                Response capacity & drive times — staffed fire stations, apparatus inventory,
                NFPA-1 staffing requirements, OSRM road network routing.
              </p>
            </div>
          </div>

          {/* Arrow down */}
          <div className="flex justify-center">
            <div className="flex flex-col items-center">
              <ArrowDown className="h-5 w-5 text-ink-600" />
            </div>
          </div>

          {/* Processing */}
          <div className="rounded-xl border border-ink-700 bg-ink-850/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-700">
                <Cpu className="h-4 w-4 text-heat-500" />
              </div>
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-500">
                  Processing
                </div>
                <div className="text-sm font-bold text-ink-100">Physics-Aware Fusion Engine</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-start gap-2 rounded-lg bg-ink-900/50 p-2.5">
                <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-heat-500" />
                <div>
                  <div className="text-[10px] font-semibold text-ink-200">
                    Rothermel-inspired Engine
                  </div>
                  <div className="text-[9px] text-ink-500">
                    Computes IPS from slope, fuel, wind, thermal inertia
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-ink-900/50 p-2.5">
                <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cool-500" />
                <div>
                  <div className="text-[10px] font-semibold text-ink-200">
                    OSRM Routing
                  </div>
                  <div className="text-[9px] text-ink-500">
                    Drive-time to staffed stations vs. NFPA-1 thresholds
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Arrow down */}
          <div className="flex justify-center">
            <ArrowDown className="h-5 w-5 text-ink-600" />
          </div>

          {/* Output */}
          <div className="rounded-xl border border-heat-600/30 bg-gradient-to-br from-heat-600/10 to-ink-900/40 p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-heat-600/20">
                <FileText className="h-4 w-4 text-heat-400" />
              </div>
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-heat-400">
                  Output
                </div>
                <div className="text-sm font-bold text-ink-100">
                  Ranked CCG Shortlist + Capital Briefs
                </div>
              </div>
            </div>
            <p className="text-[10px] text-ink-400">
              Each hex cell receives a multiplicative CCG score (IPS × (1 − RCS)) with full
              physics provenance. Top-ranked gaps generate executive-ready capital allocation
              briefs with quantified resource recommendations.
            </p>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-ink-900/40 p-3">
          <Map className="h-3.5 w-3.5 text-ink-500" />
          <span className="text-[10px] text-ink-500">
            All scores are deterministic and physics-grounded. No LLM hallucination — the model
            only narrates pre-computed quantitative results.
          </span>
        </div>
      </div>
    </div>
  );
}
