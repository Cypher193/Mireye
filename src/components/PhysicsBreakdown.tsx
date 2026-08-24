import { Flame, ShieldCheck, Zap, TrendingUp } from 'lucide-react';
import type { HexCell } from '@/types';

interface PhysicsBreakdownProps {
  cell: HexCell | null;
}

function MiniBar({ label, value, max, unit, color }: {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[9px] text-ink-500">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[9px] text-ink-300">
        {value.toFixed(2)}{unit}
      </span>
    </div>
  );
}

export function PhysicsBreakdown({ cell }: PhysicsBreakdownProps) {
  if (!cell) {
    return (
      <div className="glass-panel-light rounded-lg p-3 text-center text-[10px] text-ink-500">
        Select a hex cell to view physics breakdown
      </div>
    );
  }

  return (
    <div className="glass-panel-light rounded-lg p-3">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-heat-500" />
        <span className="text-[11px] font-semibold text-ink-200">
          Physics Fusion Breakdown
        </span>
      </div>
      <div className="space-y-1.5">
        <MiniBar label="Slope" value={cell.slope} max={1} unit="" color="#F59E0B" />
        <MiniBar label="Fuel Proxy" value={cell.fuelProxy} max={1} unit="" color="#EA580C" />
        <MiniBar label="Wind Speed" value={cell.wind} max={1} unit="m/s" color="#DC2626" />
        <MiniBar label="Thermal Inertia" value={cell.thermalInertia} max={1} unit="" color="#38BDF8" />
      </div>
      <div className="mt-2.5 border-t border-ink-800/50 pt-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-cool-500" />
          <span className="text-[11px] font-semibold text-ink-200">
            Response Routing
          </span>
        </div>
        <div className="space-y-1.5">
          <MiniBar label="Drive Time" value={cell.driveTimeMin} max={30} unit="min" color={cell.driveTimeMin > 6 ? '#DC2626' : '#0EA5E9'} />
          <MiniBar label="Staffed Stns" value={cell.staffedStations} max={4} unit="" color="#0EA5E9" />
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-ink-800/50 pt-2.5">
        <Flame className="h-3.5 w-3.5 text-heat-500" />
        <span className="text-[9px] text-ink-400">
          {cell.housingUnits} housing units · {cell.wuiCluster ? 'WUI cluster' : 'non-WUI'}
        </span>
      </div>
    </div>
  );
}
