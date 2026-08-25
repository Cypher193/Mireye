import { useMemo, useRef, useState, useEffect } from 'react';
import type { HexCell } from '@/types';
import { USA_STATE_PATHS } from './USAMapPaths';
import { COUNTIES } from '@/data/hexGrid';

interface HexMapProps {
  cells: HexCell[];
  usaCells: HexCell[];
  selectedId: string | null;
  onSelect: (cell: HexCell) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  viewMode: 'usa' | 'county';
  onViewModeChange: (mode: 'usa' | 'county') => void;
  connection: 'disconnected' | 'connecting' | 'connected' | 'loading' | 'error';
  /** When true, show a semi-transparent loading overlay on the map */
  isLoading?: boolean;
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

export function HexMap({
  cells,
  usaCells,
  selectedId,
  onSelect,
  hoveredId,
  onHover,
  viewMode,
  onViewModeChange,
  connection,
  isLoading = false,
}: HexMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState('0 0 400 400');
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hoveredBase, setHoveredBase] = useState(false);

  // Compute viewBox dynamically
  useEffect(() => {
    if (viewMode === 'usa') {
      setViewBox('0 0 959 593');
      return;
    }
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
  }, [cells, viewMode]);

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

  // Station markers (only shown in local county view)
  const stations = useMemo(() => {
    const stationCells = cells.filter((c) => c.staffedStations > 0 && c.rcs > 0.5);
    return stationCells.slice(0, 6);
  }, [cells]);

  const cellsToRender = useMemo(() => {
    return viewMode === 'usa' ? usaCells : cells;
  }, [viewMode, usaCells, cells]);

  const hoveredHex = useMemo(() => {
    return hoveredId ? cellsToRender.find((c) => c.id === hoveredId) : null;
  }, [hoveredId, cellsToRender]);

  const onMapMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-ink-950 select-none"
      onMouseMove={onMapMouseMove}
    >
      {/* Topographic background (only for local grid) */}
      {viewMode === 'county' && (
        <>
          <div className="absolute inset-0 topo-grid" />
          <div className="absolute inset-0 topo-lines" />
        </>
      )}

      {/* Loading overlay — shown while API data is fetching */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-ink-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 animate-spin text-amber-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-semibold text-amber-400">Fetching live Mireye data…</span>
          </div>
          <span className="text-xs text-ink-500">POST /v1/geocode · /v1/fetch/batch · /v1/proximity</span>
        </div>
      )}

      {/* Map View Toggle Panel */}
      <div className="absolute top-4 right-4 z-10 flex rounded-lg border border-ink-800 bg-ink-950/80 p-0.5 backdrop-blur-md">
        <button
          onClick={() => onViewModeChange('usa')}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            viewMode === 'usa'
              ? 'bg-ink-800 text-ink-100'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          National Map (US)
        </button>
        <button
          onClick={() => onViewModeChange('county')}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            viewMode === 'county'
              ? 'bg-ink-800 text-ink-100'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          County Grid (Local)
        </button>
      </div>

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
          <pattern
            id="ccg-hatch"
            width="6"
            height="6"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="#16233A" strokeWidth="1.2" />
          </pattern>
        </defs>

        {/* Topographic contour lines (only in county view) */}
        {viewMode === 'county' && (
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
        )}

        {/* USA Outline Base */}
        {viewMode === 'usa' && (
          <>
            <g className="usa-states-group">
              {USA_STATE_PATHS.map((state) => {
                const hasPilot = ['co', 'az', 'ca', 'or', 'mt', 'tx', 'ga'].includes(state.id);
                return (
                  <path
                    key={state.id}
                    d={state.d}
                    fill={hasPilot ? 'rgba(30, 58, 95, 0.25)' : 'url(#ccg-hatch)'}
                    stroke={hasPilot ? '#334155' : '#1e293b'}
                    strokeWidth={hasPilot ? 1.0 : 0.6}
                    className="transition-all duration-300 hover:fill-ink-800/40"
                    onMouseEnter={() => setHoveredBase(true)}
                    onMouseLeave={() => setHoveredBase(false)}
                  />
                );
              })}
            </g>

            {/* City Markers and Text Labels */}
            <g className="city-markers-group">
              {COUNTIES.map((county) => {
                if (!county.cx || !county.cy) return null;
                return (
                  <g key={county.id} className="pointer-events-none animate-fade-in">
                    {/* Glowing ring animation */}
                    <circle
                      cx={county.cx}
                      cy={county.cy}
                      r="7"
                      fill="none"
                      stroke="#FBBF24"
                      strokeWidth="1"
                      opacity="0.4"
                      className="animate-ping"
                      style={{ animationDuration: '3s' }}
                    />
                    {/* Inner anchor dot */}
                    <circle
                      cx={county.cx}
                      cy={county.cy}
                      r="2.5"
                      fill="#FBBF24"
                      stroke="#0f172a"
                      strokeWidth="0.8"
                    />
                    {/* City text label */}
                    <text
                      x={county.cx}
                      y={county.cy - 11}
                      textAnchor="middle"
                      className="select-none font-sans text-[8.5px] font-bold text-ink-300 fill-ink-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
                    >
                      {county.cityName}
                    </text>
                  </g>
                );
              })}
            </g>
          </>
        )}

        {/* Hex cells */}
        <g>
          {cellsToRender.map((cell) => {
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
                    r={viewMode === 'usa' ? '12' : '35'}
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
                  strokeWidth={isSelected ? (viewMode === 'usa' ? 1.2 : 2) : isHovered ? (viewMode === 'usa' ? 0.8 : 1.5) : 0.4}
                  strokeOpacity={isSelected ? 1 : isHovered ? 0.8 : 0.3}
                  className="cursor-pointer transition-all duration-150"
                  style={{
                    filter: isHovered || isSelected ? 'brightness(1.3)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    onHover(cell.id);
                    setHoveredBase(false);
                  }}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(cell)}
                />
                {/* WUI cluster indicator dot */}
                {viewMode === 'county' && cell.wuiCluster && cell.housingUnits > 100 && (
                  <circle
                    cx={cell.cx}
                    cy={cell.cy}
                    r="2"
                    fill="#FEF3C7"
                    opacity="0.6"
                    pointerEvents="none"
                  />
                )}
                {isSelected && viewMode === 'county' && (
                  <polygon
                    points={cell.vertices}
                    fill="none"
                    stroke="#F1F5F9"
                    strokeWidth="1"
                    opacity="0.5"
                    className="animate-pulse-ring"
                    style={{ transformOrigin: `${cell.cx}px ${cell.cy}px` }}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Fire station markers (only county view) */}
        {viewMode === 'county' && (
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
        )}

        {/* Hex ID label on selected (only county view) */}
        {viewMode === 'county' && selectedId && (
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
          })()
        )}
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

      {/* Map overlay: station legend (only county view) */}
      {viewMode === 'county' ? (
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
      ) : (
        <div className="absolute bottom-4 right-4 font-mono text-[9px] text-ink-500">
          CCG Engine · pilot build · v0.4.0
        </div>
      )}

      {/* Floating Tooltips */}
      {hoveredHex && (
        <div
          className="pointer-events-none absolute z-50 rounded border border-ink-800 bg-ink-950/95 p-3 text-[10px] text-ink-200 shadow-xl shadow-black/80 font-mono w-56 animate-fade-in-fast"
          style={{ left: mouse.x + 16, top: mouse.y + 12 }}
        >
          <div className="font-bold text-ink-100 border-b border-ink-800 pb-1 mb-1">
            {hoveredHex.county} County ({hoveredHex.state})
          </div>
          <div className="flex justify-between mt-0.5">
            <span>CCG Score:</span>
            <span className="font-bold text-heat-500">{hoveredHex.ccg.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>IPS (Physics):</span>
            <span className="text-heat-400">{hoveredHex.ips.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>RCS (Routing):</span>
            <span className="text-cool-400">{hoveredHex.rcs.toFixed(2)}</span>
          </div>
          {connection === 'connected' ? (
            <div className="text-[8.5px] text-emerald-400 mt-1.5 border-t border-ink-800/40 pt-1 flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              Live Mireye API data
            </div>
          ) : connection === 'loading' ? (
            <div className="text-[8.5px] text-amber-400 mt-1.5 border-t border-ink-800/40 pt-1 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Fetching live data…
            </div>
          ) : connection === 'error' ? (
            <div className="text-[8.5px] text-red-400 mt-1.5 border-t border-ink-800/40 pt-1 flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-red-500" />
              API error — check console
            </div>
          ) : (
            <div className="text-[8.5px] text-heat-500 mt-1.5 border-t border-ink-800/40 pt-1 flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-heat-500" />
              Showing cached pilot data
            </div>
          )}
        </div>
      )}

      {!hoveredHex && hoveredBase && viewMode === 'usa' && (
        <div
          className="pointer-events-none absolute z-50 rounded border border-ink-800 bg-ink-950/90 p-2 text-[10.5px] text-ink-400 shadow-xl shadow-black/80 font-mono max-w-[200px]"
          style={{ left: mouse.x + 16, top: mouse.y + 12 }}
        >
          No Mireye coverage in this region — pilot limited to 7 active states.
        </div>
      )}

      {/* Hover hint */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="glass-panel-light rounded-full px-4 py-1.5 text-[11px] text-ink-400 backdrop-blur-md">
          {viewMode === 'usa'
            ? 'Hover over county clusters or click to select'
            : 'Hover or click any local hex cell to inspect details'}
        </div>
      </div>
    </div>
  );
}
