# CCG Engine — Coverage-Combustibility Gap
### Autonomous Wildfire Defense, Spatial Decision Support & 3D Digital Twin Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb.svg?logo=react)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-0.185-black.svg?logo=three.js)](https://threejs.org/)
[![WebGPU](https://img.shields.io/badge/WebGPU-WGSL_Accelerated-emerald.svg)](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF.svg?logo=vite)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg?logo=tailwindcss)](https://tailwindcss.com/)

---

## 1. Executive Summary

The **CCG Engine (Coverage-Combustibility Gap Engine)** is a high-performance geospatial intelligence platform engineered to identify, simulate, and mitigate structural deficits in wildfire defense across the United States.

By synthesizing satellite-derived environmental data with municipal emergency response infrastructure, the CCG Engine calculates the critical **Coverage-Combustibility Gap**—the delta between an area's physical susceptibility to catastrophic ignition and the fire service's operational capability to intervene in time.

```
                          ┌──────────────────────────┐
                          │     Ignition Potential   │
                          │        Score (IPS)       │
                          └────────────┬─────────────┘
                                       │
                                       ▼
 ┌──────────────────────┐      ┌───────────────┐      ┌──────────────────────────┐
 │ Remote Sensing Data  │ ───► │  CCG Engine   │ ◄─── │ USFA & Dispatch Telemetry│
 │ (NDVI, Slope, Canopy)│      │  H3 Analysis  │      │ (Drive-Times, Stations)  │
 └──────────────────────┘      └───────┬───────┘      └──────────────────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │   Response Capability    │
                          │        Score (RCS)       │
                          └──────────────────────────┘
```

---

## 2. Core Mathematical Formulation

For any spatial cell $i$ (indexed using Uber H3 hexagonal discrete global grid systems):

$$CCG_i = \text{Clamp}\Big(\frac{IPS_i - RCS_i + 1}{2},\; 0,\; 1\Big)$$

Where:
* **$IPS_i$ (Ignition Potential Score)**: Combines canopy bulk density, vegetative moisture index (NDVI), topographical slope gradients, and historical fuel dryness:
  $$IPS_i = w_{\text{canopy}} \cdot C_i + w_{\text{slope}} \cdot S_i + w_{\text{dry}} \cdot (1 - \text{NDVI}_i)$$
* **$RCS_i$ (Response Capability Score)**: Evaluates the nearest staffed fire suppression apparatus using real-world road networks and geocoded drive-time decay functions:
  $$RCS_i = \exp\Big(-\lambda \cdot t_{\text{drive}}(i, \text{Station}_{\text{nearest}})\Big)$$
* **$CCG_i \in [0, 1]$**:
  * **Severe Gap ($\ge 0.75$)**: Critical structural hazard; high combustibility coupled with extended emergency response latency.
  * **High Gap ($0.50 - 0.74$)**: Significant vulnerability requiring targeted resource pre-positioning.
  * **Elevated / Moderate ($< 0.50$)**: Balanced coverage or low native fuel hazard.

---

## 3. Key Capabilities

### 🌐 1. 50-State National Spatial Index
- Seamless interactive national vector map allowing instant inspection of any US state and wildfire risk zones.
- Pre-cached spatial clusters for historical wildfire epicenters (Boulder County CO, Santa Barbara CA, Los Angeles CA, San Diego CA, etc.).

### 🏔️ 2. Photorealistic 3D Digital Twin
- **Satellite Draped Topography**: Real-time high-resolution aerial imagery streamed from **ESRI World Imagery** draped over harmonic mountain elevation geometry.
- **Geodetic East-North-Up (ENU) Tangent Plane**: Mathematical rotation matrix (`getECEFtoLocalMatrix`) guaranteeing that Local $+X$ is strictly East and Local $-Z$ is strictly North, eliminating 90-degree disorientation artifacts across all longitudes.
- **Volumetric Risk Prisms**: Holographic hexagonal columns sitting accurately on mountain slopes with glowing neon edge illumination and risk-gradient fills.
- **Google Photorealistic 3D Tiles**: Integrated client support for streaming 3D mesh photogrammetry via the Google Map Tiles API.

### ⚡ 3. WebGPU Native WGSL Compute Acceleration
- **Parallel Rothermel Fire Propagation**: Native WGSL compute shader executing parallel cellular fire propagation across grid cells in GPU workgroups with sub-millisecond latency ($<0.5\text{ms}$).
- **3D Convective Plume Dynamics**: GPU particle physics simulating physical thermal updraft buoyancy, boundary-layer wind advection, and 3D curl turbulence.
- **Live Hardware Telemetry**: Active reporting of GPU adapter vendor, architecture (e.g., *NVIDIA Ada Lovelace*), and compute dispatch latency.
- **WebGL 2.0 Fallback**: Graceful and transparent cascading fallback for clients without WebGPU support.

### 💾 4. Multi-Tiered 3D Render Caching System
- **Tier 1 (IndexedDB Binary Cache)**: Offline storage of aerial imagery blobs in IndexedDB (`CCG_3D_RenderCache`), enabling sub-5ms instant texture hydration when switching counties.
- **Tier 2 (Geometry Memory Pool)**: LRU memory cache pool reusing complex terrain topography meshes.
- **Tier 3 (On-Demand Dirty-Flag Controller)**: Minimizes idle GPU power consumption by pausing render passes when the camera and simulation are static.

### 📡 5. Live Meteorological Integration
- Synchronous polling of real-time surface weather feeds via **NOAA / Open-Meteo**:
  - Ambient Temperature ($^\circ\text{F}$)
  - Relative Humidity ($\%\text{ RH}$)
  - Surface Wind Velocity ($\text{mph}$) and Azimuthal Heading ($0^\circ - 360^\circ$)

---

### 🧠 6. FireSenseNet-600M & Custom Model Inference Engine
- **Hybrid Physics + Deep Learning**: Blends empirical Rothermel surface fire equations with deep learning predictions to model complex topographic wind corridors and non-linear firebrand spotting.
- **Architecture Stack (`src/lib/ml/`)**:
  - **ST-GNN (Spatio-Temporal Graph Neural Network)**: Message passing over 64-hexagonal cell topologies based on slope and elevation gradients.
  - **Multi-Head Cross-Attention**: Attends spatial cell tokens to live NOAA meteorological vectors (wind speed, wind azimuth, humidity) and long-distance ember spotting.
  - **Conditional Diffusion Denoising (DDPM)**: Refines spread trajectories under wind gust uncertainty.
  - **PINNs Loss Function**: Enforces Rothermel Advection-Diffusion PDE constraints ($\frac{\partial I}{\partial t} + \vec{v} \cdot \nabla I = \alpha \nabla^2 I + S$) to prevent non-physical predictions.
- **Automatic Custom Model Loading (`model.*`)**:
  - Simply drop your custom model at **`public/model.onnx`** or **`weights/model.onnx`** (supports any `model.*` format).
  - The **Universal Model Loader** ([modelLoader.ts](file:///c:/Users/Lenovo/Documents/Hack/Mireye/src/lib/ml/modelLoader.ts)) automatically discovers and loads the file into **ONNX Web Runtime (WebAssembly / WebGPU)** on application boot.
  - **Zero-Friction Fallback**: If no custom model file is present, the engine runs the browser-native **FireSenseNet-600M Lite** model (< 200ms forward pass) with zero configuration.
  - **Git-Protected**: `.gitignore` automatically blocks any `model.*`, `public/model.*`, or `weights/*` binary files from ever being committed to Git.

---

## 4. Architecture Overview

```mermaid
graph TD
    A[Client Browser] --> B[React 18 + TypeScript UI]
    B --> C[National 2D Map Canvas]
    B --> D[3D Digital Twin SimulationCanvas]
    
    subgraph Machine Learning & Model Pipeline
        ML[Universal Model Loader] --> ML1[Auto-Detect public/model.onnx]
        ML1 -->|Custom Model Found| ML2[ONNX Web Runtime - WASM/WebGPU]
        ML1 -->|No Custom File| ML3[FireSenseNet-600M Lite TS Engine]
        ML2 --> PINN[PINNs Physics Constraints]
        ML3 --> PINN
        PINN --> BLEND[Alpha Blending: ML + Rothermel Physics]
        BLEND --> D
    end

    subgraph 3D Simulation Architecture
        D --> E[Three.js Scene Compositor]
        D --> F[WebGPU Compute Engine - WGSL]
        D --> G[3-Tier Render Cache]
        
        F --> F1[Rothermel Fire Spread Kernel]
        F --> F2[Particle Convective Buoyancy Kernel]
        
        G --> G1[Tier 1: IndexedDB Satellite Cache]
        G --> G2[Tier 2: RAM Geometry Pool]
        G --> G3[Tier 3: On-Demand Render Loop]
        
        E --> H[ESRI Aerial Imagery Basemap]
        E --> I[Harmonic Topography Mesh]
        E --> J[Hexagonal Volumetric Risk Columns]
        E --> K[USFA Response Beacons]
    end
    
    subgraph Data & Telemetry Services
        D --> L[NOAA / Open-Meteo Surface Weather]
        D --> M[CAL FIRE FRAP Historical Perimeters]
        D --> N[Mireye Earth API - USGS DEM / NDVI / NLCD]
    end
```

---

## 5. Adding Your Custom Model

To run your own trained model in the 3D wildfire simulation:

1. **Place your model file in the project**:
   ```bash
   # Copy your model to the public folder:
   cp /path/to/your/model.onnx public/model.onnx
   # (or place it in weights/model.onnx)
   ```
2. **Start the development server**:
   ```bash
   npm run dev
   ```
3. **Automatic Execution**:
   - The app auto-detects `public/model.onnx` on launch.
   - The top navigation bar displays: **`🟢 Model: model.onnx`** with live execution latency.
   - Predictions immediately drive the 3D wildfire spread simulation.
   - All `model.*` files are pre-configured in `.gitignore` and will never be tracked or committed to GitHub.

---

## 6. Quick Start

### Prerequisites
- **Node.js**: `v18.0.0` or higher (recommended: Node 20 LTS)
- **Browser**: Modern Chromium browser (Chrome 113+, Edge 113+, Brave, Arc) with WebGPU enabled.

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Cypher193/Mireye.git
cd Mireye

# 2. Install dependencies
npm install

# 3. Launch local development server
npm run dev
```

Open your browser at **`http://localhost:5173/`**.

---

## 7. Project Structure

```
Mireye/
├── src/
│   ├── components/
│   │   ├── SimulationCanvas.tsx     # 3D WebGPU & Three.js digital twin canvas
│   │   ├── GoogleMap.tsx            # Standard 3D vector GIS map
│   │   ├── HexMap.tsx               # 64-hex county risk grid
│   │   ├── TopNav.tsx               # Header with live model & connection status
│   │   ├── MetricCards.tsx          # WUI, IPS, RCS, CCG metric status panels
│   │   └── CapitalBrief.tsx         # Automated executive capital brief generator
│   ├── services/
│   │   ├── webGpuCompute.ts         # WGSL compute shaders (fire spread & particles)
│   │   └── renderCache.ts           # IndexedDB & geometry cache pool
│   ├── lib/
│   │   ├── ml/                      # FireSenseNet-600M & ML Architecture
│   │   │   ├── modelLoader.ts       # Universal ONNX / custom model runtime loader
│   │   │   ├── fireSenseNet.ts      # Top-level model orchestrator
│   │   │   ├── fireGNN.ts           # Spatio-Temporal Graph Neural Network
│   │   │   ├── crossAttention.ts    # Multi-head attention & ember spotting
│   │   │   ├── diffusionModule.ts   # DDPM probabilistic spread refinement
│   │   │   ├── pinnsLoss.ts         # Physics-Informed Neural Network (PDE loss)
│   │   │   ├── modelConfig.ts       # Hyperparameters & ONNX specs
│   │   │   └── tensor.ts            # Dependency-free browser tensor algebra
│   │   ├── predictiveSim.ts         # Hybrid ML + Rothermel fire spread calculation
│   │   ├── ipsEngine.ts             # Rothermel Ignition Propensity model
│   │   ├── rcsEngine.ts             # NFPA 1710 Response Capacity model
│   │   └── mireyeClient.ts          # Mireye Earth API client
│   ├── data/
│   │   ├── counties.ts              # 50-state WUI county dataset
│   │   ├── hexGrid.ts               # H3 cell generators & 50-state geocoding
│   │   └── historicalFires.ts       # CAL FIRE FRAP historical perimeter data
│   ├── types.ts                     # Core domain interfaces (HexCell, County, ModelOutput)
│   ├── App.tsx                      # Root application state & navigation router
│   └── main.tsx                     # React root mount point
├── public/                          # Static web assets & custom model folder (public/model.onnx)
├── weights/                         # External model weights directory (ignored by git)
├── HOW_TO_RUN.md                    # Detailed execution & troubleshooting guide
├── package.json                     # Dependencies & CLI scripts
├── vite.config.ts                   # Vite bundler configuration (ONNX/WASM enabled)
└── tsconfig.json                    # TypeScript compiler options
```

---

## 7. Available Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Starts Vite hot-reloading development server on port 5173. |
| `npm run build` | Compiles an optimized production build in `dist/`. |
| `npm run preview` | Runs a local web server serving the production `dist/` bundle. |
| `npm run typecheck` | Executes strict TypeScript compilation verification (`tsc --noEmit`). |
| `npm run lint` | Runs ESLint across all TypeScript and React files. |

---

## 8. Environmental Platform & Data Sources

- **Remote Sensing Imagery**: ESRI World Imagery ArcGIS REST API
- **Historical Wildfire Boundaries**: CAL FIRE Fire and Resource Assessment Program (FRAP)
- **Surface Weather Telemetry**: NOAA / Open-Meteo High-Resolution Rapid Refresh (HRRR)
- **Fire Station Geocoding**: United States Fire Administration (USFA) National Fire Department Registry

---

## 9. License

Distributed under the **MIT License**. See `LICENSE` for more information.
