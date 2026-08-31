import { useState, useMemo } from 'react';
import { GoogleMap } from './GoogleMap';
import { SimulationCanvas } from './SimulationCanvas';
import type { HexCell } from '@/types';
import { Layers, Flame } from 'lucide-react';

interface VisualizerBridgeProps {
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
  visualizerMode: 'gis' | 'simulation';
  onVisualizerModeChange: (mode: 'gis' | 'simulation') => void;
  phase2Active: boolean;
}

export function VisualizerBridge(props: VisualizerBridgeProps) {
  const { visualizerMode, onVisualizerModeChange, ...rest } = props;

  // Shared camera spatial state
  const [cameraState, setCameraState] = useState({
    center: { lat: 37.0902, lng: -95.7129 }, // Center of USA
    zoom: 4,
    heading: 0,
    tilt: 45,
  });

  const selectedCellObj = useMemo(() => {
    if (!props.selectedId) return null;
    return props.cells.find((c) => c.id === props.selectedId) || 
           props.usaCells.find((c) => c.id === props.selectedId) || 
           null;
  }, [props.selectedId, props.cells, props.usaCells]);

  return (
    <div className="relative h-full w-full">
      {visualizerMode === 'gis' ? (
        <GoogleMap
          {...rest}
          cameraState={cameraState}
          onCameraChange={setCameraState}
        />
      ) : (
        <SimulationCanvas
          cells={props.cells}
          selectedCell={selectedCellObj}
          hoveredId={props.hoveredId}
          cameraState={cameraState}
          onCameraChange={setCameraState}
        />
      )}

      {/* Dynamic Visualizer Toggle Panel */}
      <div className="absolute top-4 left-4 z-20 flex rounded-lg border border-ink-800 bg-ink-950/85 p-0.5 backdrop-blur-md">
        <button
          onClick={() => onVisualizerModeChange('gis')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            visualizerMode === 'gis'
              ? 'bg-ink-800 text-ink-100'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Standard 3D Map
        </button>
        <button
          onClick={() => onVisualizerModeChange('simulation')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            visualizerMode === 'simulation'
              ? 'bg-ink-800 text-ink-100'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          <Flame className="h-3.5 w-3.5 text-heat-500" />
          3D Simulation View
        </button>
      </div>
    </div>
  );
}
