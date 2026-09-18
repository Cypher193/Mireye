import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer';
import type { HexCell } from '@/types';
import { Play, Square, RotateCcw, Wind, Shield, Flame, Layers, CloudSun, RefreshCw, Zap, Cpu, Database } from 'lucide-react';
import { computePredictiveSpread } from '@/lib/predictiveSim';
import { modelLoader, type ModelStatus } from '@/lib/ml/modelLoader';
import {
  loadCachedSatelliteTexture,
  getCachedTerrainGeometry,
  setCachedTerrainGeometry,
  RenderController,
} from '@/services/renderCache';
import {
  getWebGPUStatus,
  createWebGPUParticlePipeline,
  createWebGPUFireSpreadPipeline,
  type WebGPUStatus,
  type WebGPUParticlePipeline,
  type WebGPUFireSpreadPipeline,
} from '@/services/webGpuCompute';

interface SimulationCanvasProps {
  cells: HexCell[];
  selectedCell: HexCell | null;
  hoveredId: string | null;
  blendAlpha?: number;
  cameraState: {
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

// Convert geodetic coordinates (WSG84) to ECEF (Earth-Centered, Earth-Fixed) Cartesian
function latLngToECEF(lat: number, lng: number, alt: number = 0): THREE.Vector3 {
  const radLat = (lat * Math.PI) / 180;
  const radLng = (lng * Math.PI) / 180;

  const a = 6378137.0; // semi-major axis in meters
  const f = 1.0 / 298.257223563; // flattening factor
  const e2 = 2 * f - f * f; // eccentricity squared

  const N = a / Math.sqrt(1.0 - e2 * Math.sin(radLat) * Math.sin(radLat));

  const x = (N + alt) * Math.cos(radLat) * Math.cos(radLng);
  const y = (N + alt) * Math.cos(radLat) * Math.sin(radLng);
  const z = (N * (1.0 - e2) + alt) * Math.sin(radLat);

  return new THREE.Vector3(x, y, z);
}

// Construct rigorous geodetic ENU (East-North-Up) rotation matrix:
// Local +X = East, Local +Y = Up (Zenith), Local -Z = North (Forward).
// This guarantees that North is strictly aligned with -Z across all 50 states,
// preventing longitude-dependent rotation and the 90-degree disorientation bug.
function getECEFtoLocalMatrix(lat: number, lng: number): THREE.Matrix4 {
  const radLat = (lat * Math.PI) / 180;
  const radLng = (lng * Math.PI) / 180;

  const sinLat = Math.sin(radLat);
  const cosLat = Math.cos(radLat);
  const sinLng = Math.sin(radLng);
  const cosLng = Math.cos(radLng);

  // East = [-sinLng, cosLng, 0] -> maps to local +X [1, 0, 0]
  // Up   = [cosLat*cosLng, cosLat*sinLng, sinLat] -> maps to local +Y [0, 1, 0]
  // North = [-sinLat*cosLng, -sinLat*sinLng, cosLat] -> maps to local -Z [0, 0, -1]
  const m = new THREE.Matrix4();
  m.set(
    -sinLng, cosLng, 0, 0,
    cosLat * cosLng, cosLat * sinLng, sinLat, 0,
    sinLat * cosLng, sinLat * sinLng, -cosLat, 0,
    0, 0, 0, 1
  );
  return m;
}

export function SimulationCanvas({
  cells,
  selectedCell,
  hoveredId,
  blendAlpha = 0.4,
  cameraState,
  onCameraChange,
}: SimulationCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const tilesRendererRef = useRef<TilesRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const stationBeaconsRef = useRef<{ name: string; mesh: THREE.Mesh; initialY: number }[]>([]);

  const [simMode, setSimMode] = useState<'historical' | 'predictive'>('predictive');
  const simModeRef = useRef(simMode);
  useEffect(() => {
    simModeRef.current = simMode;
  }, [simMode]);

  const cellPositionsRef = useRef<Record<string, THREE.Vector3>>({});
  const cellMeshesRef = useRef<{ id: string; cylinder: THREE.Mesh; ring: THREE.Mesh; baseColor: number }[]>([]);
  const historicalLineGroupRef = useRef<THREE.Group | null>(null);
  const historicalLocalPointsRef = useRef<THREE.Vector3[]>([]);
  const targetLookAtRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const isPanningToTargetRef = useRef<boolean>(false);

  // WebGPU & 3D Render Caching Telemetry
  const [webgpuStatus, setWebgpuStatus] = useState<WebGPUStatus | null>(null);
  const [computeLatency, setComputeLatency] = useState<number | null>(null);
  const [isSatelliteCached, setIsSatelliteCached] = useState<boolean>(false);
  const webgpuPipelineRef = useRef<WebGPUParticlePipeline | null>(null);
  const webgpuSpreadPipelineRef = useRef<WebGPUFireSpreadPipeline | null>(null);
  const renderControllerRef = useRef<RenderController>(new RenderController());

  // Detect WebGPU hardware adapter on mount
  useEffect(() => {
    getWebGPUStatus().then(setWebgpuStatus);
  }, []);

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

  // Sync refs to make them accessible inside requestAnimationFrame animate loop
  const hoveredIdRef = useRef<string | null>(null);
  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  const cellsRef = useRef<HexCell[]>(cells);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  // Simulation parameters
  const [isPlaying, setIsPlaying] = useState(false);
  const [simTime, setSimTime] = useState(0);
  const [windAngle, setWindAngle] = useState(45); // Degrees (0 = North, 90 = East)
  const [windSpeed, setWindSpeed] = useState(15); // mph

  // Dynamic ML Model (FireSenseNet / Custom ONNX)
  const [modelStatus, setModelStatus] = useState<ModelStatus>(modelLoader.getStatus());
  const enhancedIPSRef = useRef<number[]>([]);

  useEffect(() => {
    return modelLoader.subscribe((s) => {
      setModelStatus(s);
      if (cells.length > 0) {
        const idx = selectedCell ? cells.findIndex((c) => c.id === selectedCell.id) : -1;
        const ignitionIdx = idx >= 0 ? idx : null;
        modelLoader.runInference(cells, windAngle, windSpeed, ignitionIdx)
          .then((res) => {
            enhancedIPSRef.current = res.enhancedIPS;
          })
          .catch((err) => console.warn('[SimulationCanvas] ML inference error:', err));
      }
    });
  }, [cells, windAngle, windSpeed, selectedCell]);

  useEffect(() => {
    if (cells.length === 0) return;
    const idx = selectedCell ? cells.findIndex((c) => c.id === selectedCell.id) : -1;
    const ignitionIdx = idx >= 0 ? idx : null;
    modelLoader.runInference(cells, windAngle, windSpeed, ignitionIdx)
      .then((res) => {
        enhancedIPSRef.current = res.enhancedIPS;
      })
      .catch((err) => console.warn('[SimulationCanvas] ML inference error:', err));
  }, [cells, windAngle, windSpeed, selectedCell]);

  // Real-time meteorological data (Open-Meteo / NOAA surface data)
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [weatherData, setWeatherData] = useState<{
    temperatureF?: number;
    humidity?: number;
    windSpeedMph?: number;
    windDirection?: number;
    lastUpdated?: string;
  } | null>(null);

  // Track coordinates for current county center (falls back to first cell or Boulder CO)
  const firstValidCell = cells.find((c) => c.lat !== undefined && c.lng !== undefined);
  const centerCoord = {
    lat: selectedCell?.lat ?? firstValidCell?.lat ?? 40.015,
    lng: selectedCell?.lng ?? firstValidCell?.lng ?? -105.271,
  };

  const fetchLiveWeather = useCallback(async () => {
    const lat = selectedCell?.lat ?? centerCoord.lat;
    const lng = selectedCell?.lng ?? centerCoord.lng;
    if (lat === undefined || lng === undefined) return;

    setIsFetchingWeather(true);
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
      );
      if (!res.ok) throw new Error(`Weather API returned ${res.status}`);
      const data = (await res.json()) as {
        current?: {
          temperature_2m?: number;
          relative_humidity_2m?: number;
          wind_speed_10m?: number;
          wind_direction_10m?: number;
        };
      };
      if (data.current) {
        const cur = data.current;
        const spd = Math.round(cur.wind_speed_10m ?? 15);
        const dir = Math.round(cur.wind_direction_10m ?? 45);
        setWindSpeed(spd);
        setWindAngle(dir);
        setWeatherData({
          temperatureF: Math.round(cur.temperature_2m ?? 70),
          humidity: Math.round(cur.relative_humidity_2m ?? 40),
          windSpeedMph: spd,
          windDirection: dir,
          lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }
    } catch (err) {
      console.warn('[SimulationCanvas] Live weather fetch failed:', err);
    } finally {
      setIsFetchingWeather(false);
    }
  }, [selectedCell?.lat, selectedCell?.lng, centerCoord.lat, centerCoord.lng]);

  // Automatically fetch live weather whenever county/selected hex changes
  useEffect(() => {
    fetchLiveWeather();
  }, [selectedCell?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Particle systems for fire/smoke simulation
  const fireParticlesRef = useRef<THREE.Points | null>(null);
  const smokeParticlesRef = useRef<THREE.Points | null>(null);
  const fireGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const smokeGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const particleCount = 800;

  // Initializing three.js
  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // 1. Scene setup (Atmospheric Twilight Sky & Light Horizon Fog)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#080e1e'); // Deep space twilight
    scene.fog = new THREE.FogExp2('#0a1329', 0.000018); // Soft distant horizon haze
    sceneRef.current = scene;

    // 2. Camera setup - Positioned to frame the entire county grid at a 40-degree panoramic angle
    const camera = new THREE.PerspectiveCamera(50, width / height, 10, 60000);
    camera.position.set(0, 4500, 6500);
    cameraRef.current = camera;

    // 3. Renderer setup (Full Direct & Ambient Illumination without dark shadow artifacts)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Vibrant Atmospheric Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    // Warm sun directional illumination
    const sunLight = new THREE.DirectionalLight(0xfff8ee, 1.15);
    sunLight.position.set(8000, 15000, 8000);
    scene.add(sunLight);

    // Hemisphere sky bounce (sky blue from above, warm earth from below)
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.55);
    scene.add(hemiLight);

    // 5. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.maxPolarAngle = Math.PI / 2.15; // Don't go below ground level
    controls.minDistance = 250;
    controls.maxDistance = 50000;
    controlsRef.current = controls;

    // Immediately stop programmatic lerping when the user initiates manual interaction
    controls.addEventListener('start', () => {
      isPanningToTargetRef.current = false;
      renderControllerRef.current.keepAlive(30);
    });

    controls.addEventListener('change', () => {
      renderControllerRef.current.markDirty();
    });

    // Notify camera change on user interaction end to avoid 60fps render thrashing
    controls.addEventListener('end', () => {
      renderControllerRef.current.markDirty();
      if (onCameraChange) {
        const localVec = camera.position.clone().sub(controls.target);
        onCameraChange({
          center: centerCoord,
          zoom: Math.round(15 - Math.log2(localVec.length() / 100)),
          heading: 0, // Lock strictly to 0 to prevent 90-degree map rotation
          tilt: Math.round(controls.getPolarAngle() * (180 / Math.PI)),
        });
      }
    });

    // 6. Architecture A: High-Resolution Satellite-Draped Topography (ESRI World Imagery)
    // Compute county bounding box with 35% spatial padding for natural mountain ridge context
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    cells.forEach((c) => {
      if (c.lat !== undefined && c.lng !== undefined) {
        minLat = Math.min(minLat, c.lat);
        maxLat = Math.max(maxLat, c.lat);
        minLng = Math.min(minLng, c.lng);
        maxLng = Math.max(maxLng, c.lng);
      }
    });

    if (minLat > maxLat) {
      minLat = centerCoord.lat - 0.15;
      maxLat = centerCoord.lat + 0.15;
      minLng = centerCoord.lng - 0.15;
      maxLng = centerCoord.lng + 0.15;
    }

    const padLat = Math.max(0.04, (maxLat - minLat) * 0.35);
    const padLng = Math.max(0.04, (maxLng - minLng) * 0.35);
    const bbox = {
      minLng: (minLng - padLng).toFixed(5),
      minLat: (minLat - padLat).toFixed(5),
      maxLng: (maxLng + padLng).toFixed(5),
      maxLat: (maxLat + padLat).toFixed(5),
    };

    // Calculate county orientation matrix & local offset
    const poiECEF = latLngToECEF(centerCoord.lat, centerCoord.lng, 0);
    const enuMatrix = getECEFtoLocalMatrix(centerCoord.lat, centerCoord.lng);
    const enuRotation = new THREE.Quaternion().setFromRotationMatrix(enuMatrix);
    const offset = poiECEF.clone().applyQuaternion(enuRotation).negate();

    // Map bounding box corners to local ENU Cartesian coordinates (East=+X, North=-Z)
    const swECEF = latLngToECEF(Number(bbox.minLat), Number(bbox.minLng), 0);
    const neECEF = latLngToECEF(Number(bbox.maxLat), Number(bbox.maxLng), 0);
    const swLocal = swECEF.applyQuaternion(enuRotation).add(offset);
    const neLocal = neECEF.applyQuaternion(enuRotation).add(offset);

    const minX = Math.min(swLocal.x, neLocal.x);
    const maxX = Math.max(swLocal.x, neLocal.x);
    const minZ = Math.min(swLocal.z, neLocal.z);
    const maxZ = Math.max(swLocal.z, neLocal.z);

    const terrainWidth = Math.max(26000, maxX - minX);
    const terrainDepth = Math.max(26000, maxZ - minZ);
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;

    // Elevation calculation function conforming all objects (cells, stations, lines) to topography
    const getTerrainElevation = (wx: number, wz: number): number => {
      const h1 = Math.sin(wx * 0.00014 + 0.5) * Math.cos(wz * 0.00014 + 0.3) * 350;
      const h2 = Math.sin(wx * 0.00042 * 1.5 - wz * 0.00042 * 0.8) * 120;
      const h3 = Math.cos(wx * 0.0011 + wz * 0.0011 * 1.2) * 40;
      return h1 + h2 + h3;
    };

    // Tier 2 Cache: Check Topography Geometry Memory Pool
    const countyId = selectedCell?.region ?? cells[0]?.region ?? 'county';
    const geomCacheKey = `${countyId}_${terrainWidth.toFixed(0)}_${terrainDepth.toFixed(0)}`;
    let terrainGeom = getCachedTerrainGeometry(geomCacheKey);

    if (!terrainGeom) {
      terrainGeom = new THREE.PlaneGeometry(terrainWidth, terrainDepth, 120, 120);
      terrainGeom.rotateX(-Math.PI / 2); // Rotate to horizontal XZ plane

      const posAttr = terrainGeom.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const wx = midX + vx;
        const wz = midZ + vz;
        posAttr.setY(i, getTerrainElevation(wx, wz) - 15);
      }
      terrainGeom.computeVertexNormals();
      setCachedTerrainGeometry(geomCacheKey, terrainGeom);
    }

    // Standard PBR Terrain Material
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
      flatShading: false,
    });

    // Tier 1 Cache: Check IndexedDB for cached aerial satellite imagery before fetching from ESRI
    const satelliteUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}&bboxSR=4326&imageSR=4326&size=2048,2048&f=image`;
    const textureCacheKey = `esri_${bbox.minLng}_${bbox.minLat}_${bbox.maxLng}_${bbox.maxLat}`;

    loadCachedSatelliteTexture(satelliteUrl, textureCacheKey)
      .then(({ texture, fromCache }) => {
        terrainMat.map = texture;
        terrainMat.needsUpdate = true;
        setIsSatelliteCached(fromCache);
        renderControllerRef.current.keepAlive(40);
      })
      .catch((err) => {
        console.warn('[SimulationCanvas] Satellite imagery fetch failed, using digital twin fallback:', err);
        terrainMat.color.setHex(0x1e293b);
        terrainMat.needsUpdate = true;
        renderControllerRef.current.keepAlive(10);
      });

    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.position.set(midX, 0, midZ);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Digital twin subtle elevation contour overlay
    const contourMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.06,
    });
    const contourMesh = new THREE.Mesh(terrainGeom.clone(), contourMat);
    contourMesh.position.set(midX, 1.5, midZ);
    scene.add(contourMesh);

    // Optional: Google Photorealistic 3D Tiles setup (if valid API key is present)
    const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';
    const tilesUrl = `https://tile.googleapis.com/v1/3dtiles/datasets/google_photorealistic_3d_tiles/tileset?key=${apiKey}`;
    const tiles = new TilesRenderer(tilesUrl);
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.group.quaternion.copy(enuRotation);
    tiles.group.position.copy(offset);
    scene.add(tiles.group);
    tilesRendererRef.current = tiles;

    // 8. Grid of cells helper (Visualizing the Hex grid in local coordinates)
    const gridGroup = new THREE.Group();
    const cellMeshes: { id: string; cylinder: THREE.Mesh; ring: THREE.Mesh; baseColor: number }[] = [];
    cellPositionsRef.current = {};

    cells.forEach((cell) => {
      if (cell.lat === undefined || cell.lng === undefined) return;

      const cellECEF = latLngToECEF(cell.lat, cell.lng, 0);
      const localPos = cellECEF.clone().applyQuaternion(enuRotation).add(offset);
      // Elevate cell to sit directly on the terrain topography
      localPos.y = getTerrainElevation(localPos.x, localPos.z);

      // Cache cell local position for quick access in particle simulation
      cellPositionsRef.current[cell.id] = localPos.clone();

      // Determine risk color based on CCG score (Lighter luminous palette)
      let cellColor = 0x64748b; // default slate
      if (cell.ccg >= 0.75) cellColor = 0xf87171; // Lighter Severe (Soft Red, was 0xdc2626)
      else if (cell.ccg >= 0.5) cellColor = 0xfb923c; // Lighter High (Soft Orange, was 0xea580c)
      else if (cell.ccg >= 0.3) cellColor = 0xfcd34d; // Lighter Elevated (Amber, was 0xf59e0b)
      else if (cell.ccg >= 0.15) cellColor = 0xfde047; // Lighter Moderate (Yellow, was 0xfbbf24)

      // Render Volumetric Holographic Risk Prism
      const radius = 500;
      const height = 90 + cell.ccg * 850;
      const isSelected = cell.id === selectedCell?.id;

      // Hexagonal cylinder prism with translucent glass material (lighter fill)
      const prismGeom = new THREE.CylinderGeometry(radius, radius, height, 6);
      const prismMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x0ea5e9 : cellColor,
        roughness: 0.22,
        metalness: 0.12,
        transparent: true,
        opacity: isSelected ? 0.38 : (cell.ccg >= 0.5 ? 0.22 : 0.12),
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const cylinder = new THREE.Mesh(prismGeom, prismMat);
      cylinder.position.copy(localPos);
      cylinder.position.y += height / 2;

      // Crisp glowing neon hexagonal edges (20%+ more solid boundary)
      const edgesGeom = new THREE.EdgesGeometry(prismGeom);
      const edgesMat = new THREE.LineBasicMaterial({
        color: isSelected ? 0x38bdf8 : cellColor,
        linewidth: 2.5,
        transparent: true,
        opacity: isSelected ? 1.0 : (cell.ccg >= 0.5 ? 0.95 : 0.65), // was 0.45 (20%+ more solid)
      });
      const edges = new THREE.LineSegments(edgesGeom, edgesMat);
      cylinder.add(edges);
      gridGroup.add(cylinder);

      // Ground-projected tactical risk ring (20%+ more solid boundary)
      const ringGeom = new THREE.RingGeometry(radius * 0.92, radius, 6);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0x38bdf8 : cellColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: isSelected ? 1.0 : (cell.ccg >= 0.5 ? 0.92 : 0.55), // was 0.35 (20%+ more solid)
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.copy(localPos);
      ring.position.y += 3;
      ring.rotation.x = Math.PI / 2; // Flat on ground
      gridGroup.add(ring);

      // Cache cell mesh references
      cellMeshes.push({
        id: cell.id,
        cylinder,
        ring,
        baseColor: cellColor,
      });
    });
    scene.add(gridGroup);
    cellMeshesRef.current = cellMeshes;

    // 8.6. Historical Footprint Group (Empty / Predictive Mode Active)
    const historicalLineGroup = new THREE.Group();
    scene.add(historicalLineGroup);
    historicalLineGroupRef.current = historicalLineGroup;

    // 8.5. Render Fire Stations in the ThreeJS scene
    const stationGroup = new THREE.Group();
    const stationBeacons: { name: string; mesh: THREE.Mesh; initialY: number }[] = [];

    fireStations.forEach((station) => {
      const stnECEF = latLngToECEF(station.lat, station.lng, 0);
      const localPos = stnECEF.clone().applyQuaternion(enuRotation).add(offset);
      localPos.y = getTerrainElevation(localPos.x, localPos.z);

      const stnModel = new THREE.Group();

      // Station post cylinder
      const cylinderGeom = new THREE.CylinderGeometry(15, 15, 100, 6);
      const cylinderMat = new THREE.MeshBasicMaterial({ color: 0x475569 }); // Slate grey post
      const post = new THREE.Mesh(cylinderGeom, cylinderMat);
      post.position.y = 50;
      stnModel.add(post);

      // Beacon sphere
      const sphereGeom = new THREE.SphereGeometry(25, 12, 12);
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0x0ea5e9 }); // Slate blue beacon
      const beacon = new THREE.Mesh(sphereGeom, sphereMat);
      beacon.position.y = 110;
      stnModel.add(beacon);

      stnModel.position.copy(localPos);
      stationGroup.add(stnModel);

      // Keep track of beacons to animate them on cell hover
      stationBeacons.push({
        name: station.name,
        mesh: beacon,
        initialY: 110,
      });
    });
    scene.add(stationGroup);
    stationBeaconsRef.current = stationBeacons;

    // 9. Fire Spread Emitters setup (at the selected hotspot cell center)
    const selectedLocalPos = new THREE.Vector3(0, 0, 0); // centered POI
    if (selectedCell && selectedCell.lat !== undefined && selectedCell.lng !== undefined) {
      const selECEF = latLngToECEF(selectedCell.lat, selectedCell.lng, 0);
      const localPos = selECEF.applyQuaternion(enuRotation).add(offset);
      localPos.y = getTerrainElevation(localPos.x, localPos.z);
      selectedLocalPos.copy(localPos);
    }

    // Fire Particles
    const fireGeometry = new THREE.BufferGeometry();
    const firePositions = new Float32Array(particleCount * 3);
    const fireColors = new Float32Array(particleCount * 3);
    const fireSizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      firePositions[i * 3] = selectedLocalPos.x + (Math.random() - 0.5) * 100;
      firePositions[i * 3 + 1] = selectedLocalPos.y + Math.random() * 50;
      firePositions[i * 3 + 2] = selectedLocalPos.z + (Math.random() - 0.5) * 100;

      // Orange-red gradients
      fireColors[i * 3] = 1.0; // R
      fireColors[i * 3 + 1] = 0.2 + Math.random() * 0.4; // G
      fireColors[i * 3 + 2] = 0.0; // B

      fireSizes[i] = 10 + Math.random() * 30;
    }

    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));
    fireGeometryRef.current = fireGeometry;

    // Initialize WebGPU particle compute pipeline if hardware acceleration is available
    createWebGPUParticlePipeline(particleCount, firePositions).then((pipeline) => {
      webgpuPipelineRef.current = pipeline;
      if (pipeline) {
        console.log('[SimulationCanvas] WebGPU particle compute pipeline initialized successfully.');
      }
    });

    // Initialize WebGPU cellular fire spread compute pipeline
    createWebGPUFireSpreadPipeline(cells).then((pipeline) => {
      webgpuSpreadPipelineRef.current = pipeline;
      if (pipeline) {
        console.log('[SimulationCanvas] WebGPU Rothermel fire spread compute pipeline initialized successfully.');
      }
    });

    // Use built-in round particle texture creation
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.3, 'rgba(255, 150, 0, 0.8)');
      grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
    }
    const fireTexture = new THREE.CanvasTexture(canvas);

    const fireMaterial = new THREE.PointsMaterial({
      size: 20,
      map: fireTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    const firePoints = new THREE.Points(fireGeometry, fireMaterial);
    scene.add(firePoints);
    fireParticlesRef.current = firePoints;

    // Smoke Particles
    const smokeGeometry = new THREE.BufferGeometry();
    const smokePositions = new Float32Array(particleCount * 3);
    const smokeColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      smokePositions[i * 3] = selectedLocalPos.x + (Math.random() - 0.5) * 100;
      smokePositions[i * 3 + 1] = selectedLocalPos.y + Math.random() * 100;
      smokePositions[i * 3 + 2] = selectedLocalPos.z + (Math.random() - 0.5) * 100;

      // Dark grey to black smoke
      const val = 0.1 + Math.random() * 0.15;
      smokeColors[i * 3] = val;
      smokeColors[i * 3 + 1] = val;
      smokeColors[i * 3 + 2] = val;
    }

    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColors, 3));
    smokeGeometryRef.current = smokeGeometry;

    const smokeCanvas = document.createElement('canvas');
    smokeCanvas.width = 32;
    smokeCanvas.height = 32;
    const smokeCtx = smokeCanvas.getContext('2d');
    if (smokeCtx) {
      const grad = smokeCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(100, 100, 100, 0.4)');
      grad.addColorStop(0.5, 'rgba(50, 50, 50, 0.2)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      smokeCtx.fillStyle = grad;
      smokeCtx.fillRect(0, 0, 32, 32);
    }
    const smokeTexture = new THREE.CanvasTexture(smokeCanvas);

    const smokeMaterial = new THREE.PointsMaterial({
      size: 60,
      map: smokeTexture,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      vertexColors: true,
    });

    const smokePoints = new THREE.Points(smokeGeometry, smokeMaterial);
    scene.add(smokePoints);
    smokeParticlesRef.current = smokePoints;

    // 10. Frame handler
    const clock = new THREE.Clock();

    const animate = () => {
      tiles.update();

      // Smoothly pan camera target to selection without fighting manual user panning
      if (isPanningToTargetRef.current) {
        const dist = controls.target.distanceTo(targetLookAtRef.current);
        if (dist < 1.0) {
          controls.target.copy(targetLookAtRef.current);
          isPanningToTargetRef.current = false;
        } else {
          const oldTarget = controls.target.clone();
          controls.target.lerp(targetLookAtRef.current, 0.08);
          // Translate camera position along with target so the viewing angle does not rotate
          const stepDelta = controls.target.clone().sub(oldTarget);
          camera.position.add(stepDelta);
        }
      }

      // Highlight and animate nearest fire station beacon based on cell hover status
      const hoveredCellObj = cellsRef.current.find((c) => c.id === hoveredIdRef.current);
      const hoveredStationName = hoveredCellObj?.nearestStationName;

      stationBeaconsRef.current.forEach((beacon) => {
        if (beacon.name === hoveredStationName) {
          // Hover highlight: pulse scale and flash color
          const pulse = 1.0 + Math.sin(Date.now() * 0.015) * 0.25;
          beacon.mesh.scale.set(pulse, pulse, pulse);
          (beacon.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xdc2626); // Flash red
        } else {
          // Reset
          beacon.mesh.scale.set(1.0, 1.0, 1.0);
          (beacon.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x0ea5e9); // Default blue
        }
      });

      // HTML screen space tooltip projection
      const tooltip = tooltipRef.current;
      if (tooltip) {
        if (hoveredCellObj && hoveredCellObj.nearestStationLat && hoveredCellObj.nearestStationLng) {
          const stnECEF = latLngToECEF(hoveredCellObj.nearestStationLat, hoveredCellObj.nearestStationLng, 0);
          const localPos = stnECEF.clone().applyQuaternion(enuRotation).add(offset);
          localPos.y += 140; // Position text slightly above the beacon sphere

          // Project
          const tempV = localPos.clone();
          tempV.project(camera);

          const container = mountRef.current;
          if (container) {
            const w = container.clientWidth;
            const h = container.clientHeight;
            const x = (tempV.x * 0.5 + 0.5) * w;
            const y = (tempV.y * -0.5 + 0.5) * h;

            tooltip.style.display = 'block';
            tooltip.style.left = `${x}px`;
            tooltip.style.top = `${y - 45}px`; // Offset to sit nicely above beacon

            const nameEl = tooltip.querySelector('.stn-name');
            const timeEl = tooltip.querySelector('.stn-time');
            if (nameEl) nameEl.textContent = hoveredCellObj.nearestStationName ?? 'USFA Station';
            if (timeEl) timeEl.textContent = `${hoveredCellObj.driveTimeMin.toFixed(1)} mins`;
          }
        } else {
          tooltip.style.display = 'none';
        }
      }

      // Render frames only on-demand or during active motion to save GPU power
      if (
        isPanningToTargetRef.current ||
        isPlaying ||
        renderControllerRef.current.shouldRender()
      ) {
        controls.update();
        renderer.render(scene, camera);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    // 11. Handle Resize
    const handleResize = () => {
      if (!mountRef.current || !camera || !renderer) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderControllerRef.current.keepAlive(10);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      if (webgpuPipelineRef.current) {
        webgpuPipelineRef.current.destroy();
        webgpuPipelineRef.current = null;
      }
      if (webgpuSpreadPipelineRef.current) {
        webgpuSpreadPipelineRef.current.destroy();
        webgpuSpreadPipelineRef.current = null;
      }
      tiles.dispose();
    };
  }, [cells, fireStations]);

  // Synchronize selection changes (color highlighting & camera panning) without rebuilding the canvas
  useEffect(() => {
    // 1. Update target look-at vector for camera focus panning
    if (selectedCell && cells.length > 0) {
      const pos = cellPositionsRef.current[selectedCell.id];
      if (pos) {
        targetLookAtRef.current.copy(pos);
        isPanningToTargetRef.current = true;
      }
    } else {
      targetLookAtRef.current.set(0, 0, 0);
      isPanningToTargetRef.current = false;
    }

    // 2. Update grid cell selection highlight colors dynamically
    cellMeshesRef.current.forEach((mesh) => {
      const isSelected = mesh.id === selectedCell?.id;
      (mesh.cylinder.material as THREE.MeshStandardMaterial).color.setHex(isSelected ? 0x0ea5e9 : mesh.baseColor);
      (mesh.cylinder.material as THREE.MeshStandardMaterial).opacity = isSelected ? 0.38 : (mesh.baseColor === 0xf87171 ? 0.22 : 0.12);
      (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(isSelected ? 0x0ea5e9 : mesh.baseColor);
      (mesh.ring.material as THREE.MeshBasicMaterial).opacity = isSelected ? 1.0 : 0.75;
    });

    // 3. Reset particle systems centered around the new selection (if not currently playing)
    const fireGeom = fireGeometryRef.current;
    const smokeGeom = smokeGeometryRef.current;
    if (selectedCell && fireGeom && smokeGeom && !isPlaying) {
      const pos = cellPositionsRef.current[selectedCell.id];
      if (pos) {
        const firePos = fireGeom.attributes.position.array as Float32Array;
        const smokePos = smokeGeom.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          firePos[i * 3] = pos.x + (Math.random() - 0.5) * 100;
          firePos[i * 3 + 1] = pos.y + Math.random() * 50;
          firePos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 100;

          smokePos[i * 3] = pos.x + (Math.random() - 0.5) * 100;
          smokePos[i * 3 + 1] = pos.y + Math.random() * 100;
          smokePos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 100;
        }
        fireGeom.attributes.position.needsUpdate = true;
        smokeGeom.attributes.position.needsUpdate = true;
      }
    }
  }, [selectedCell, cells, isPlaying]);

  // Handle fire propagation animations on simState change
  useEffect(() => {
    if (!isPlaying) return;

    let time = simTime;
    const interval = setInterval(() => {
      time += 0.5;
      setSimTime(time);

      // Run predictive spread model if Option B is active
      let spreadStates: Record<string, any> = {};
      let burningCells: HexCell[] = [];

      if (simModeRef.current === 'predictive') {
        const spreadPipeline = webgpuSpreadPipelineRef.current;
        if (spreadPipeline) {
          spreadPipeline.dispatch(selectedCell, windAngle, windSpeed, time).then((res) => {
            if (res) {
              setComputeLatency(res.latencyMs);
              const gpuSpread = res.spreadStates;
              burningCells = cellsRef.current.filter((c) => gpuSpread[c.id]?.isOnFire);

              cellMeshesRef.current.forEach((mesh) => {
                const state = gpuSpread[mesh.id];
                if (state && state.isOnFire) {
                  (mesh.cylinder.material as THREE.MeshBasicMaterial).color.setHex(0xea580c);
                  (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(0xdc2626);
                } else {
                  (mesh.cylinder.material as THREE.MeshBasicMaterial).color.setHex(mesh.baseColor);
                  (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(mesh.id === selectedCell?.id ? 0x0ea5e9 : mesh.baseColor);
                }
              });
              renderControllerRef.current.keepAlive(10);
            }
          });
        } else {
          spreadStates = computePredictiveSpread(
            cellsRef.current,
            selectedCell,
            windAngle,
            windSpeed,
            time,
            enhancedIPSRef.current.length === cellsRef.current.length
              ? { enhancedIPS: enhancedIPSRef.current, blendAlpha }
              : undefined
          );

          burningCells = cellsRef.current.filter((c) => {
            const state = spreadStates[c.id];
            return state && state.isOnFire;
          });

          // Update cell heights/colors based on spread
          cellMeshesRef.current.forEach((mesh) => {
            const state = spreadStates[mesh.id];
            if (state && state.isOnFire) {
              // Hot fire colors: glow orange/red based on burn intensity
              (mesh.cylinder.material as THREE.MeshBasicMaterial).color.setHex(0xea580c);
              (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(0xdc2626);
            } else {
              // Restore base color
              (mesh.cylinder.material as THREE.MeshBasicMaterial).color.setHex(mesh.baseColor);
              (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(mesh.id === selectedCell?.id ? 0x0ea5e9 : mesh.baseColor);
            }
          });
        }
      }

      // Hide historical footprint if any
      const historicalLineGroup = historicalLineGroupRef.current;
      if (historicalLineGroup) {
        historicalLineGroup.visible = false;
      }

      // Animate fire and smoke particles drifting with the wind
      const fireGeom = fireGeometryRef.current;
      const smokeGeom = smokeGeometryRef.current;

      const radWind = (windAngle * Math.PI) / 180;
      const dx = Math.sin(radWind) * windSpeed * 1.5;
      const dz = -Math.cos(radWind) * windSpeed * 1.5; // Wind vector translation

      const origin = new THREE.Vector3(0, 0, 0);
      if (selectedCell && cellPositionsRef.current[selectedCell.id]) {
        origin.copy(cellPositionsRef.current[selectedCell.id]);
      }

      // Find emitter origin
      let emitterPos = origin;
      if (burningCells.length > 0) {
        const rc = burningCells[Math.floor(Math.random() * burningCells.length)];
        const pos = cellPositionsRef.current[rc.id];
        if (pos) emitterPos = pos;
      }

      renderControllerRef.current.keepAlive(10);

      // WebGPU Compute Pipeline Execution
      const pipeline = webgpuPipelineRef.current;
      if (pipeline) {
        pipeline.dispatch(windAngle, windSpeed, emitterPos.x, emitterPos.y, emitterPos.z, 0.05, time).then((gpuRes) => {
          if (gpuRes && fireGeom) {
            setComputeLatency((prev) => (prev !== null ? (prev + gpuRes.latencyMs) / 2 : gpuRes.latencyMs));
            const positions = fireGeom.attributes.position.array as Float32Array;
            positions.set(gpuRes.positions);
            fireGeom.attributes.position.needsUpdate = true;
            renderControllerRef.current.keepAlive(5);
          }
        });
      } else if (fireGeom) {
        // CPU fallback particle physics
        const positions = fireGeom.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          positions[i * 3 + 1] += 4 + Math.random() * 8; // vertical float
          positions[i * 3] += dx * 0.2 + (Math.random() - 0.5) * 20; // wind drift X
          positions[i * 3 + 2] += dz * 0.2 + (Math.random() - 0.5) * 20; // wind drift Z

          // Reset particle if too high
          if (positions[i * 3 + 1] > emitterPos.y + 400 + Math.random() * 200) {
            positions[i * 3] = emitterPos.x + (Math.random() - 0.5) * (100 + time * 15);
            positions[i * 3 + 1] = emitterPos.y + Math.random() * 30;
            positions[i * 3 + 2] = emitterPos.z + (Math.random() - 0.5) * (100 + time * 15);
          }
        }
        fireGeom.attributes.position.needsUpdate = true;
      }

      if (smokeGeom) {
        const positions = smokeGeom.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          positions[i * 3 + 1] += 3 + Math.random() * 5;
          positions[i * 3] += dx * 0.35 + (Math.random() - 0.5) * 35;
          positions[i * 3 + 2] += dz * 0.35 + (Math.random() - 0.5) * 35;

          // Find emitter origin
          let emitterPos = origin;
          if (burningCells.length > 0) {
            const rc = burningCells[Math.floor(Math.random() * burningCells.length)];
            const pos = cellPositionsRef.current[rc.id];
            if (pos) emitterPos = pos;
          }

          if (positions[i * 3 + 1] > emitterPos.y + 800 + Math.random() * 300) {
            positions[i * 3] = emitterPos.x + (Math.random() - 0.5) * (120 + time * 20);
            positions[i * 3 + 1] = emitterPos.y + Math.random() * 60;
            positions[i * 3 + 2] = emitterPos.z + (Math.random() - 0.5) * (120 + time * 20);
          }
        }
        smokeGeom.attributes.position.needsUpdate = true;
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isPlaying, simTime, windAngle, windSpeed, selectedCell, simMode, cells]);

  const handleReset = () => {
    setIsPlaying(false);
    setSimTime(0);

    // Restore cell meshes base colors
    cellMeshesRef.current.forEach((mesh) => {
      const isSelected = mesh.id === selectedCell?.id;
      (mesh.cylinder.material as THREE.MeshStandardMaterial).color.setHex(isSelected ? 0x0ea5e9 : mesh.baseColor);
      (mesh.cylinder.material as THREE.MeshStandardMaterial).opacity = isSelected ? 0.38 : (mesh.baseColor === 0xf87171 ? 0.22 : 0.12);
      (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(isSelected ? 0x0ea5e9 : mesh.baseColor);
    });

    // Reset historical line group
    const historicalLineGroup = historicalLineGroupRef.current;
    if (historicalLineGroup) {
      historicalLineGroup.visible = false;
    }

    // Reset particles back to seed points
    const fireGeom = fireGeometryRef.current;
    const smokeGeom = smokeGeometryRef.current;
    const origin = new THREE.Vector3(0, 0, 0);

    if (selectedCell && selectedCell.lat !== undefined && selectedCell.lng !== undefined) {
      const poiECEF = latLngToECEF(centerCoord.lat, centerCoord.lng, 0);
      const normal = poiECEF.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(normal, up);
      const offset = poiECEF.clone().applyQuaternion(quaternion).negate();

      const selECEF = latLngToECEF(selectedCell.lat ?? 0, selectedCell.lng ?? 0, 0);
      const localPos = selECEF.applyQuaternion(quaternion).add(offset);
      origin.copy(localPos);
    }

    if (fireGeom) {
      const positions = fireGeom.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        const emitterPos = origin;
        positions[i * 3] = emitterPos.x + (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = emitterPos.y + Math.random() * 50;
        positions[i * 3 + 2] = emitterPos.z + (Math.random() - 0.5) * 100;
      }
      fireGeom.attributes.position.needsUpdate = true;
    }

    if (smokeGeom) {
      const positions = smokeGeom.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        const emitterPos = origin;
        positions[i * 3] = emitterPos.x + (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = emitterPos.y + Math.random() * 100;
        positions[i * 3 + 2] = emitterPos.z + (Math.random() - 0.5) * 100;
      }
      smokeGeom.attributes.position.needsUpdate = true;
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      {/* Standalone Canvas mounting ref */}
      <div ref={mountRef} className="h-full w-full" />

      {/* Floating projected fire station tooltip */}
      <div 
        ref={tooltipRef}
        className="pointer-events-none absolute z-40 hidden -translate-x-1/2 -translate-y-full rounded border border-red-200 bg-white/95 px-3 py-1.5 shadow-lg shadow-black/10 transition-all font-mono"
        style={{ left: 0, top: 0 }}
      >
        <strong className="stn-name block text-xs text-slate-800" />
        <span className="text-[10px] text-slate-500">Response Time: </span>
        <span className="stn-time text-[10.5px] font-bold text-red-600" />
      </div>

      {/* Simulation Playback & Wind Parameter Dashboard (Vibrant Sleek Overlay) */}
      <div className="absolute top-4 left-4 z-10 w-80 rounded-lg border border-ink-800 bg-ink-950/85 p-4 backdrop-blur-md font-sans">
        <div className="flex items-center gap-2 border-b border-ink-800 pb-2 mb-3">
          <Flame className="h-4.5 w-4.5 text-heat-500 animate-pulse" />
          <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wider">
            Wildfire Spread Simulator
          </h2>
        </div>

        {/* WebGPU Hardware Acceleration Telemetry Badge */}
        <div className="mb-2.5 flex items-center justify-between rounded border border-ink-850 bg-ink-900/70 px-2.5 py-1.5 text-[10px]">
          <div className="flex items-center gap-1.5">
            {webgpuStatus?.supported ? (
              <>
                <Zap className="h-3 w-3 text-emerald-400 fill-emerald-400/20" />
                <span className="font-bold text-emerald-300">WebGPU Hardware Active</span>
              </>
            ) : (
              <>
                <Cpu className="h-3 w-3 text-cool-400" />
                <span className="font-bold text-ink-300">WebGL 2.0 Fallback</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {computeLatency !== null && (
              <span className="font-mono text-[9px] text-emerald-400 font-bold">
                {computeLatency.toFixed(2)}ms GPU
              </span>
            )}
            {webgpuStatus?.architecture && (
              <span className="font-mono text-[9px] text-ink-400 truncate max-w-[95px]" title={webgpuStatus.adapterName}>
                {webgpuStatus.architecture}
              </span>
            )}
          </div>
        </div>

        {/* High-Resolution Satellite 3D Terrain Active Badge with IndexedDB Cache Indicator */}
        <div className="mb-3 rounded border border-emerald-800/60 bg-emerald-950/40 p-2 text-[10px] text-emerald-300 leading-normal flex items-start gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mt-1 shrink-0 animate-pulse" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold uppercase text-emerald-200">Satellite 3D Ortho Terrain</span>
              {isSatelliteCached && (
                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-900/70 border border-emerald-700/50 px-1 py-0.5 text-[8.5px] font-mono text-emerald-300">
                  <Database className="h-2.5 w-2.5" /> Cached (IndexedDB)
                </span>
              )}
            </div>
            Draped with real-time ESRI High-Resolution Ortho-Imagery across regional topography.
          </div>
        </div>

        {/* ML Engine Active Simulation Status Card */}
        <div className="mb-3 rounded border border-ink-850 bg-ink-900/30 p-2 text-[10px] text-ink-400 leading-normal">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-emerald-400 uppercase flex items-center gap-1">
              🧠 {modelStatus.source === 'custom-onnx' ? `Custom Model (${modelStatus.name})` : 'FireSenseNet ML Engine'}
            </span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
              {modelStatus.latencyMs > 0 ? `${modelStatus.latencyMs.toFixed(1)}ms` : 'active'}
            </span>
          </div>
          Modeling fire propagation using {modelStatus.source === 'custom-onnx' ? `custom ONNX weights (${modelStatus.name})` : 'spatio-temporal ML'} blended ({(blendAlpha * 100).toFixed(0)}%) with Rothermel physics.
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              isPlaying
                ? 'bg-red-950/40 border border-red-500 text-red-400 hover:bg-red-950/60'
                : 'bg-emerald-950/40 border border-emerald-500 text-emerald-400 hover:bg-emerald-950/60'
            }`}
          >
            {isPlaying ? (
              <>
                <Square className="h-3.5 w-3.5 fill-red-400" /> Pause Sim
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-emerald-400" /> Run Physics
              </>
            )}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center justify-center rounded border border-ink-700 bg-ink-800/40 p-1.5 text-ink-400 hover:text-ink-200 hover:bg-ink-800/60"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        {/* Status Metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs font-mono">
          <div className="rounded border border-ink-800 bg-ink-900/40 p-2">
            <span className="block text-[10px] text-ink-500">Propagation Time</span>
            <span className="text-ink-200 font-bold">{simTime.toFixed(1)} mins</span>
          </div>
          <div className="rounded border border-ink-800 bg-ink-900/40 p-2">
            <span className="block text-[10px] text-ink-500">Front Velocity</span>
            <span className="text-heat-400 font-bold">
              {selectedCell ? (selectedCell.ips * 12 + windSpeed * 0.1).toFixed(2) : 0} m/min
            </span>
          </div>
        </div>

        {/* Real-time Meteorology Header */}
        <div className="border-t border-ink-850 pt-3 pb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-200">
              <CloudSun className="h-3.5 w-3.5 text-amber-400" />
              Live Weather Feed
            </span>
            <button
              onClick={fetchLiveWeather}
              disabled={isFetchingWeather}
              className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 disabled:opacity-50 transition-colors"
              title="Sync latest NOAA / Open-Meteo surface conditions"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${isFetchingWeather ? 'animate-spin' : ''}`} />
              <span>{isFetchingWeather ? 'Syncing...' : 'Sync'}</span>
            </button>
          </div>

          {weatherData ? (
            <div className="flex items-center justify-between rounded bg-ink-900/60 px-2 py-1 text-[10px] text-ink-400 mb-2 border border-ink-800/40">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{weatherData.temperatureF}°F · {weatherData.humidity}% RH</span>
              </span>
              <span className="text-[9px] text-ink-500 font-mono">{weatherData.lastUpdated}</span>
            </div>
          ) : (
            <div className="text-[10px] text-ink-500 mb-2 italic">
              Connecting to live surface telemetry...
            </div>
          )}
        </div>

        {/* Wind controls */}
        <div className="space-y-3 border-t border-ink-850/60 pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink-400">
              <Wind className="h-3.5 w-3.5 text-sky-400" /> Wind Angle
            </span>
            <span className="text-ink-200 font-bold">{windAngle}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            value={windAngle}
            onChange={(e) => setWindAngle(Number(e.target.value))}
            className="w-full h-1 bg-ink-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
          />

          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink-400">
              <Shield className="h-3.5 w-3.5 text-sky-400" /> Wind Speed
            </span>
            <span className="text-ink-200 font-bold">{windSpeed} mph</span>
          </div>
          <input
            type="range"
            min="0"
            max="45"
            value={windSpeed}
            onChange={(e) => setWindSpeed(Number(e.target.value))}
            className="w-full h-1 bg-ink-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
          />
        </div>
      </div>

      {/* Floating Instructions */}
      <div className="absolute top-4 right-4 z-10 glass-panel px-4 py-2 rounded-lg text-[10px] text-ink-400 pointer-events-none">
        <span className="block font-bold text-ink-200 mb-0.5">Control Guide:</span>
        <span>• Left Click + Drag: Rotate Camera</span><br />
        <span>• Right Click + Drag: Pan Map</span><br />
        <span>• Scroll: Zoom In/Out</span>
      </div>

      {/* Map attribution legend */}
      <div className="absolute bottom-4 left-4 glass-panel rounded-lg p-3 z-10 text-[9px] text-ink-500 font-mono">
        Google Earth 3D Tiles streamed via Map Tiles API
      </div>
    </div>
  );
}
