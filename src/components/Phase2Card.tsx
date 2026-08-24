import { Flame, ShieldAlert, Radio, MapPin } from 'lucide-react';

interface Phase2CardProps {
  isActive: boolean;
  onToggle: () => void;
}

export function Phase2Card({ isActive, onToggle }: Phase2CardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border p-3 transition-all ${
        isActive
          ? 'border-heat-700/50 bg-gradient-to-br from-heat-700/10 to-ink-900/60'
          : 'border-ink-700/50 glass-panel-light'
      }`}
    >
      {/* Glow effect */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-heat-600/10 blur-2xl" />

      <div className="relative">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-heat-500" />
            <span className="text-[11px] font-semibold text-ink-200">
              Phase 2 — Active Fire Response
            </span>
          </div>
          <button
            onClick={onToggle}
            className={`relative h-4 w-7 rounded-full transition-colors ${
              isActive ? 'bg-heat-600' : 'bg-ink-700'
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                isActive ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {isActive ? (
          <div className="space-y-2 animate-fade-in">
            <p className="text-[10px] text-ink-400">
              Preview of capabilities — full deployment pending CAL FIRE validation.
            </p>
            <div className="space-y-1.5">
              {[
                { icon: MapPin, text: 'Historical Spread Simulation (CAL FIRE verified)' },
                { icon: ShieldAlert, text: 'Apparatus Recommendations based on NFPA-1' },
                { icon: Radio, text: 'Generated CAP 1.2 Polygon Geofence Alerts' },
              ].map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-ink-850/50 px-2 py-1.5"
                >
                  <f.icon className="h-3 w-3 shrink-0 text-heat-400" />
                  <span className="text-[10px] text-ink-300">{f.text}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-heat-500" />
              <span className="text-[9px] text-ink-500">Simulation engine warming up...</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1">
            <span className="rounded bg-heat-700/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-heat-400">
              Coming Soon
            </span>
            <span className="text-[10px] text-ink-500">
              Toggle to preview Phase 2 capabilities
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
