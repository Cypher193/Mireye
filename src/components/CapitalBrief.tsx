import { useEffect, useState } from 'react';
import type { CapitalBriefResult } from '@/types';
import { FileText, Download, RefreshCw, CheckCircle2, Copy, Check } from 'lucide-react';

interface CapitalBriefProps {
  result: CapitalBriefResult | null;
  isGenerating: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
}

export function CapitalBrief({
  result,
  isGenerating,
  onGenerate,
  canGenerate,
}: CapitalBriefProps) {
  const [displayedParas, setDisplayedParas] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!result) {
      setDisplayedParas([]);
      return;
    }
    setDisplayedParas([]);
    result.paragraphs.forEach((para, i) => {
      setTimeout(() => {
        setDisplayedParas((prev) => [...prev, para]);
      }, 300 + i * 400);
    });
  }, [result]);

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.paragraphs.join('\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const content = [
      `# Executive Capital Allocation Brief`,
      `**Region:** ${result.countyName}`,
      `**Target Hex ID:** ${result.cellId.toUpperCase()}`,
      `**Coverage-Combustibility Gap (CCG):** ${result.ccg.toFixed(3)}`,
      `**Ignition Propensity Score (IPS):** ${result.ips.toFixed(3)}`,
      `**Response Capacity Score (RCS):** ${result.rcs.toFixed(3)}`,
      `**Timestamp:** ${new Date().toLocaleString()}`,
      `\n---\n`,
      result.paragraphs.join('\n\n'),
      `\n---\n`,
      `*Generated deterministically by the CCG Engine utilizing Mireye Earth geospatial telemetry and NFPA 1710 deployment standards.*`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Capital_Brief_${result.countyName.replace(/\s+/g, '_')}_${result.cellId}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-panel-light rounded-lg">
      <div className="flex items-center justify-between border-b border-ink-800/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-heat-500" />
          <span className="text-[11px] font-semibold text-ink-200">
            Capital Brief
          </span>
        </div>
        {result && !isGenerating && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="text-ink-500 transition-colors hover:text-ink-200"
              title={copied ? 'Copied to Clipboard' : 'Copy Brief'}
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={handleDownload}
              className="text-ink-500 transition-colors hover:text-ink-200"
              title="Download Markdown Brief"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={onGenerate}
              className="text-ink-500 transition-colors hover:text-ink-200"
              title="Regenerate"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="p-3">
        {/* Generate Button */}
        {!result && !isGenerating && (
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className={`w-full rounded-md py-2.5 text-xs font-semibold transition-all ${
              canGenerate
                ? 'bg-gradient-to-r from-heat-600 to-heat-700 text-white shadow-lg shadow-heat-700/20 hover:shadow-heat-600/30'
                : 'cursor-not-allowed bg-ink-800 text-ink-500'
            }`}
          >
            {canGenerate ? 'Draft Capital Brief' : 'Select a hex to enable'}
          </button>
        )}

        {/* Loading skeleton */}
        {isGenerating && (
          <div className="space-y-2.5 py-1">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-heat-500 border-t-transparent" />
              <span className="text-[10px] text-ink-400">
                Fusing physics + routing data...
              </span>
            </div>
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-[95%] rounded" />
            <div className="skeleton h-3 w-[88%] rounded" />
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-[90%] rounded" />
            <div className="skeleton h-3 w-[82%] rounded" />
          </div>
        )}

        {/* Result */}
        {result && !isGenerating && (
          <div className="space-y-2.5">
            {/* Brief header */}
            <div className="flex items-center gap-2 border-b border-ink-800/40 pb-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[10px] font-semibold text-ink-300">
                Executive Summary — {result.countyName}
              </span>
            </div>
            {/* Paragraphs with staggered fade-in */}
            {displayedParas.map((para, i) => (
              <p
                key={i}
                className="animate-fade-in text-[10.5px] leading-relaxed text-ink-300"
              >
                {para}
              </p>
            ))}
            {displayedParas.length < result.paragraphs.length && (
              <span className="inline-block h-3 w-1.5 animate-blink bg-heat-500 align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
