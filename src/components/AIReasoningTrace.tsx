import { useEffect, useRef, useState } from 'react';
import type { ReasoningLine } from '@/types';
import { Terminal, Cpu } from 'lucide-react';

interface AIReasoningTraceProps {
  lines: ReasoningLine[];
  isRunning: boolean;
}

export function AIReasoningTrace({ lines, isRunning }: AIReasoningTraceProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(0);
  }, [lines]);

  useEffect(() => {
    if (visibleCount >= lines.length) return;
    const timer = setTimeout(() => {
      setVisibleCount((c) => c + 1);
    }, lines[visibleCount]?.delay ?? 200);
    return () => clearTimeout(timer);
  }, [visibleCount, lines]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleCount]);

  const done = visibleCount >= lines.length && !isRunning;

  return (
    <div className="glass-panel-light overflow-hidden rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-800/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-heat-500" />
          <span className="text-[11px] font-semibold text-ink-200">
            MCP Agent — Reasoning Trace
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              isRunning || !done ? 'bg-heat-500 animate-pulse' : 'bg-emerald-500'
            }`}
          />
          <span className="text-[9px] text-ink-500">
            {isRunning || !done ? 'Processing' : 'Complete'}
          </span>
        </div>
      </div>

      {/* Console */}
      <div
        ref={scrollRef}
        className="scroll-thin h-44 overflow-y-auto bg-ink-950/60 p-3 font-mono text-[10.5px] leading-relaxed"
      >
        {lines.slice(0, visibleCount).map((line, i) => (
          <div
            key={i}
            className="animate-fade-in-fast"
            style={{ animationDelay: '0ms' }}
          >
            {line.type === 'command' && (
              <span className="text-cool-400">{line.text}</span>
            )}
            {line.type === 'result' && (
              <span className="text-ink-300">{line.text}</span>
            )}
            {line.type === 'info' && (
              <span className="text-ink-400">{line.text}</span>
            )}
            {line.type === 'warn' && (
              <span className="text-heat-400">{line.text}</span>
            )}
          </div>
        ))}
        {!done && (
          <span className="inline-block h-3 w-1.5 animate-blink bg-heat-500 align-middle" />
        )}
        {done && (
          <div className="mt-1 flex items-center gap-1.5 text-emerald-500/80">
            <Terminal className="h-3 w-3" />
            <span className="text-[9px]">trace complete — ready for brief generation</span>
          </div>
        )}
      </div>
    </div>
  );
}
