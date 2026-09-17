import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, MapPin, Check, Loader2, Search } from 'lucide-react';
import type { County } from '@/types';

interface LocationSelectorProps {
  counties: County[];
  selected: County;
  onSelect: (county: County) => void;
  /** When true, shows a loading spinner indicating hex data is fetching */
  isLoading?: boolean;
}

export function LocationSelector({
  counties,
  selected,
  onSelect,
  isLoading = false,
}: LocationSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    } else {
      setSearch('');
    }
  }, [open]);

  const filteredCounties = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return counties;
    return counties.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.state.toLowerCase().includes(q) ||
        (c.cityName && c.cityName.toLowerCase().includes(q))
    );
  }, [counties, search]);

  return (
    <div ref={ref} className="relative">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          Select State / County ({counties.length} Available)
        </label>
        {isLoading && (
          <span className="flex items-center gap-1 text-[9px] text-amber-400">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Fetching live data…
          </span>
        )}
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isLoading}
        className={`flex w-full items-center justify-between rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2.5 text-left transition-colors hover:border-ink-600 disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          ) : (
            <MapPin className="h-4 w-4 text-heat-500" />
          )}
          <div>
            <div className="text-sm font-semibold text-ink-100">
              {selected.name}, {selected.state}
            </div>
            <div className="text-[9px] text-ink-500">
              {selected.cityName ? `${selected.cityName} · ` : ''}
              {selected.wuiHousingUnits.toLocaleString()} WUI units ·{' '}
              {selected.fireDistricts} districts
              {selected.lat && (
                <span className="ml-1 text-emerald-500">
                  · {selected.lat.toFixed(3)}, {selected.lng!.toFixed(3)}
                </span>
              )}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-2xl shadow-black/60 animate-slide-down">
          {/* Search filter input */}
          <div className="border-b border-ink-800 p-2">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-ink-500" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search state, county, or city..."
                className="w-full rounded-md border border-ink-700 bg-ink-900 py-1.5 pl-8 pr-3 text-xs text-ink-200 placeholder-ink-500 focus:border-heat-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-ink-800/40">
            {filteredCounties.length === 0 ? (
              <div className="p-3 text-center text-xs text-ink-500">
                No matching regions found for "{search}"
              </div>
            ) : (
              filteredCounties.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelect(c);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-ink-800 ${
                    c.id === selected.id ? 'bg-ink-800/50' : ''
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-ink-100">
                      {c.name}{' '}
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[9px] text-sky-400">
                        {c.state}
                      </span>
                    </div>
                    <div className="text-[9px] text-ink-500">
                      {c.cityName ? `${c.cityName} · ` : ''}
                      {c.wuiHousingUnits.toLocaleString()} WUI units
                    </div>
                  </div>
                  {c.id === selected.id && <Check className="h-3.5 w-3.5 text-heat-500" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
