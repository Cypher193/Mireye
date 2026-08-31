import type { HexCell } from '@/types';
import { getApparatusRecommendations } from '@/lib/apparatusEngine';
import { Shield, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react';

interface MetricCardProps {
  cell: HexCell | null;
}

function ScoreBar({
  value,
  color,
  label,
  sublabel,
  display,
}: {
  value: number;
  color: string;
  label: string;
  sublabel: string;
  display: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-ink-400">{label}</span>
        <span className="font-mono text-lg font-bold" style={{ color }}>
          {display}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${Math.max(2, value * 100)}%`,
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}80`,
          }}
        />
      </div>
      <div className="mt-1 text-[9px] text-ink-500">{sublabel}</div>
    </div>
  );
}

export function MetricCards({ cell }: MetricCardProps) {
  const ips = cell?.ips ?? 0;
  const rcs = cell?.rcs ?? 0;
  const ccg = cell?.ccg ?? 0;

  const ipsColor = ips >= 0.7 ? '#DC2626' : ips >= 0.5 ? '#EA580C' : '#F59E0B';
  const rcsColor = rcs >= 0.6 ? '#0EA5E9' : rcs >= 0.3 ? '#0284C7' : '#0369A1';
  const ccgColor = ccg >= 0.75 ? '#DC2626' : ccg >= 0.5 ? '#EA580C' : '#F59E0B';

  const recs = getApparatusRecommendations(cell);
  const statusColors = {
    compliant: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20',
    warning: 'text-amber-700 bg-amber-500/10 border-amber-500/20',
    restricted: 'text-rose-700 bg-rose-500/10 border-rose-500/20',
  };

  const statusIcons = {
    compliant: CheckCircle,
    warning: AlertTriangle,
    restricted: Shield,
  };

  const StatusIcon = cell ? statusIcons[recs.compliance.status] : HelpCircle;

  return (
    <div className="space-y-3">
      {/* IPS Card */}
      <div className="glass-panel-light rounded-lg p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ipsColor }} />
            <span className="text-xs font-semibold text-ink-200">
              IPS — Ignition Propensity
            </span>
          </div>
          <span className="rounded bg-heat-700/20 px-1.5 py-0.5 text-[9px] font-medium text-heat-400">
            Physics
          </span>
        </div>
        <ScoreBar
          value={ips}
          color={ipsColor}
          label="Score"
          sublabel="slope · fuel · wind · thermal-inertia"
          display={ips.toFixed(2)}
        />
      </div>

      {/* RCS Card */}
      <div className="glass-panel-light rounded-lg p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: rcsColor }} />
            <span className="text-xs font-semibold text-ink-200">
              RCS — Response Capacity
            </span>
          </div>
          <span className="rounded bg-cool-600/20 px-1.5 py-0.5 text-[9px] font-medium text-cool-400">
            Routing
          </span>
        </div>
        <ScoreBar
          value={rcs}
          color={rcsColor}
          label="Score"
          sublabel={`drive-time ${cell ? cell.driveTimeMin.toFixed(1) : '—'}min · ${cell ? cell.staffedStations : '—'} staffed stns`}
          display={rcs.toFixed(2)}
        />
      </div>

      {/* CCG Card — prominent */}
      <div
        className="relative overflow-hidden rounded-lg p-3 transition-all duration-300"
        style={{
          background:
            ccg >= 0.75
              ? 'linear-gradient(135deg, rgba(220,38,38,0.15) 0%, rgba(15,23,42,0.6) 100%)'
              : ccg >= 0.5
                ? 'linear-gradient(135deg, rgba(234,88,12,0.12) 0%, rgba(15,23,42,0.6) 100%)'
                : 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(15,23,42,0.6) 100%)',
          border: `1px solid ${ccgColor}40`,
        }}
      >
        {ccg >= 0.7 && (
          <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full bg-heat-700/20 blur-xl animate-glow-pulse" />
        )}
        <div className="relative">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ccgColor }} />
              <span className="text-xs font-semibold text-ink-100">
                CCG — Coverage Gap
              </span>
            </div>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{
                color: ccgColor,
                backgroundColor: `${ccgColor}20`,
              }}
            >
              {cell?.riskLabel ?? '—'}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span
              className="font-mono text-3xl font-extrabold leading-none transition-colors duration-300"
              style={{ color: ccgColor }}
            >
              {ccg.toFixed(2)}
            </span>
            <span className="mb-0.5 text-[10px] text-ink-500">
              IPS × (1−RCS)
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(2, ccg * 100)}%`,
                background: `linear-gradient(90deg, ${ccgColor}80, ${ccgColor})`,
                boxShadow: `0 0 12px ${ccgColor}60`,
              }}
            />
          </div>
          <div className="mt-1.5 text-[9px] text-ink-500">
            {cell
              ? `${cell.housingUnits} WUI housing units at risk`
              : 'Select a hex to compute gap'}
          </div>
        </div>
      </div>

      {/* Phase 2 Apparatus Dispatch Recommendations */}
      {cell && (
        <div className="glass-panel-light rounded-lg p-3 space-y-2.5 border border-ink-800/40">
          <div className="flex items-center justify-between border-b border-ink-800/20 pb-1.5">
            <span className="text-xs font-bold text-ink-200 uppercase tracking-wider">
              NFPA-1 Apparatus Dispatch
            </span>
            <span className="rounded bg-heat-700/20 px-1.5 py-0.5 text-[8.5px] font-bold text-heat-500 uppercase">
              Phase 2
            </span>
          </div>

          {/* Compliance Banner */}
          <div className={`flex items-start gap-2 rounded border p-2 text-[10px] ${statusColors[recs.compliance.status]}`}>
            <StatusIcon className="h-4 w-4 shrink-0 mt-0.5 text-inherit" />
            <div>
              <strong className="block font-semibold text-inherit">{recs.compliance.label}</strong>
              <span className="leading-normal text-inherit">{recs.compliance.description}</span>
            </div>
          </div>

          {/* Apparatus List */}
          <div className="space-y-1.5">
            <span className="text-[9.5px] font-semibold text-ink-400 uppercase block">Recommended Deployment:</span>
            {recs.apparatusList.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center bg-ink-900/40 rounded p-1.5 text-[10.5px]">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-heat-600/25 text-[9px] font-bold text-heat-500">
                    {item.count}x
                  </span>
                  <span className="text-ink-200 font-medium">{item.name}</span>
                </div>
                <span className="text-[8.5px] text-ink-500 italic max-w-[150px] text-right">{item.description}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-[9px] text-ink-500 border-t border-ink-800/20 pt-1.5">
            <span>Dispatch Protocol: <strong className="text-ink-300">{recs.dispatchLevel} Response</strong></span>
            <span>Ref: NFPA-1 Sect. 17.3</span>
          </div>
        </div>
      )}
    </div>
  );
}
