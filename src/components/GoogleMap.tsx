import { useEffect, useRef, useState, useMemo } from 'react';
import type { HexCell, County } from '@/types';
import { COUNTIES } from '@/data/hexGrid';
import { MapPin } from 'lucide-react';

interface GoogleMapProps {
  cells: HexCell[];
  usaCells: HexCell[];
  selectedId: string | null;
  onSelect: (cell: HexCell) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  viewMode: 'usa' | 'county';
  onViewModeChange: (mode: 'usa' | 'county') => void;
  connection: 'disconnected' | 'connecting' | 'connected' | 'loading' | 'error';
  isLoading?: boolean;
}

// Risk color mapping matching the CCG theme
function riskColor(ccg: number): string {
  if (ccg >= 0.75) return '#DC2626'; // Severe: Red
  if (ccg >= 0.5) return '#EA580C';  // High: Orange
  if (ccg >= 0.3) return '#F59E0B';  // Elev: Amber
  if (ccg >= 0.15) return '#FBBF24'; // Mod: Yellow
  return '#1E3A5F';                  // Low: Navy Blue
}

function riskOpacity(ccg: number): number {
  if (ccg < 0.1) return 0.1;
  return 0.2 + ccg * 0.5;
}

// Dynamically load Google Maps script
let scriptLoadingPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps) {
    return Promise.resolve();
  }
  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }
  scriptLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const keyParam = apiKey ? `&key=${apiKey}` : '';
    script.src = `https://maps.googleapis.com/maps/api/js?libraries=geometry${keyParam}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });
  return scriptLoadingPromise;
}

export function GoogleMap({
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
}: GoogleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  // Refs for tracking Google Maps overlay objects to clean them up on updates
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const geofencesRef = useRef<google.maps.Polygon[]>([]);

  // Load API script on mount
  useEffect(() => {
    const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';
    loadGoogleMapsScript(apiKey)
      .then(() => setMapsLoaded(true))
      .catch((err) => console.error('[GoogleMap] Load error:', err));
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapsLoaded || !containerRef.current || mapRef.current) return;

    // Deep-slate dark style (used for hybrid/terrain mode features if switched, but satellite by default)
    const darkStyle = [
      { elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#0f172a' }] },
      { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#334155' }] },
      { featureType: 'landscape', stylers: [{ color: '#0f172a' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f172a' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#334155' }] },
      { featureType: 'water', stylers: [{ color: '#1e1b4b' }] }
    ];

    mapRef.current = new google.maps.Map(containerRef.current, {
      center: { lat: 37.0902, lng: -95.7129 }, // Center of USA
      zoom: 4,
      mapTypeId: google.maps.MapTypeId.SATELLITE, // Default to satellite view
      styles: darkStyle,
      disableDefaultUI: false,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.TOP_LEFT,
      },
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });
  }, [mapsLoaded]);

  // Handle updates to Map ViewMode (zoom and center)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (viewMode === 'usa') {
      map.setCenter({ lat: 37.0902, lng: -95.7129 });
      map.setZoom(4);
    } else if (viewMode === 'county' && cells.length > 0) {
      // Find center coordinate of the grid cells
      const lats = cells.map((c) => c.lat).filter((l): l is number => typeof l === 'number');
      const lngs = cells.map((c) => c.lng).filter((l): l is number => typeof l === 'number');
      if (lats.length > 0 && lngs.length > 0) {
        const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length;
        const avgLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
        map.setCenter({ lat: avgLat, lng: avgLng });
        map.setZoom(13); // Zoom to local scale
      }
    }
  }, [viewMode, cells]);

  // Clean overlays helper
  const clearOverlays = () => {
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    geofencesRef.current.forEach((p) => p.setMap(null));
    geofencesRef.current = [];
  };

  // Render Overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapsLoaded) return;

    // Clear previous overlays
    clearOverlays();

    if (viewMode === 'usa') {
      // Render National Overview: 7 pilot counties
      COUNTIES.forEach((county) => {
        if (county.lat === undefined || county.lng === undefined) return;

        // Get county maximum CCG risk
        const countyCells = usaCells.filter((c) => c.region === county.id);
        const maxCcg = countyCells.length > 0 ? Math.max(...countyCells.map((c) => c.ccg)) : 0.5;
        const color = riskColor(maxCcg);

        // County interactive circle
        const circle = new google.maps.Circle({
          strokeColor: color,
          strokeOpacity: 0.8,
          strokeWeight: 1.5,
          fillColor: color,
          fillOpacity: 0.35,
          map,
          center: { lat: county.lat, lng: county.lng },
          radius: 50000, // 50km radius on USA map
          clickable: true,
        });

        // Bridge events to React state
        google.maps.event.addListener(circle, 'mouseover', () => {
          // Find the representative top cell for this county to show in tooltip
          const topCell = countyCells.sort((a, b) => b.ccg - a.ccg)[0];
          if (topCell) {
            onHover(topCell.id);
          }
        });

        google.maps.event.addListener(circle, 'mouseout', () => {
          onHover(null);
        });

        google.maps.event.addListener(circle, 'click', () => {
          onViewModeChange('county');
          const matchedCounty = COUNTIES.find((c) => c.id === county.id);
          if (matchedCounty) {
            // Find a cell in the county grid to auto-select
            const topCell = countyCells.sort((a, b) => b.ccg - a.ccg)[0];
            if (topCell) {
              onSelect(topCell);
            }
          }
        });

        circlesRef.current.push(circle);

        // Text label marker
        const marker = new google.maps.Marker({
          position: { lat: county.lat, lng: county.lng },
          map,
          title: county.name,
          label: {
            text: county.cityName || county.name,
            color: '#ffffff',
            fontWeight: 'bold',
            fontSize: '11px',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 0, // hide dot, only show label
          },
        });

        markersRef.current.push(marker);
      });
    } else if (viewMode === 'county') {
      // Local County View: Render 8x8 circular grid hotspots
      cells.forEach((cell) => {
        if (cell.lat === undefined || cell.lng === undefined) return;

        const isSelected = cell.id === selectedId;
        const isHovered = cell.id === hoveredId;
        const color = riskColor(cell.ccg);
        const opacity = riskOpacity(cell.ccg);

        const circle = new google.maps.Circle({
          strokeColor: isSelected ? '#FFFFFF' : isHovered ? '#CBD5E1' : color,
          strokeOpacity: isSelected ? 1.0 : isHovered ? 0.9 : 0.4,
          strokeWeight: isSelected ? 2.5 : isHovered ? 1.5 : 0.6,
          fillColor: color,
          fillOpacity: opacity,
          map,
          center: { lat: cell.lat, lng: cell.lng },
          radius: 750, // 750m radius (1.5km diameter fits cell spacing)
          clickable: true,
        });

        // Mouse hover interactions
        google.maps.event.addListener(circle, 'mouseover', () => {
          onHover(cell.id);
        });

        google.maps.event.addListener(circle, 'mouseout', () => {
          onHover(null);
        });

        // Click to select
        google.maps.event.addListener(circle, 'click', () => {
          onSelect(cell);
        });

        circlesRef.current.push(circle);

        // If the WUI hotspot is severe, we highlight it as a geofence polygon (Phase 2)
        if (cell.ccg >= 0.7) {
          const sizeOffset = 0.007; // ~750m geofence box around centroid
          const boundsCoords = [
            { lat: cell.lat + sizeOffset, lng: cell.lng - sizeOffset },
            { lat: cell.lat + sizeOffset, lng: cell.lng + sizeOffset },
            { lat: cell.lat - sizeOffset, lng: cell.lng + sizeOffset },
            { lat: cell.lat - sizeOffset, lng: cell.lng - sizeOffset },
          ];

          const geofence = new google.maps.Polygon({
            paths: boundsCoords,
            strokeColor: '#EF4444',
            strokeOpacity: 0.8,
            strokeWeight: 1.5,
            fillColor: '#EF4444',
            fillOpacity: 0.15,
            map: cell.ccg >= 0.7 ? map : null, // render if active geofence
            visible: false, // controlled by phase2Active in parent, we'll bind visibility
          });

          geofencesRef.current.push(geofence);
        }
      });

      // Render Fire Stations within county as markers
      const stationCells = cells.filter((c) => c.staffedStations > 0 && c.rcs > 0.5);
      stationCells.slice(0, 8).forEach((stationCell, i) => {
        if (stationCell.lat === undefined || stationCell.lng === undefined) return;

        // Custom blue icon marker representing USFA station
        const marker = new google.maps.Marker({
          position: { lat: stationCell.lat, lng: stationCell.lng },
          map,
          title: stationCell.nearestStationName || 'Staffed USFA Station',
          icon: {
            path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
            fillColor: '#38BDF8', // Calm utility blue
            fillOpacity: 1.0,
            strokeColor: '#0F172A',
            strokeWeight: 1.5,
            scale: 1.2,
            anchor: new google.maps.Point(12, 24),
          },
        });

        google.maps.event.addListener(marker, 'click', () => {
          const infoWindow = new google.maps.InfoWindow({
            content: `<div class="p-2 text-xs font-sans text-slate-800">
              <strong class="block mb-1 text-slate-900">${stationCell.nearestStationName || 'USFA Fire Station'}</strong>
              <span>Staffed USFA registered facility providing primary response area coverage.</span>
            </div>`,
          });
          infoWindow.open(map, marker);
        });

        markersRef.current.push(marker);
      });
    }

    return () => clearOverlays();
  }, [viewMode, cells, usaCells, selectedId, hoveredId, mapsLoaded]);

  // Hovered Cell computed details
  const hoveredCell = useMemo(() => {
    if (!hoveredId) return null;
    const activeCells = viewMode === 'usa' ? usaCells : cells;
    return activeCells.find((c) => c.id === hoveredId) ?? null;
  }, [hoveredId, viewMode, cells, usaCells]);

  const onMapMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-ink-950 select-none"
      onMouseMove={onMapMouseMove}
    >
      {/* Google Maps Container */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Loading Overlay */}
      {(isLoading || !mapsLoaded) && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-ink-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 animate-spin text-amber-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-semibold text-amber-400">
              {!mapsLoaded ? 'Initializing Google Maps…' : 'Fetching live Mireye data…'}
            </span>
          </div>
          <span className="text-xs text-ink-500">
            {!mapsLoaded ? 'Loading satellite tiles' : 'POST /v1/geocode · /v1/fetch/batch · /v1/proximity'}
          </span>
        </div>
      )}

      {/* Map View Toggle Panel */}
      <div className="absolute top-4 right-4 z-10 flex rounded-lg border border-ink-800 bg-ink-950/85 p-0.5 backdrop-blur-md">
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
        <div className="absolute left-0 right-0 h-32 bg-gradient-to-b from-transparent via-cool-500/5 to-transparent animate-scan" />
      </div>

      {/* Map overlay: legend */}
      <div className="absolute bottom-4 left-4 glass-panel rounded-lg p-3 z-10">
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
      <div className="absolute bottom-4 right-4 glass-panel rounded-lg p-3 z-10">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-[10px] text-ink-400 font-sans">USFA Staffed Station</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-2.5 w-6 rounded bg-red-600/40 border border-red-500" />
          <span className="text-[10px] text-ink-400 font-sans">WUI Hotspot zone</span>
        </div>
      </div>

      {/* Floating Tooltips */}
      {hoveredCell && (
        <div
          className="pointer-events-none absolute z-50 rounded border border-ink-800 bg-ink-950/95 p-3 text-[10px] text-ink-200 shadow-xl shadow-black/80 font-mono w-56 animate-fade-in-fast"
          style={{ left: mouse.x + 16, top: mouse.y + 12 }}
        >
          <div className="font-bold text-ink-100 border-b border-ink-800 pb-1 mb-1">
            {hoveredCell.county || 'Pilot'} County ({hoveredCell.state || 'US'})
          </div>
          <div className="flex justify-between mt-0.5">
            <span>CCG Score:</span>
            <span className="font-bold text-heat-500">{hoveredCell.ccg.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>IPS (Physics):</span>
            <span className="text-heat-400">{hoveredCell.ips.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>RCS (Routing):</span>
            <span className="text-cool-400">{hoveredCell.rcs.toFixed(2)}</span>
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

      {/* Hover hint */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
        <div className="glass-panel-light rounded-full px-4 py-1.5 text-[11px] text-ink-400 backdrop-blur-md">
          {viewMode === 'usa'
            ? 'Hover over county centers or click to select and zoom'
            : 'Hover or click any location zone hotspot to inspect details'}
        </div>
      </div>
    </div>
  );
}
