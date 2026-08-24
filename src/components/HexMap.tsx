import { useMemo, useRef, useState, useEffect } from 'react';
import type { HexCell } from '@/types';

interface HexMapProps {
  cells: HexCell[];
  selectedId: string | null;
  onSelect: (cell: HexCell) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function riskColor(ccg: number): string {
  if (ccg >= 0.75) return '#DC2626';
  if (ccg >= 0.5) return '#EA580C';
  if (ccg >= 0.3) return '#F59E0B';
  if (ccg >= 0.15) return '#FBBF24';
  return '#1E3A5F';
}

function riskOpacity(ccg: number): number {
  if (ccg < 0.1) return 0.08;
  return 0.15 + ccg * 0.75;
}

export function HexMap({ cells, selectedId, onSelect, hoveredId, onHover }: HexMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState('0 0 400 400');

  // Compute viewBox from cells
  useEffect(() => {
    if (cells.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.cx - 25);
      minY = Math.min(minY, c.cy - 25);
      maxX = Math.max(maxX, c.cx + 25);
      maxY = Math.max(maxY, c.cy + 25);
    }
    const pad = 30;
    setViewBox(`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  }, [cells]);

  // Generate topographic contour lines (deterministic)
  const contours = useMemo(() => {
    const lines: { d: string; opacity: number }[] = [];
    const cx = 200, cy = 200;
    for (let r = 30; r < 200; r += 25) {
      let d = '';
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const wobble = Math.sin(angle * 3 + r * 0.1) * 8 + Math.cos(angle * 5 + r * 0.05) * 5;
        const x = cx + (r + wobble) * Math.cos(angle);
        const y = cy + (r + wobble) * Math.sin(angle);
        d += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
      }
      lines.push({ d, opacity: 0.04 + (r / 200) * 0.04 });
    }
    return lines;
  }, []);

  // Generate station markers
  const stations = useMemo(() => {
    const stationCells = cells.filter((c) => c.staffedStations > 0 && c.rcs > 0.5);
    return stationCells.slice(0, 6);
  }, [cells]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-950">
      {/* Topographic background */}
      <div className="absolute inset-0 topo-grid" />
      <div className="absolute inset-0 topo-lines" />

      {/* Scan line effect */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-0 right-0 h-32 bg-gradient-to-b from-transparent via-cool-500/5 to-transparent animate-scan" />
      </div>

      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="hexGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="severeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#DC2626" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#DC2626" stopOpacity="0" />
          </radialGradient>
          <filter id="hexBlur">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
        </defs>

        {/* Topographic contour lines */}
        <g>
          {contours.map((c, i) => (
            <path
              key={i}
              d={c.d}
              fill="none"
              stroke="#334155"
              strokeWidth="0.5"
              opacity={c.opacity}
            />
          ))}
        </g>

        {/* Hex cells */}
        <g>
          {cells.map((cell) => {
            const isSelected = cell.id === selectedId;
            const isHovered = cell.id === hoveredId;
            const color = riskColor(cell.ccg);
            const opacity = riskOpacity(cell.ccg);
            const isSevere = cell.ccg >= 0.7;

            return (
              <g key={cell.id}>
                {/* Glow under severe hexes */}
                {isSevere && (
                  <circle
                    cx={cell.cx}
                    cy={cell.cy}
                    r="35"
                    fill="url(#severeGlow)"
                    className="animate-glow-pulse"
                    style={{ animationDelay: `${(cell.row + cell.col) * 0.2}s` }}
                  />
                )}
                <polygon
                  points={cell.vertices}
                  fill={color}
                  fillOpacity={opacity}
                  stroke={isSelected ? '#F1F5F9' : isHovered ? '#94A3B8' : color}
                  strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 0.75}
                  strokeOpacity={isSelected ? 1 : isHovered ? 0.8 : 0.4}
                  className="cursor-pointer transition-all duration-150"
                  style={{
                    filter: isHovered || isSelected ? 'brightness(1.3)' : 'none',
                  }}
                  onMouseEnter={() => onHover(cell.id)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(cell)}
                />
                {/* WUI cluster indicator dot */}
                {cell.wuiCluster && cell.housingUnits > 100 && (
                  <circle
                    cx={cell.cx}
                    cy={cell.cy}
                    r="2"
                    fill="#FEF3C7"
                    opacity="0.6"
                    pointerEvents="none"
                  />
                )}
                {isSelected && (
                  <>
                    <polygon
                      points={cell.vertices}
                      fill="none"
                      stroke="#F1F5F9"
                      strokeWidth="1"
                      opacity="0.5"
                      className="animate-pulse-ring"
                      style={{ transformOrigin: `${cell.cx}px ${cell.cy}px` }}
                    />
                  </>
                )}
              </g>
            );
          })}
        </g>

        {/* Fire station markers */}
        <g>
          {stations.map((s, i) => (
            <g key={i} pointerEvents="none">
              <circle
                cx={s.cx}
                cy={s.cy}
                r="4"
                fill="#0EA5E9"
                fillOpacity="0.2"
                stroke="#38BDF8"
                strokeWidth="1.5"
              />
              <circle cx={s.cx} cy={s.cy} r="1.5" fill="#38BDF8" />
            </g>
          ))}
        </g>

        {/* Hex ID label on selected */}
        {selectedId &&
          (() => {
            const cell = cells.find((c) => c.id === selectedId);
            if (!cell) return null;
            return (
              <g pointerEvents="none">
                <rect
                  x={cell.cx - 40}
                  y={cell.cy - 42}
                  width="80"
                  height="16"
                  rx="3"
                  fill="#0F172A"
                  fillOpacity="0.9"
                  stroke="#334155"
                  strokeWidth="0.5"
                />
                <text
                  x={cell.cx}
                  y={cell.cy - 31}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="8"
                  fill="#CBD5E1"
                >
                  {cell.id.toUpperCase().slice(-6)} · CCG {cell.ccg.toFixed(2)}
                </text>
              </g>
            );
          })()}
      </svg>

      {/* Map overlay: legend */}
      <div className="absolute bottom-4 left-4 glass-panel rounded-lg p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          CCG Risk Scale
        </div>
        <div className="flex items-center gap-1">
          {[
            { color: '#1E3A5F', label: 'Low' },
            { color: '#FBBF24', label: 'Mod' },
            { color: '#F59E0B', label: 'Elev' },
            { color: '#EA580C', label: 'High' },
            { color: '#DC2626', label: 'Sev' },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-1">
              <div
                className="h-3 w-6 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[8px] text-ink-500">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Map overlay: station legend */}
      <div className="absolute bottom-4 right-4 glass-panel rounded-lg p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex h-4 w-4 items-center justify-center">
            <div className="absolute h-4 w-4 rounded-full bg-cool-500/20" />
            <div className="h-2 w-2 rounded-full bg-cool-400" />
          </div>
          <span className="text-[10px] text-ink-400">Staffed USFA Station</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 w-4 rounded-full bg-heat-100 opacity-60" />
          <span className="text-[10px] text-ink-400">WUI Housing Cluster</span>
        </div>
      </div>

      {/* Hover hint */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className="glass-panel-light rounded-full px-4 py-1.5 text-[11px] text-ink-400">
          Hover or click any hex cell to inspect physics & response metrics
        </div>
      </div>
    </div>
  );
}
