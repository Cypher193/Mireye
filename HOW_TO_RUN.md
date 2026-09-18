# CCG Engine — How to Run Guide

Welcome to the **Coverage-Combustibility Gap (CCG) Engine**, a spatial intelligence and wildfire risk digital twin platform featuring **WebGPU compute acceleration**, real-time meteorological feeds, and multi-tiered 3D render caching.

---

## 1. Quick Start

### Prerequisites
- **Node.js**: `v18.0.0` or higher (recommended: LTS v20+)
- **Package Manager**: `npm` (comes with Node)
- **Modern Browser**: Google Chrome 113+, Microsoft Edge 113+, Brave, or Arc (with WebGPU support enabled)

### Step-by-Step Installation

1. **Open Terminal & Navigate to Project**:
   ```bash
   cd c:\Users\joshi\learning\mireye\mireye-test
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```

4. **Launch in Browser**:
   Open your browser and navigate to:
   ```
   http://localhost:5173/
   ```

---

## 2. Environment Configuration (Optional)

The application works **100% out-of-the-box** without any API keys, using ESRI World Imagery for satellite draping and Open-Meteo for real-time surface meteorology.

If you wish to enable Google Photorealistic 3D Tiles, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

And set your API key in `.env`:
```env
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

---

## 3. Navigating the Platform

### A. National 50-State View
- **Interactive USA Map**: Click any of the 50 US states on the vector map to immediately focus on that state.
- **State / County Selectors**: Use the dropdown menus in the header to switch between states (e.g., California, Colorado, Oregon, Texas, Florida) and counties.
- **Top Fire Clusters**: Click on historically high-fire counties (e.g., Boulder CO, Santa Barbara CA, Los Angeles CA, San Diego CA) for pre-cached analytics.

### B. County-Level Hexagonal Grid
- **H3 Hexagonal Cells**: Displays Ignition Potential Score (IPS), Response Capability Score (RCS), and the resulting Coverage-Combustibility Gap (CCG).
- **Risk Legend**:
  - 🔴 **Severe** ($CCG \ge 0.75$)
  - 🟠 **High** ($CCG \ge 0.50$)
  - 🟡 **Elevated / Moderate** ($CCG < 0.50$)
- **USFA Station Beacons**: Blue glowing beacons indicate the nearest responding fire station with real-time drive-time minutes.

### C. 3D Digital Twin Simulation
Click the **"3D Simulation View"** button in the navigation header to enter the 3D digital twin:
- **Navigation Controls**:
  - **Left Click + Drag**: Rotate camera azimuth and pitch.
  - **Right Click + Drag**: Pan the map across East/North tangent planes.
  - **Scroll Wheel**: Zoom in / out.
- **Simulation Modes**:
  - **Predictive Model (Option B)**: Runs client-side approximations of the **FireSenseNet** convolutional network and **FireCast** Rothermel dynamics.
  - **Historical Preset (Option A)**: Replays official CAL FIRE FRAP historical fire perimeter footprints (e.g., Marshall Fire, Thomas Fire).
- **Interactive Physics Controls**:
  - **Run Physics / Pause Sim**: Starts real-time front propagation and 3D ember drift.
  - **Wind Angle Slider ($0^\circ$ to $360^\circ$)**: Dynamically steers fire propagation and smoke drift.
  - **Wind Speed Slider ($0$ to $45$ mph)**: Accelerates rate-of-spread and flame length.
  - **Live Weather Sync**: Click **"Sync"** to pull live temperature, relative humidity, and wind vectors directly from NOAA / Open-Meteo.

---

## 4. WebGPU Acceleration & Hardware Telemetry

The platform includes native **WGSL (WebGPU Shading Language)** compute pipelines running on your discrete GPU:

1. **Parallel Rothermel Fire Spread**:
   - Calculates distance, slope vectors, and wind alignment dot products across all cells simultaneously in parallel GPU workgroups.
   - Provides sub-millisecond compute passes (typically **0.2ms – 0.5ms** on modern GPUs).
2. **3D Convective Plume Dynamics**:
   - Computes thermal updraft buoyancy, logarithmic wind shear advection, and 3D curl turbulence directly in GPU buffers.
3. **Telemetry Badge**:
   - Look at the top-left floating control panel to verify your active hardware:
     - `⚡ WebGPU Hardware Active · 0.28ms GPU · NVIDIA Ada Lovelace`
     - If your browser does not support WebGPU, it automatically falls back to `Cpu WebGL 2.0 Fallback` with zero disruption.

---

## 5. Multi-Tiered Render Caching

The application is engineered to minimize network requests and GPU idle power:

| Tier | Storage | Description |
| :--- | :--- | :--- |
| **Tier 1: Aerial Imagery** | **IndexedDB** (`CCG_3D_RenderCache`) | Aerial satellite basemaps are cached offline in binary format. Revisiting a county hydrates textures instantly (<5ms) showing the `💾 Cached (IndexedDB)` indicator. |
| **Tier 2: Topography** | **RAM Geometry Pool** | High-density mountain elevation plane meshes are pooled in memory to eliminate re-allocation overhead. |
| **Tier 3: On-Demand Loop** | **Dirty-Flag Controller** | The Three.js render loop only renders frames during user interaction or active simulation, dropping idle GPU utilization to near 0%. |

---

## 6. Available CLI Scripts

Run these commands from inside the `mireye-test/` directory:

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts Vite local development server on port 5173 with HMR. |
| `npm run build` | Compiles production-ready bundle into the `dist/` directory. |
| `npm run preview` | Locally serves the production `dist/` build. |
| `npm run typecheck` | Executes TypeScript typecheck (`tsc --noEmit`). |
| `npm run lint` | Runs ESLint across all TypeScript and React files. |

---

## 7. Troubleshooting

### Port 5173 is already in use
If another process is using port 5173:
```bash
# Option 1: Let Vite use the next available port automatically
npm run dev

# Option 2: Specify a custom port
npm run dev -- --port 3000
```

### Enabling WebGPU in Chrome / Edge
If your browser shows `WebGL 2.0 Fallback` instead of `WebGPU Hardware Active`:
1. Navigate to `chrome://flags/#enable-unsafe-webgpu` in Chrome or `edge://flags/#enable-unsafe-webgpu` in Edge.
2. Set the flag to **Enabled**.
3. Relaunch the browser and refresh `http://localhost:5173/`.

### Resetting Cached Satellite Imagery
To clear the offline satellite basemap cache:
1. Open Chrome DevTools (`F12` or `Ctrl + Shift + I`).
2. Go to **Application** &rarr; **Storage** &rarr; **IndexedDB**.
3. Right-click `CCG_3D_RenderCache` and click **Delete Database**.
4. Refresh the page to re-fetch fresh satellite tiles.
