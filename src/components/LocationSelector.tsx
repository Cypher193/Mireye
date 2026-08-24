import { useState, useRef, useEffect } from 'react';
import { ChevronDown, MapPin, Check } from 'lucide-react';
import type { County } from '@/types';

interface LocationSelectorProps {
  counties: County[];
  selected: County;
  onSelect: (county: County) => void;
}

export function LocationSelector({ counties, selected, onSelect }: LocationSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        Select County / District
      </label>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2.5 text-left transition-colors hover:border-ink-600"
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-heat-500" />
          <div>
            <div className="text-sm font-semibold text-ink-100">{selected.name}</div>
            <div className="text-[9px] text-ink-500">
              {selected.state} · {selected.wuiHousingUnits.toLocaleString()} WUI units · {selected.fireDistricts} districts
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-xl shadow-black/40 animate-slide-down">
          {counties.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-ink-800 ${
                c.id === selected.id ? 'bg-ink-800/50' : ''
              }`}
            >
              <div>
                <div className="text-sm font-medium text-ink-100">{c.name}</div>
                <div className="text-[9px] text-ink-500">
                  {c.state} · {c.wuiHousingUnits.toLocaleString()} WUI units
                </div>
              </div>
              {c.id === selected.id && <Check className="h-3.5 w-3.5 text-heat-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
