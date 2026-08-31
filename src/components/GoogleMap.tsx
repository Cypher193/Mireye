import { useEffect, useRef, useState, useMemo } from 'react';
import type { HexCell, County } from '@/types';
import * as THREE from 'three';
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
  phase2Active: boolean;
  cameraState?: {
    center: { lat: number; lng: number };
    zoom: number;
    heading: number;
    tilt: number;
  };
  onCameraChange?: (state: {
    center: { lat: number; lng: number };
    zoom: number;
    heading: number;
    tilt: number;
  }) => void;
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
  phase2Active,
  cameraState,
  onCameraChange,
}: GoogleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  // Refs for tracking Google Maps overlay objects to clean them up on updates
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const geofencesRef = useRef<google.maps.Polygon[]>([]);

  // Derived unique list of fire stations serving the county cells
  const fireStations = useMemo(() => {
    const stationsMap = new Map<string, { name: string; lat: number; lng: number }>();
    cells.forEach((cell) => {
      if (cell.nearestStationName && cell.nearestStationLat && cell.nearestStationLng) {
        const key = `${cell.nearestStationName}_${cell.nearestStationLat.toFixed(5)}_${cell.nearestStationLng.toFixed(5)}`;
        if (!stationsMap.has(key)) {
          stationsMap.set(key, {
            name: cell.nearestStationName,
            lat: cell.nearestStationLat,
            lng: cell.nearestStationLng,
          });
        }
      }
    });
    return Array.from(stationsMap.values());
  }, [cells]);

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

    // Premium light map style matching the white/slate theme
    const lightStyle = [
      { elementType: 'geometry', stylers: [{ color: '#f8fafc' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
      { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#cbd5e1' }] },
      { featureType: 'landscape', stylers: [{ color: '#f8fafc' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e2e8f0' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f1f5f9' }] },
      { featureType: 'water', stylers: [{ color: '#e0f2fe' }] }
    ];

    mapRef.current = new google.maps.Map(containerRef.current, {
      center: cameraState?.center ?? { lat: 37.0902, lng: -95.7129 },
      zoom: cameraState?.zoom ?? 4,
      heading: cameraState?.heading ?? 0,
      tilt: cameraState?.tilt ?? 45,
      mapTypeId: google.maps.MapTypeId.ROADMAP, // Light roadmap by default
      mapId: 'DEMO_MAP_ID', // Enable Vector Rendering engine for WebGLOverlayView
      renderingType: 'VECTOR',
      styles: lightStyle,
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

  // Bind camera change listeners to map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onCameraChange) return;

    let timeoutId: number;

    const onMapCameraChange = () => {
      // Debounce updates to avoid excessive state setting
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const center = map.getCenter();
        onCameraChange({
          center: { lat: center?.lat() ?? 37, lng: center?.lng() ?? -95 },
          zoom: map.getZoom() ?? 4,
          heading: map.getHeading() ?? 0,
          tilt: map.getTilt() ?? 0,
        });
      }, 50);
    };

    const listeners = [
      map.addListener('center_changed', onMapCameraChange),
      map.addListener('zoom_changed', onMapCameraChange),
      map.addListener('heading_changed', onMapCameraChange),
      map.addListener('tilt_changed', onMapCameraChange),
    ];

    return () => {
      window.clearTimeout(timeoutId);
      listeners.forEach((l) => l.remove());
    };
  }, [mapsLoaded, onCameraChange]);

  // Update map camera settings when prop change is significant
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraState) return;

    const currentCenter = map.getCenter();
    const latDiff = Math.abs((currentCenter?.lat() ?? 0) - cameraState.center.lat);
    const lngDiff = Math.abs((currentCenter?.lng() ?? 0) - cameraState.center.lng);
    const zoomDiff = Math.abs((map.getZoom() ?? 0) - cameraState.zoom);
    const headingDiff = Math.abs((map.getHeading() ?? 0) - cameraState.heading);
    const tiltDiff = Math.abs((map.getTilt() ?? 0) - cameraState.tilt);

    if (latDiff > 0.0001 || lngDiff > 0.0001 || zoomDiff > 0.1 || headingDiff > 1 || tiltDiff > 1) {
      map.setOptions({
        center: cameraState.center,
        zoom: cameraState.zoom,
        heading: cameraState.heading,
        tilt: cameraState.tilt,
      });
    }
  }, [cameraState]);

  // Method 1: WebGLOverlayView rendering a 3D tactical cone on selected/high-risk hotspots
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapsLoaded) return;

    let overlay: google.maps.WebGLOverlayView | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    const meshGroup = new THREE.Group();

    overlay = new google.maps.WebGLOverlayView();

    overlay.onAdd = () => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera();
      
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);
      
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
      dirLight.position.set(0, 10, 0);
      scene.add(dirLight);

      scene.add(meshGroup);
    };

    overlay.onContextRestored = ({ gl }) => {
      renderer = new THREE.WebGLRenderer({
        canvas: gl.canvas,
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
    };

    overlay.onRemove = () => {
      // Clean up ThreeJS renderer and materials on unmount/removal
      if (renderer) {
        renderer.dispose();
      }
    };

    overlay.onDraw = ({ transformer }) => {
      if (!scene || !camera || !renderer) return;

      meshGroup.clear();

      if (viewMode === 'county' && cells.length > 0) {
        cells.forEach((cell) => {
          if (cell.lat === undefined || cell.lng === undefined) return;

          // For the selected hex, display a rotating tactical wireframe cone
          if (cell.id === selectedId) {
            const geometry = new THREE.ConeGeometry(300, 800, 6);
            const material = new THREE.MeshBasicMaterial({
              color: 0xf59e0b, // Amber glow matching elevated risk
              wireframe: true,
              transparent: true,
              opacity: 0.8,
            });
            const cone = new THREE.Mesh(geometry, material);

            const position = transformer.fromLatLngAltitude({
              lat: cell.lat,
              lng: cell.lng,
              altitude: 400, // Position centroid above terrain
            });

            cone.position.set(position[0], position[1], position[2]);
            cone.rotation.y = (Date.now() * 0.001) % (Math.PI * 2);
            cone.rotation.x = Math.PI; // Invert to point downwards like a target locator
            meshGroup.add(cone);
          }
        });
      }

      // Synchronize ThreeJS camera projections if vector engine parameters are ready
      const camParams = transformer.getCameraParams() as any;
      if (camParams && camParams.projectionMatrix && camParams.viewMatrix) {
        camera.projectionMatrix.fromArray(camParams.projectionMatrix);
        camera.matrixWorldInverse.fromArray(camParams.viewMatrix);
        camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
      }

      renderer.resetState();
      renderer.render(scene, camera);
      
      overlay?.requestRedraw();
    };

    overlay.setMap(map);

    return () => {
      if (overlay) {
        overlay.setMap(null);
      }
    };
  }, [viewMode, cells, selectedId, mapsLoaded]);

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
            visible: phase2Active, // Bind visibility to phase2Active state
          });

          geofencesRef.current.push(geofence);
        }
      });

      // Render Fire Stations within county as markers
      fireStations.forEach((station) => {
        // Custom marker representing USFA station
        const marker = new google.maps.Marker({
          position: { lat: station.lat, lng: station.lng },
          map,
          title: station.name,
          icon: {
            path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
            fillColor: '#0EA5E9', // Slate-blue beacon
            fillOpacity: 1.0,
            strokeColor: '#FFFFFF',
            strokeWeight: 1.5,
            scale: 1.2,
            anchor: new google.maps.Point(12, 24),
          },
        });

        // Store station name on marker for hover listener mapping
        (marker as any).stationName = station.name;

        google.maps.event.addListener(marker, 'click', () => {
          const infoWindow = new google.maps.InfoWindow({
            content: `<div class="p-2 text-xs font-sans text-slate-800">
              <strong class="block mb-1 text-slate-900">${station.name}</strong>
              <span>Staffed USFA registered facility providing primary response area coverage.</span>
            </div>`,
          });
          infoWindow.open(map, marker);
        });

        markersRef.current.push(marker);
      });
    }

    return () => clearOverlays();
  }, [viewMode, cells, usaCells, selectedId, hoveredId, mapsLoaded, fireStations, phase2Active]);

  // Highlight and animate nearest fire station marker on cell hover
  useEffect(() => {
    const activeHoveredCell = cells.find((c) => c.id === hoveredId);
    markersRef.current.forEach((marker) => {
      const stationName = (marker as any).stationName;
      if (activeHoveredCell && activeHoveredCell.nearestStationName === stationName) {
        // Highlight nearest station by bouncing
        marker.setAnimation(google.maps.Animation.BOUNCE);
        // Show response time label overlay
        const time = activeHoveredCell.driveTimeMin.toFixed(1);
        marker.setLabel({
          text: `${time} min`,
          color: '#EA580C',
          fontWeight: 'bold',
          fontSize: '11px',
        });
      } else {
        // Reset marker animation and label
        marker.setAnimation(null);
        marker.setLabel(null);
      }
    });
  }, [hoveredId, cells]);

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
