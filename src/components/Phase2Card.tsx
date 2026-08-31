import { useState } from 'react';
import { Flame, ShieldAlert, Radio, MapPin, X, Copy, Download, Check } from 'lucide-react';
import { generateCAPAlertXML } from '@/lib/capGenerator';
import type { HexCell } from '@/types';

interface Phase2CardProps {
  isActive: boolean;
  onToggle: () => void;
  cells: HexCell[];
  countyName: string;
}

export function Phase2Card({ isActive, onToggle, cells, countyName }: Phase2CardProps) {
  const [showCAPModal, setShowCAPModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const xmlContent = generateCAPAlertXML(cells, countyName);

  const handleCopy = () => {
    navigator.clipboard.writeText(xmlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cap_alert_${countyName.toLowerCase().replace(/\s+/g, '_')}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
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
                Active capabilities enabled — NFPA-1 resource matching and alert feeds compiled.
              </p>
              <div className="space-y-1.5">
                {[
                  { icon: MapPin, text: 'Historical Spread Simulation (CAL FIRE verified)' },
                  { icon: ShieldAlert, text: 'Apparatus Recommendations based on NFPA-1' },
                  { icon: Radio, text: 'Generate CAP 1.2 Alert Feed', action: () => setShowCAPModal(true) },
                ].map((f, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-md bg-ink-850/50 px-2 py-1.5 ${f.action ? 'cursor-pointer hover:bg-ink-800/60 transition-colors' : ''}`}
                    onClick={f.action}
                  >
                    <div className="flex items-center gap-2">
                      <f.icon className="h-3 w-3 shrink-0 text-heat-400" />
                      <span className="text-[10px] text-ink-300">{f.text}</span>
                    </div>
                    {f.action && (
                      <span className="rounded bg-heat-600/35 px-1 py-0.5 text-[7.5px] font-bold text-heat-400 uppercase tracking-wide">
                        Configure
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-heat-500" />
                <span className="text-[9px] text-ink-500">Alert feeds monitoring severe grids...</span>
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

      {/* CAP XML Feed Modal */}
      {showCAPModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in font-sans">
          <div className="relative w-full max-w-2xl rounded-lg border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur-md">
            
            <button
              onClick={() => setShowCAPModal(false)}
              className="absolute right-4 top-4 rounded border border-slate-200 p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 uppercase tracking-wide">
                <Radio className="h-4.5 w-4.5 text-heat-500" />
                OASIS CAP 1.2 Emergency Feed
              </h3>
              <p className="mt-1 text-[10.5px] text-slate-500 leading-normal">
                Standard Common Alerting Protocol feed containing active WUI geofence polygons for <strong>{countyName}</strong>, compliant with FEMA IPAWS dispatch specifications.
              </p>
            </div>

            {/* XML Feed Body */}
            <div className="mb-4 max-h-[300px] overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[9px] text-slate-700 leading-relaxed scrollbar-thin">
              <pre className="whitespace-pre-wrap">{xmlContent}</pre>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 text-xs">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy to Clipboard
                  </>
                )}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded bg-heat-600 px-3 py-1.5 font-semibold text-white hover:bg-heat-700"
              >
                <Download className="h-3.5 w-3.5" /> Download XML Feed
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
