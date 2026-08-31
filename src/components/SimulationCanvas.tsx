import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer';
import type { HexCell } from '@/types';
import { Play, Square, RotateCcw, Wind, Shield, Flame, Layers } from 'lucide-react';
import { getHistoricalFire } from '@/data/historicalFires';
import { computePredictiveSpread } from '@/lib/predictiveSim';

interface SimulationCanvasProps {
  cells: HexCell[];
  selectedCell: HexCell | null;
  hoveredId: string | null;
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

export function SimulationCanvas({
  cells,
  selectedCell,
  hoveredId,
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

  // Particle systems for fire/smoke simulation
  const fireParticlesRef = useRef<THREE.Points | null>(null);
  const smokeParticlesRef = useRef<THREE.Points | null>(null);
  const fireGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const smokeGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const particleCount = 800;

  // Track coordinates for current county center
  const centerCoord = {
    lat: selectedCell?.lat ?? 37.7749,
    lng: selectedCell?.lng ?? -122.4194,
  };

  // Initializing three.js
  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#F8FAFC'); // Light slate background matching matching theme
    scene.fog = new THREE.FogExp2('#F8FAFC', 0.00005); // Fog to blend tiles
    sceneRef.current = scene;

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(55, width / height, 10, 40000);
    // Position camera tilted, looking down at the origin (0, 0, 0)
    camera.position.set(0, 1500, 2000);
    cameraRef.current = camera;

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffecd2, 0.8); // Warm sun
    dirLight1.position.set(2000, 4000, 2000);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0f172a, 0.5); // Dark blue fill
    dirLight2.position.set(-2000, -2000, -2000);
    scene.add(dirLight2);

    // 5. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground
    controls.minDistance = 200;
    controls.maxDistance = 15000;
    controlsRef.current = controls;

    // Bind change listener for camera updates
    controls.addEventListener('change', () => {
      if (onCameraChange) {
        const localVec = camera.position.clone();
        onCameraChange({
          center: centerCoord,
          zoom: Math.round(15 - Math.log2(localVec.length() / 100)),
          heading: Math.round(controls.getAzimuthalAngle() * (180 / Math.PI)),
          tilt: Math.round(controls.getPolarAngle() * (180 / Math.PI)),
        });
      }
    });

    // 6. Google Photorealistic 3D Tiles setup with fallback wireframe terrain
    const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';
    const tilesUrl = `https://tile.googleapis.com/v1/3dtiles/datasets/google_photorealistic_3d_tiles/tileset?key=${apiKey}`;

    // Fallback wireframe grid & terrain (always loaded in case tiles fail)
    const fallbackGrid = new THREE.GridHelper(30000, 150, 0x475569, 0x94a3b8);
    fallbackGrid.position.y = -5;
    scene.add(fallbackGrid);

    const planeGeom = new THREE.PlaneGeometry(30000, 30000, 60, 60);
    const posAttr = planeGeom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const elevation = Math.sin(x * 0.0004) * Math.cos(y * 0.0004) * 350 + Math.sin(x * 0.001) * 120;
      posAttr.setZ(i, elevation - 10); // push slightly below 0 altitude reference
    }
    planeGeom.computeVertexNormals();

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x64748b, // Darker slate wireframe representing topography
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const fallbackTerrain = new THREE.Mesh(planeGeom, planeMat);
    fallbackTerrain.rotation.x = -Math.PI / 2;
    scene.add(fallbackTerrain);

    const tiles = new TilesRenderer(tilesUrl);
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    scene.add(tiles.group);
    tilesRendererRef.current = tiles;

    // 7. Align Tileset to local coordinate system (Y-Up flat plane at POI)
    const poiECEF = latLngToECEF(centerCoord.lat, centerCoord.lng, 0);
    const normal = poiECEF.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(normal, up);

    // Apply transformation
    tiles.group.quaternion.copy(quaternion);
    const offset = poiECEF.clone().applyQuaternion(quaternion).negate();
    tiles.group.position.copy(offset);

    // 8. Grid of cells helper (Visualizing the Hex grid in local coordinates)
    const gridGroup = new THREE.Group();
    const cellMeshes: { id: string; cylinder: THREE.Mesh; ring: THREE.Mesh; baseColor: number }[] = [];
    cellPositionsRef.current = {};

    cells.forEach((cell) => {
      if (cell.lat === undefined || cell.lng === undefined) return;

      const cellECEF = latLngToECEF(cell.lat, cell.lng, 0);
      const localPos = cellECEF.clone().applyQuaternion(quaternion).add(offset);

      // Cache cell local position for quick access in particle simulation
      cellPositionsRef.current[cell.id] = localPos.clone();

      // Render a circular indicator flat on the ground for each hex cell
      const radius = 600;
      const geom = new THREE.RingGeometry(radius - 15, radius, 6); // hexagonal ring proxy
      const colorMap: Record<string, number> = {
        red: 0xdc2626,
        orange: 0xea580c,
        amber: 0xf59e0b,
        yellow: 0xfbbf24,
        blue: 0x475569, // Slate-600 for contrast visibility against light bg
      };

      let cellColor = 0x475569; // default slate
      if (cell.ccg >= 0.75) cellColor = colorMap.red;
      else if (cell.ccg >= 0.5) cellColor = colorMap.orange;
      else if (cell.ccg >= 0.3) cellColor = colorMap.amber;
      else if (cell.ccg >= 0.15) cellColor = colorMap.yellow;

      const mat = new THREE.MeshBasicMaterial({
        color: cell.id === selectedCell?.id ? 0x0ea5e9 : cellColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: cell.id === selectedCell?.id ? 1.0 : 0.65,
      });

      const ring = new THREE.Mesh(geom, mat);
      ring.position.copy(localPos);
      ring.rotation.x = Math.PI / 2; // Flat on ground plane
      gridGroup.add(ring);

      // Height indicator representing CCG/IPS risk
      const height = 50 + cell.ips * 500;
      const cylinderGeom = new THREE.CylinderGeometry(80, 80, height, 5);
      const cylinderMat = new THREE.MeshBasicMaterial({
        color: cellColor,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
      });
      const cylinder = new THREE.Mesh(cylinderGeom, cylinderMat);
      cylinder.position.copy(localPos);
      cylinder.position.y += height / 2; // Sit on ground
      gridGroup.add(cylinder);

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

    // 8.6. Render Historical Fire Footprint Outline (Option A)
    const historicalLineGroup = new THREE.Group();
    const countyId = selectedCell?.region ?? cells[0]?.region ?? 'boulder-co';
    const historicalFire = getHistoricalFire(countyId);

    if (historicalFire && historicalFire.boundary.length > 0) {
      const points: THREE.Vector3[] = [];
      historicalFire.boundary.forEach((coord) => {
        const ptECEF = latLngToECEF(coord.lat, coord.lng, 0);
        const localPos = ptECEF.applyQuaternion(quaternion).add(offset);
        localPos.y += 15; // float slightly above terrain
        points.push(localPos);
      });
      historicalLocalPointsRef.current = points;

      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xea580c, // Fire orange
        linewidth: 3,
      });
      const lineLoop = new THREE.LineLoop(lineGeom, lineMat);
      historicalLineGroup.add(lineLoop);

      // Create a translucent polygon shape fill representing the fire region
      const shape = new THREE.Shape();
      historicalFire.boundary.forEach((coord, idx) => {
        const ptECEF = latLngToECEF(coord.lat, coord.lng, 0);
        const localPos = ptECEF.applyQuaternion(quaternion).add(offset);
        if (idx === 0) {
          shape.moveTo(localPos.x, -localPos.z);
        } else {
          shape.lineTo(localPos.x, -localPos.z);
        }
      });

      const shapeGeom = new THREE.ShapeGeometry(shape);
      const shapeMat = new THREE.MeshBasicMaterial({
        color: 0xdc2626, // Red glow
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
      });
      const shapeMesh = new THREE.Mesh(shapeGeom, shapeMat);
      shapeMesh.rotation.x = -Math.PI / 2; // Flat
      shapeMesh.position.y = 10; // Sit slightly above grid base
      historicalLineGroup.add(shapeMesh);
      
      historicalLineGroup.visible = (simModeRef.current === 'historical');
    }
    scene.add(historicalLineGroup);
    historicalLineGroupRef.current = historicalLineGroup;

    // 8.5. Render Fire Stations in the ThreeJS scene
    const stationGroup = new THREE.Group();
    const stationBeacons: { name: string; mesh: THREE.Mesh; initialY: number }[] = [];

    fireStations.forEach((station) => {
      const stnECEF = latLngToECEF(station.lat, station.lng, 0);
      const localPos = stnECEF.clone().applyQuaternion(quaternion).add(offset);

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
      const localPos = selECEF.applyQuaternion(quaternion).add(offset);
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
          const localPos = stnECEF.clone().applyQuaternion(quaternion).add(offset);
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

      // Slow orbit rotation or updating controls
      controls.update();

      // Render frames
      renderer.render(scene, camera);
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
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      tiles.dispose();
    };
  }, [cells, selectedCell, fireStations]);

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
        spreadStates = computePredictiveSpread(
          cellsRef.current,
          selectedCell,
          windAngle,
          windSpeed,
          time
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

      // Animate historical footprint scaling if Option A is active
      const historicalLineGroup = historicalLineGroupRef.current;
      if (simModeRef.current === 'historical' && historicalLineGroup) {
        historicalLineGroup.visible = true;
        const scale = Math.min(1.0, 0.2 + time * 0.02);
        historicalLineGroup.scale.set(scale, 1.0, scale);
        const shapeMesh = historicalLineGroup.children[1] as THREE.Mesh;
        if (shapeMesh && shapeMesh.material) {
          (shapeMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, 0.05 + time * 0.005);
        }
      } else if (historicalLineGroup) {
        historicalLineGroup.visible = false;
      }

      // Animate fire and smoke particles drifting with the wind
      const fireGeom = fireGeometryRef.current;
      const smokeGeom = smokeGeometryRef.current;

      const radWind = (windAngle * Math.PI) / 180;
      const dx = Math.sin(radWind) * windSpeed * 1.5;
      const dz = -Math.cos(radWind) * windSpeed * 1.5; // Wind vector translation

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
          positions[i * 3 + 1] += 4 + Math.random() * 8; // vertical float
          positions[i * 3] += dx * 0.2 + (Math.random() - 0.5) * 20; // wind drift X
          positions[i * 3 + 2] += dz * 0.2 + (Math.random() - 0.5) * 20; // wind drift Z

          // Find emitter origin
          let emitterPos = origin;
          if (simModeRef.current === 'predictive' && burningCells.length > 0) {
            const rc = burningCells[Math.floor(Math.random() * burningCells.length)];
            const pos = cellPositionsRef.current[rc.id];
            if (pos) emitterPos = pos;
          } else if (simModeRef.current === 'historical' && historicalLocalPointsRef.current.length > 0) {
            const pt = historicalLocalPointsRef.current[Math.floor(Math.random() * historicalLocalPointsRef.current.length)];
            emitterPos = pt;
          }

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
          if (simModeRef.current === 'predictive' && burningCells.length > 0) {
            const rc = burningCells[Math.floor(Math.random() * burningCells.length)];
            const pos = cellPositionsRef.current[rc.id];
            if (pos) emitterPos = pos;
          } else if (simModeRef.current === 'historical' && historicalLocalPointsRef.current.length > 0) {
            const pt = historicalLocalPointsRef.current[Math.floor(Math.random() * historicalLocalPointsRef.current.length)];
            emitterPos = pt;
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
      (mesh.cylinder.material as THREE.MeshBasicMaterial).color.setHex(mesh.baseColor);
      (mesh.ring.material as THREE.MeshBasicMaterial).color.setHex(mesh.id === selectedCell?.id ? 0x0ea5e9 : mesh.baseColor);
    });

    // Reset historical line group scale and visibility
    const historicalLineGroup = historicalLineGroupRef.current;
    if (historicalLineGroup) {
      historicalLineGroup.visible = (simModeRef.current === 'historical');
      historicalLineGroup.scale.set(1.0, 1.0, 1.0);
      const shapeMesh = historicalLineGroup.children[1] as THREE.Mesh;
      if (shapeMesh && shapeMesh.material) {
        (shapeMesh.material as THREE.MeshBasicMaterial).opacity = 0.15;
      }
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
        let emitterPos = origin;
        if (simModeRef.current === 'historical' && historicalLocalPointsRef.current.length > 0) {
          emitterPos = historicalLocalPointsRef.current[Math.floor(Math.random() * historicalLocalPointsRef.current.length)];
        }
        positions[i * 3] = emitterPos.x + (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = emitterPos.y + Math.random() * 50;
        positions[i * 3 + 2] = emitterPos.z + (Math.random() - 0.5) * 100;
      }
      fireGeom.attributes.position.needsUpdate = true;
    }

    if (smokeGeom) {
      const positions = smokeGeom.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        let emitterPos = origin;
        if (simModeRef.current === 'historical' && historicalLocalPointsRef.current.length > 0) {
          emitterPos = historicalLocalPointsRef.current[Math.floor(Math.random() * historicalLocalPointsRef.current.length)];
        }
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

        {/* Warning if Google Maps API key is missing for 3D tiles */}
        {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
          <div className="mb-3 rounded border border-amber-900/50 bg-amber-950/30 p-2 text-[10px] text-amber-300 leading-normal">
            <span className="font-bold uppercase block mb-0.5">⚠️ 3D Earth Tiles Disabled</span>
            Google Earth 3D Tiles require a Google Maps API Key. Using fallback wireframe topography. Add <code className="bg-amber-900/40 px-1 py-0.5 rounded font-mono text-[9px]">VITE_GOOGLE_MAPS_API_KEY</code> to <code className="bg-amber-900/40 px-1 py-0.5 rounded font-mono text-[9px]">.env</code> to enable photorealistic tiles.
          </div>
        )}

        {/* Toggle between Option A (Historical) and Option B (Predictive Model) */}
        <div className="flex rounded bg-ink-900/60 p-0.5 border border-ink-800 mb-3 text-[10px] font-bold uppercase">
          <button
            onClick={() => {
              setSimMode('predictive');
              handleReset();
            }}
            className={`flex-1 rounded py-1 transition-colors ${
              simMode === 'predictive'
                ? 'bg-ink-800 text-ink-100 shadow-sm border border-ink-700/50'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            Predictive Model (Option B)
          </button>
          <button
            onClick={() => {
              setSimMode('historical');
              handleReset();
            }}
            className={`flex-1 rounded py-1 transition-colors ${
              simMode === 'historical'
                ? 'bg-ink-800 text-ink-100 shadow-sm border border-ink-700/50'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            Historical Preset (Option A)
          </button>
        </div>

        {/* Selected Simulation Mode description metadata */}
        {simMode === 'historical' ? (
          (() => {
            const countyId = selectedCell?.region ?? cells[0]?.region ?? 'boulder-co';
            const histFire = getHistoricalFire(countyId);
            return (
              <div className="mb-3 rounded border border-ink-850 bg-ink-900/30 p-2 text-[10px] text-ink-400 leading-normal">
                <span className="font-bold text-heat-500 uppercase block mb-0.5">📂 CAL FIRE FRAP Dataset Active</span>
                Replaying the historical footprint of the <strong>{histFire.name} ({histFire.year})</strong> which burned approximately <strong>{histFire.acres.toLocaleString()} acres</strong> in this region.
              </div>
            );
          })()
        ) : (
          <div className="mb-3 rounded border border-ink-850 bg-ink-900/30 p-2 text-[10px] text-ink-400 leading-normal">
            <span className="font-bold text-cool-500 uppercase block mb-0.5">🧠 Predictive Simulation (FireSenseNet)</span>
            Modeling fire propagation using client-side approximations of the <strong>FireSenseNet</strong> convolutional network and <strong>FireCast</strong> forecasting algorithms.
          </div>
        )}

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

        {/* Wind controls */}
        <div className="space-y-3 border-t border-ink-850 pt-3">
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
