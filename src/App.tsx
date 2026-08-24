import { useState, useMemo, useCallback, useEffect } from 'react';
import { TopNav } from '@/components/TopNav';
import { HexMap } from '@/components/HexMap';
import { MetricCards } from '@/components/MetricCards';
import { AIReasoningTrace } from '@/components/AIReasoningTrace';
import { CapitalBrief } from '@/components/CapitalBrief';
import { LocationSelector } from '@/components/LocationSelector';
import { PhysicsBreakdown } from '@/components/PhysicsBreakdown';
import { Phase2Card } from '@/components/Phase2Card';
import { HowItWorksModal } from '@/components/HowItWorksModal';
import { COUNTIES, generateHexGrid, getTopRiskHexes } from '@/data/hexGrid';
import { buildReasoningTrace, generateCapitalBrief } from '@/data/reasoning';
import type { HexCell, County, ReasoningLine, CapitalBriefResult } from '@/types';

function App() {
  const [activeView, setActiveView] = useState('risk-map');
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [selectedCounty, setSelectedCounty] = useState<County>(COUNTIES[0]);
  const [selectedCell, setSelectedCell] = useState<HexCell | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [reasoningLines, setReasoningLines] = useState<ReasoningLine[]>([]);
  const [isReasoningRunning, setIsReasoningRunning] = useState(false);
  const [briefResult, setBriefResult] = useState<CapitalBriefResult | null>(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [phase2Active, setPhase2Active] = useState(false);

  // Generate hex grid for selected county
  const cells = useMemo(() => generateHexGrid(selectedCounty.id), [selectedCounty.id]);

  // Auto-select top risk hex when county changes
  useEffect(() => {
    const topHexes = getTopRiskHexes(cells, 1);
    if (topHexes.length > 0) {
      setSelectedCell(topHexes[0]);
    } else {
      setSelectedCell(null);
    }
    setBriefResult(null);
  }, [cells]);

  // The "displayed" cell — uses hovered cell if hovering, otherwise selected
  const displayCell = useMemo(() => {
    if (hoveredId) {
      return cells.find((c) => c.id === hoveredId) ?? selectedCell;
    }
    return selectedCell;
  }, [hoveredId, cells, selectedCell]);

  // Run reasoning trace when selected cell changes
  useEffect(() => {
    if (!selectedCell) {
      setReasoningLines([]);
      return;
    }
    setIsReasoningRunning(true);
    setReasoningLines(buildReasoningTrace(selectedCell, selectedCounty));
    // Mark as "done" after all lines should have appeared
    const totalDelay = buildReasoningTrace(selectedCell, selectedCounty).reduce(
      (sum, l) => sum + l.delay,
      0
    );
    const timer = setTimeout(() => setIsReasoningRunning(false), totalDelay + 200);
    return () => clearTimeout(timer);
  }, [selectedCell, selectedCounty]);

  const handleSelectCell = useCallback((cell: HexCell) => {
    setSelectedCell(cell);
    setBriefResult(null);
  }, []);

  const handleGenerateBrief = useCallback(() => {
    if (!selectedCell) return;
    setIsGeneratingBrief(true);
    setBriefResult(null);
    // Simulate physics computation time
    setTimeout(() => {
      const result = generateCapitalBrief(selectedCell, selectedCounty);
      setBriefResult(result);
      setIsGeneratingBrief(false);
    }, 2200);
  }, [selectedCell, selectedCounty]);

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-ink-100">
      <TopNav
        activeView={activeView}
        onViewChange={setActiveView}
        onHowItWorks={() => setShowHowItWorks(true)}
      />

      {/* Main split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Control Center */}
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-ink-800 bg-ink-900/50">
          <div className="scroll-thin flex-1 overflow-y-auto p-4">
            {/* Location Selector */}
            <LocationSelector
              counties={COUNTIES}
              selected={selectedCounty}
              onSelect={(c) => {
                setSelectedCounty(c);
                setBriefResult(null);
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
                  <span className="font-mono text-[10px] text-ink-400">
                    {displayCell.id.toUpperCase().slice(-6)}
                  </span>
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

            {/* Capital Brief */}
            <CapitalBrief
              result={briefResult}
              isGenerating={isGeneratingBrief}
              onGenerate={handleGenerateBrief}
              canGenerate={!!selectedCell}
            />

            {/* Divider */}
            <div className="my-4 border-t border-ink-800/50" />

            {/* Phase 2 Card */}
            <Phase2Card isActive={phase2Active} onToggle={() => setPhase2Active((v) => !v)} />
          </div>
        </aside>

        {/* Right — Map */}
        <main className="relative flex-1 overflow-hidden">
          <HexMap
            cells={cells}
            selectedId={selectedCell?.id ?? null}
            onSelect={handleSelectCell}
            hoveredId={hoveredId}
            onHover={setHoveredId}
          />
        </main>
      </div>

      {/* How It Works Modal */}
      <HowItWorksModal isOpen={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </div>
  );
}

export default App;
