import { Hexagon, Radio, ChevronDown } from 'lucide-react';

interface TopNavProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onHowItWorks: () => void;
}

const NAV_LINKS = [
  { id: 'risk-map', label: 'Risk Map' },
  { id: 'capital-briefs', label: 'Capital Briefs' },
  { id: 'fire-sim', label: 'Active Fire Simulation (Beta)' },
  { id: 'validation', label: 'Validation' },
];

export function TopNav({ activeView, onViewChange, onHowItWorks }: TopNavProps) {
  return (
    <header className="relative z-30 flex h-14 items-center justify-between border-b border-ink-800 bg-ink-950/80 px-4 backdrop-blur-md lg:px-6">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <Hexagon className="h-7 w-7 text-heat-500" strokeWidth={1.5} />
          <Hexagon
            className="absolute inset-0 h-7 w-7 text-heat-400/40 animate-glow-pulse"
            strokeWidth={1.5}
          />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold tracking-tight text-ink-100">
            CCG <span className="text-heat-500">Engine</span>
          </span>
          <span className="text-[10px] font-medium text-ink-500">
            Coverage-Combustibility Gap
          </span>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="hidden items-center gap-1 lg:flex">
        {NAV_LINKS.map((link) => (
          <button
            key={link.id}
            onClick={() => onViewChange(link.id)}
            className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeView === link.id
                ? 'text-ink-100'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {link.label}
            {link.id === 'fire-sim' && (
              <span className="ml-1.5 rounded bg-heat-700/30 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-heat-400">
                Beta
              </span>
            )}
            {activeView === link.id && (
              <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-heat-500" />
            )}
          </button>
        ))}
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onHowItWorks}
          className="hidden rounded-md border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100 md:block"
        >
          How it Works
        </button>
        <button className="group flex items-center gap-2 rounded-md bg-gradient-to-r from-cool-600 to-cool-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-cool-600/20 transition-all hover:shadow-cool-500/30">
          <Radio className="h-3.5 w-3.5" />
          Connect Mireye API
          <ChevronDown className="h-3 w-3 opacity-60 transition-transform group-hover:translate-y-0.5" />
        </button>
      </div>
    </header>
  );
}
