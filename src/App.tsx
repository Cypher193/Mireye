import { useState, useMemo, useCallback, useEffect } from 'react';
import { TopNav } from '@/components/TopNav';
import { GoogleMap } from '@/components/GoogleMap';
import { MetricCards } from '@/components/MetricCards';
import { AIReasoningTrace } from '@/components/AIReasoningTrace';
import { LocationSelector } from '@/components/LocationSelector';
import { PhysicsBreakdown } from '@/components/PhysicsBreakdown';
import { Phase2Card } from '@/components/Phase2Card';
import { HowItWorksModal } from '@/components/HowItWorksModal';
import {
  COUNTIES,
  fetchHexGrid,
  generateHexGridSkeleton,
  getTopRiskHexes,
  generateUSAMapHexes,
  clearHexCache,
} from '@/data/hexGrid';
import { buildReasoningTrace } from '@/data/reasoning';
import { verifyWildfireFields } from '@/lib/mireyeClient';
import type { HexCell, County, ReasoningLine, ApiStatus } from '@/types';

function App() {
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [selectedCounty, setSelectedCounty] = useState<County>(COUNTIES[0]);
  const [selectedCell, setSelectedCell] = useState<HexCell | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [reasoningLines, setReasoningLines] = useState<ReasoningLine[]>([]);
  const [isReasoningRunning, setIsReasoningRunning] = useState(false);
  const [phase2Active, setPhase2Active] = useState(false);

  // Map View Mode: 'usa' (National Map) or 'county' (Local Grid)
  const [viewMode, setViewMode] = useState<'usa' | 'county'>('usa');

  // ── API state ──────────────────────────────────────────────────────────
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle');
  const [hexLoadStatus, setHexLoadStatus] = useState<ApiStatus>('idle');
  const [cells, setCells] = useState<HexCell[]>(() => generateHexGridSkeleton(COUNTIES[0].id));
  const [apiError, setApiError] = useState<string | null>(null);
  const [cacheBuster, setCacheBuster] = useState(0);

  const handleClearCache = useCallback(() => {
    clearHexCache();
    setCacheBuster((prev) => prev + 1);
  }, []);

  // USA overview hexes (deterministic, no API call — static county metadata)
  const usaHexes = useMemo(() => generateUSAMapHexes(), []);

  // ── Phase 1: Verify Mireye field catalog on mount ─────────────────────
  useEffect(() => {
    setApiStatus('loading');
    verifyWildfireFields()
      .then((status) => setApiStatus(status))
      .catch(() => setApiStatus('error'));
  }, []);

  // ── Phase 2+3: Fetch hex grid on county change ──────────────────────
  useEffect(() => {
    setHexLoadStatus('loading');
    setApiError(null);

    // Show skeleton immediately while fetching
    setCells(generateHexGridSkeleton(selectedCounty.id));

    fetchHexGrid(selectedCounty.id)
      .then((newCells) => {
        setCells(newCells);
        setHexLoadStatus('ok');

        // Auto-select top risk hex after load
        if (viewMode === 'county') {
          const top = getTopRiskHexes(newCells, 1);
          if (top.length > 0) setSelectedCell(top[0]);
        }
      })
      .catch((err) => {
        console.error('[App] fetchHexGrid failed:', err);
        setApiError(err instanceof Error ? err.message : String(err));
        setHexLoadStatus('error');
        // Keep skeleton on error so UI doesn't break
      });
  }, [selectedCounty.id, cacheBuster]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync selected cell when viewMode changes ───────────────────────────
  useEffect(() => {
    if (viewMode === 'county') {
      const topHexes = getTopRiskHexes(cells, 1);
      if (topHexes.length > 0) {
        setSelectedCell(topHexes[0]);
      } else {
        setSelectedCell(null);
      }
    } else {
      // In USA mode, select top hex of current county
      const countyHexes = usaHexes.filter((h) => h.region === selectedCounty.id);
      if (countyHexes.length > 0) {
        const sorted = [...countyHexes].sort((a, b) => b.ccg - a.ccg);
        setSelectedCell(sorted[0]);
      }
    }
  }, [viewMode, selectedCounty.id, usaHexes]); // omit `cells` to avoid loop

  // The cells currently being visualized
  const activeCells = useMemo(
    () => (viewMode === 'usa' ? usaHexes : cells),
    [viewMode, cells, usaHexes]
  );

  // Display cell (hovered or selected)
  const displayCell = useMemo(() => {
    if (hoveredId) {
      return activeCells.find((c) => c.id === hoveredId) ?? selectedCell;
    }
    return selectedCell;
  }, [hoveredId, activeCells, selectedCell]);

  // ── Phase 4: Reasoning trace from real API metadata ──────────────────
  useEffect(() => {
    if (!selectedCell) {
      setReasoningLines([]);
      return;
    }

    setIsReasoningRunning(true);
    const lines = buildReasoningTrace(selectedCell, selectedCounty);
    setReasoningLines(lines);
    const totalDelay = lines.reduce((sum, l) => sum + l.delay, 0);
    const timer = setTimeout(() => setIsReasoningRunning(false), totalDelay + 200);
    return () => clearTimeout(timer);
  }, [selectedCell, selectedCounty]);

  const handleSelectCell = useCallback(
    (cell: HexCell) => {
      setSelectedCell(cell);
      if (cell.region) {
        const match = COUNTIES.find((c) => c.id === cell.region);
        if (match) {
          setSelectedCounty(match);
          setViewMode('county');
        }
      }
    },
    []
  );

  // ── API status indicator ───────────────────────────────────────────────
  const connectionStatus = useMemo((): 'connected' | 'loading' | 'error' => {
    if (apiStatus === 'error' || hexLoadStatus === 'error') return 'error';
    if (apiStatus === 'loading' || hexLoadStatus === 'loading') return 'loading';
    if (apiStatus === 'ok') return 'connected';
    return 'loading';
  }, [apiStatus, hexLoadStatus]);

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-100">
      <TopNav onHowItWorks={() => setShowHowItWorks(true)} onClearCache={handleClearCache} />

      {/* API Error Banner */}
      {apiError && (
        <div className="flex items-center gap-2 border-b border-red-900/50 bg-red-950/80 px-4 py-2 text-xs text-red-300">
          <span className="font-bold">API Error:</span>
          <span className="font-mono">{apiError}</span>
          <span className="ml-auto text-red-500">Check VITE_MIREYE_API_KEY in .env</span>
        </div>
      )}

      {/* Main split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Control Center */}
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-ink-800 bg-ink-900/50">
          <div className="scroll-thin flex-1 overflow-y-auto p-4">
            {/* Location Selector */}
            <LocationSelector
              counties={COUNTIES}
              selected={selectedCounty}
              isLoading={hexLoadStatus === 'loading'}
              onSelect={(c) => {
                setSelectedCounty(c);
                setViewMode('county');
              }}
            />

            {/* Divider */}
            <div className="my-4 border-t border-ink-800/50" />

            {/* Selected hex header */}
            {displayCell && (
              <div className="mb-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    {hoveredId && hoveredId !== selectedCell?.id ? 'Previewing' : 'Selected Hex'}
                  </span>
                  <div className="flex items-center gap-2">
                    {displayCell.nearestStationSource === 'api' && (
                      <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                        LIVE DATA
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-ink-400">
                      {displayCell.id.toUpperCase().slice(-6)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Metric Cards */}
            <MetricCards cell={displayCell} />

            {/* Divider */}
            <div className="my-4 border-t border-ink-800/50" />

            {/* Physics Breakdown */}
            <PhysicsBreakdown cell={displayCell} />

            {/* Divider */}
            <div className="my-4 border-t border-ink-800/50" />

            {/* AI Reasoning Trace */}
            <AIReasoningTrace lines={reasoningLines} isRunning={isReasoningRunning} />

            {/* Divider */}
            <div className="my-4 border-t border-ink-800/50" />

            {/* Phase 2 Card */}
            <Phase2Card isActive={phase2Active} onToggle={() => setPhase2Active((v) => !v)} />
          </div>
        </aside>

        {/* Right — Map */}
        <main className="relative flex-1 overflow-hidden">
          <GoogleMap
            cells={cells}
            usaCells={usaHexes}
            selectedId={selectedCell?.id ?? null}
            onSelect={handleSelectCell}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            connection={connectionStatus}
            isLoading={hexLoadStatus === 'loading'}
          />
        </main>
      </div>

      {/* How It Works Modal */}
      <HowItWorksModal isOpen={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </div>
  );
}

export default App;
