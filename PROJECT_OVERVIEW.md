# CCG Engine — Coverage-Combustibility Gap
## Autonomous Wildfire Defense & Spatial Decision Support Platform

---

### Table of Contents
1. [Repository & GitHub Synchronization Status](#1-repository--github-synchronization-status)
2. [Project Objective & Problem Formulation](#2-project-objective--problem-formulation)
3. [Mireye Earth Platform & Environmental Data Model](#3-mireye-earth-platform--environmental-data-model)
4. [Live Operational Status of All APIs & Endpoints](#4-live-operational-status-of-all-apis--endpoints)
5. [What Has Been Implemented Till Now](#5-what-has-been-implemented-till-now)
6. [Roadmap: What Is Yet To Be Done & Future Improvements](#6-roadmap-what-is-yet-to-be-done--future-improvements)
7. [Token Optimization Guide for AI Agents: Files to Avoid](#7-token-optimization-guide-for-ai-agents-files-to-avoid)

---

### 1. Repository & GitHub Synchronization Status

The project codebase is fully synchronized with the GitHub remote repository.

* **GitHub Repository:** [Cypher193/Mireye](https://github.com/Cypher193/Mireye.git)
* **Local Project Paths:**
  * Root Workspace: `c:\Users\joshi\learning\mireye`
  * Active Application & Git Root: `c:\Users\joshi\learning\mireye\mireye-test`
* **Active Branch:** `main` (tracked to `origin/main` and mirrored to `origin/Deepanshu`)
* **Latest Synchronized Commit:** `8ff89d9` — *`fix: lock map rotation to North, remove scan line effect, lighten cell colors, and strengthen boundaries`*
* **Working Tree State:** Clean, 0 uncommitted changes, 0 untracked files, 0 merge conflicts.

---

### 2. Project Objective & Problem Formulation

#### A. The Core Problem
In the United States, Wildland-Urban Interface (WUI) housing developments are expanding rapidly into fire-prone vegetative landscapes. Meanwhile, municipal fire departments and rural volunteer fire departments (VFDs) face extreme equipment and staffing deficits.

Traditional wildfire management tools suffer from two critical flaws:
1. **Ecological Isolation:** Predictive fire spread models (such as Rothermel or FARSITE) focus solely on fuel models, humidity, and slope without accounting for municipal response capacity or station apparatus dispatch times.
2. **Administrative Latency:** Capital allocation briefs, apparatus pre-positioning requests, and grant proposals require weeks of manual GIS synthesis by emergency managers, losing critical time ahead of peak fire seasons.

#### B. The CCG Mathematical Formulation
The **CCG Engine** unifies environmental physics with municipal operational capabilities into three deterministic scores:

```
                  +-----------------------------------+
                  |         IPS Engine                |
                  |  (Rothermel Topography + Fuel)   |
                  +-----------------+-----------------+
                                    |
                                    v
+------------------+         [ CCG Multiplier ]         +-------------------+
| Live Mireye /v1/ +-------->  CCG = IPS x     <--------+ Live Proximity &  |
| Earth Telemetry  |          (1 - RCS)                 | USFA Registry     |
+------------------+                    ^               +-------------------+
                                        |
                  +---------------------+-------------+
                  |         RCS Engine                |
                  |  (NFPA 1710 Initial Attack <=6m)  |
                  +-----------------------------------+
```

##### 1. Ignition Propensity Score (IPS) $[0.0 - 1.0]$
IPS evaluates the physical vulnerability of a geographical sector based on Rothermel surface fire equations:
$$\text{IPS} = 0.30 \cdot \text{SlopeNorm} + 0.35 \cdot \text{FuelProxy} + 0.20 \cdot \text{WindDrynessProxy} + 0.15 \cdot (1 - \text{ThermalInertia})$$

* **Slope Gradient ($30\%$):** Normalized over $0^\circ - 45^\circ$. Steeper topography physically tilts flames closer to unignited fuels ahead of the front, exponentially accelerating convective heat transfer.
* **Fuel Loading Proxy ($35\%$):** Combines tree canopy percentage ($60\%$) with living vegetation moisture inversion ($40\%$) derived from the Normalized Difference Vegetation Index (NDVI).
* **Wind / Drought Stress Trend ($20\%$):** 5-year NDVI degradation trend. Negative delta indicates vegetation stress, dieback, and accumulated dead fine fuel loading.
* **Thermal Inertia Damping ($15\%$):** Elevation-based adiabatic cooling that damps thermal ignition potential in high-altitude zones.

##### 2. Response Capacity Score (RCS) $[0.0 - 1.0]$
RCS evaluates operational fire suppression capability against **NFPA 1710 standards** ($\le 6$ minutes initial apparatus response benchmark):
$$\text{RCS} = \text{clamp}_{0..1}\left(\frac{6}{\text{DriveTimeMinutes}} \times 0.50 + \frac{\text{StaffedStations}}{4} \times 0.50\right)$$

##### 3. Coverage-Combustibility Gap (CCG) $[0.0 - 1.0]$
The multiplicative gap score identifying high-flammability housing clusters with inadequate suppression access:
$$\text{CCG} = \text{IPS} \times (1 - \text{RCS})$$

* **$\text{CCG} \ge 0.75$ (Severe — Crimson Red):** High ignition risk coupled with $\ge 12$ min drive times. Requires immediate Type 1 apparatus pre-positioning and mobile water tenders.
* **$0.50 \le \text{CCG} < 0.75$ (Critical — Orange):** Moderate-to-high fire risk with drive times exceeding NFPA 6-minute benchmarks.
* **$0.25 \le \text{CCG} < 0.50$ (Elevated — Amber/Yellow):** Moderate risk with marginal station coverage.
* **$\text{CCG} < 0.25$ (Low — Navy Blue):** Low fuel density or rapid suppression coverage within $\le 6$ minutes.

---

### 3. Mireye Earth Platform & Environmental Data Model

**Mireye Earth** indexes federal-grade geospatial intelligence from USGS, FEMA, NOAA, USDA Forest Service, and the US Census Bureau, making physical environmental conditions queryable via structured APIs.

#### Confirmed Wildfire Fields Ingested:
* `slope_degrees`: Direct topographic incline in degrees, extracted from USGS digital elevation models (DEM).
* `tree_canopy_pct`: Forest canopy density from NLCD (National Land Cover Database).
* `ndvi_current`: Current satellite surface reflectance indicating living vegetative moisture.
* `ndvi_change_5y`: 5-year longitudinal delta identifying drought-stressed vegetation beds.
* `elevation`: Absolute elevation above sea level in meters.
* `lcms_class`: Landscape Change Monitoring System land cover classification, validating whether a cell sits inside a true residential Wildland-Urban Interface (LCMS class $\ge 4$).

---

### 4. Live Operational Status of All APIs & Endpoints

A comprehensive audit of all API services utilized or integrated within the application:

#### A. Mireye Earth Platform APIs (`https://api.mireye.com`)

| Endpoint & Method | Live Status | Technical Details & Current Handling |
| :--- | :---: | :--- |
| **`GET /v1/meta/fields`** | **WORKING** | Verifies on application boot. Confirms field availability and active billing metadata for target environmental fields. |
| **`POST /v1/fetch`** | **WORKING** | Returns coordinate-level terrain, vegetative, and structural values with confidence scores and source attributions. |
| **`POST /v1/fetch/batch`** | **WORKING** | Chunked in 25-location blocks with automated 429 rate-limit backoff (`Retry-After` header extraction). Populates all 64 hex cells in a county in under 2 seconds. |
| **`POST /v1/fetch/quote`** | **WORKING** | Quotes estimated credit cost prior to batch execution. |
| **`POST /v1/geocode`** | **NOT WORKING**<br>*(Plan Restriction)* | The current API key tier returns 404 / unauthorized for this endpoint. The app routes geocoding requests through OpenStreetMap Nominatim. |
| **`POST /v1/proximity`**<br>`@fire_stations`, `@usfa` | **NOT WORKING**<br>*(Plan Restriction)* | Curated proximity datasets (`@fire_stations`, `@emergency_services`, `@usfa`) are not enabled on this plan tier. The engine detects failure on first call and engages the USFA station dataset fallback. |

#### B. Third-Party Geospatial & Engine APIs

| Service | Live Status | Technical Details & Current Handling |
| :--- | :---: | :--- |
| **OpenStreetMap Nominatim** | **WORKING** | Free, unauthenticated geocoder used in `mireyeClient.ts` to convert city/county names to exact geographic centroids. |
| **Google Maps Platform** | **WORKING** | Vector 3D WebGL map loaded in `GoogleMap.tsx` using `VITE_GOOGLE_MAPS_API_KEY`. Renders terrain contours, camera tilt, fire stations, and WUI risk circles. |
| **Three.js WebGL Engine** | **WORKING** | Client-side 3D simulation canvas (`SimulationCanvas.tsx`) operating in Earth-Centered, Earth-Fixed (ECEF) Cartesian coordinates. |
| **CAP 1.2 XML Engine** | **WORKING**<br>*(Client-Side)* | `capGenerator.ts` generates standardized Common Alerting Protocol XML feeds with copy and export functionality. |

#### C. Future External Roadmap APIs

| External System | Live Status | Prerequisites for Activation |
| :--- | :---: | :--- |
| **NOAA / MesoWest Weather API** | **NOT CONNECTED** | Current simulation uses interactive UI sliders. Needs direct API key for real-time wind speed and relative humidity telemetry. |
| **NASA FIRMS / VIIRS Hotspots** | **NOT CONNECTED** | Currently utilizes verified historical perimeters (Marshall, Tubbs, Camp). Needs FIRMS active fire API key for live thermal anomaly triggers. |
| **CAD Dispatch (Resgrid / Mark43)** | **NOT CONNECTED** | Simulated in the AI terminal trace. Requires agency OAuth2 credentials for live dispatch ticketing. |
| **FEMA IPAWS Broadcast Gateway** | **NOT CONNECTED** | XML feed is generated locally; transmission requires authorized Collaborative Operating Group (COG) credentials. |

---

### 5. What Has Been Implemented Till Now

1. **Nationwide 50-State Interactive Map & Regional Centroids**:
   * Complete 50-State US vector SVG map (`USAMapPaths.ts`) with interactive, clickable state boundaries.
   * Comprehensive 50-State dataset (`counties.ts`) with designated high-risk WUI / rural fire counties for every state, containing exact coordinates, population, WUI housing unit counts, fire district numbers, staffed stations, and calculated SVG anchor centers (`cx`, `cy`).
   * Smooth click-to-zoom transition: Clicking any state polygon, city marker, or honeycomb cluster smoothly zooms into that state's county grid.

2. **Searchable Multi-State Location Selector**:
   * Instant search filter in `LocationSelector.tsx` allowing search by state code (e.g. `CA`, `FL`, `TX`), county name, or city.
   * Scrollable dropdown viewport (`max-h-64`) with state badges, WUI unit counts, and live geocoded coordinate indicators.

3. **64-Hex High-Resolution County Risk Grids**:
   * Local H3-style hexagonal grid per county displaying real-time risk scores from Navy Blue (Low Risk) to Deep Crimson (Severe Risk).
   * Circular WUI hotspot markers highlighting priority housing clusters.

4. **Production-Grade Mireye Earth Integration**:
   * Typed client (`mireyeClient.ts`) with Bearer JWT authentication, 25-coordinate batch chunking, 150ms staggered requests, and automatic 429 backoff handling.
   * Multi-tiered caching (sessionStorage + in-memory store) preventing redundant queries.

5. **Real-Time Meteorology Ingestion (Open-Meteo / NOAA Feed)**:
   * Dynamic live weather ingestion integrated into `SimulationCanvas.tsx`.
   * Automatically queries and updates `windSpeed` (mph) and `windAngle` (°) for the coordinates of any selected county or hex.
   * Displays live surface temperature (°F) and relative humidity (%) with a live sync status indicator and manual re-sync button.

6. **Dual Visualizer Engine**:
   * **Standard 3D Map (`GoogleMap.tsx`)**: Google Maps Platform WebGL vector map with 3D buildings, tilt, heading controls, fire station markers, and interactive hover cards.
   * **3D Simulation Canvas (`SimulationCanvas.tsx`)**: Three.js WebGL engine operating in Earth-Centered, Earth-Fixed (ECEF) Cartesian coordinates with fire station beacon towers, response lines, and wind-drifted smoke/fire particle emitters.

7. **Deterministic Physics Engines**:
   * `ipsEngine.ts`: Rothermel-inspired formula calculating normalized slope, fuel proxy, wind proxy, and thermal inertia.
   * `rcsEngine.ts`: NFPA 1710 compliance calculator (6-minute initial response benchmark) using live Mireye proximity queries and USFA registry fallback.

8. **AI Reasoning Trace & Terminal Console**:
   * Real-time streaming terminal (`AIReasoningTrace.tsx`) detailing each step taken by the AI agent, displaying real API calls, latency measurements (in ms), parameter weights, and intermediate math.

9. **Executive Capital Brief System with 1-Click Export & Copy**:
   * `capitalBriefEngine.ts` compiles a three-paragraph, board-ready resource allocation justification based on live API telemetry.
   * `CapitalBrief.tsx` includes 1-click download of structured markdown briefs (`Capital_Brief_<County>_<HexId>.md`) and 1-click clipboard copy with animated feedback.

10. **Phase 2 Active Fire Response & OASIS CAP 1.2 Alert Generator**:
    * Historical spread footprints for landmark California/Colorado wildfires (Marshall, Tubbs, Camp, Cedar, etc.).
    * Elliptical Rothermel predictive fire spread modeling with adjustable wind velocity/heading and timestep sliders.
    * OASIS CAP 1.2 (Common Alerting Protocol) XML generator (`capGenerator.ts`) with 1-click copy and download for emergency broadcasts.

11. **Technical Pipeline Specification & Agent Token Optimization**:
    * `TECHNICAL_PIPELINE.md` documenting complete data pipelines, mathematical formulas, WGS84-to-ECEF math, and state lifecycles.
    * `.agentignore` preventing token exhaustion from build artifacts, lockfiles, and raw SVG coordinates.

---

### 6. Roadmap: What Is Still Left & Yet To Be Done

#### A. Pre-Caching & Static Bundles for Top US Megafire Hotspots
* **Static JSON Pre-baking:** Generate pre-baked 64-hex telemetry files for the top 16 historical wildfire counties (e.g. Butte/Paradise CA, San Diego CA, Maui/Lahaina HI, Boulder CO, Coconino AZ, Jackson/Ashland OR, Chelan WA, Sevier/Gatlinburg TN).
* **Instant Zero-Latency Loading:** Hydrate hotspot grids in sub-5ms with zero Mireye API credit consumption.

#### B. Real-Time Satellite Thermal Anomaly Detection (NASA FIRMS)
* **Live MODIS / VIIRS Ingestion:** Ingest 375m active satellite thermal anomaly feeds to automatically trigger Phase 2 active fire tracking the moment an ignition occurs.

#### C. Model Context Protocol (MCP) Server & SafeMCP Integration
* **Expose CCG as an MCP Server (`ccg-mcp`):** Allow external LLM agents (Claude Desktop, Gemini Antigravity, ChatGPT) to call tools like `get_hex_physics(lat, lng)`, `compute_ccg_gap()`, and `generate_capital_brief()` over JSON-RPC.
* **SafeMCP Guardrails:** Integrate human-in-the-loop safety checks before allowing the agent to stage emergency notification broadcasts or CAD dispatch proposals.

#### D. Computer-Aided Dispatch (CAD) & Mutual Aid Routing
* **Direct CAD System Integration:** Interface with open/commercial CAD platforms (e.g., Resgrid API/MCP, Mark43) to pre-populate response tickets for recommended apparatus.
* **Wildfire-Aware Road Network Routing:** Integrate OSRM or Google Directions API with dynamic terrain/smoke obstruction penalties, accounting for narrow rural roads, one-lane mountain bridges, and active fire perimeter road closures.

#### E. Parcel-Level Structural Vulnerability (NFPA 1144 Compliance)
* **Building Footprints & Parcel Boundaries:** Ingest county tax assessor and Microsoft Building Footprint data to calculate defensible space buffers (30–100 ft) per parcel.
* **Computer Vision Roof & Cladding Classification:** Use aerial orthomosaics to automatically tag combustible wood shake roofs, open eaves, and unmaintained brush directly adjacent to residential structures.

#### F. Physics-Informed Neural Networks (PINNs) & Firebrand Spotting
* **Surrogate PINN Fluid Solvers:** Supplement 2D elliptical approximations with GPU-accelerated PINN world models (e.g., PhysFire-WM) to capture 3D flame-atmosphere coupling, crown fire transitions, and urban canyon Venturi wind accelerations in milliseconds.
* **Firebrand (Ember) Transport Modeling:** Implement Monte Carlo aerodynamic drag models that simulate embers lofted by convective plumes landing downwind, predicting spot ignitions 1–3 miles ahead of the main firefront.

#### G. Evacuation Traffic Dynamics & Public Alerting (IPAWS)
* **WUI Evacuation Bottleneck Analysis:** Simulate civilian vehicular egress rates against arterial road capacities to identify trapped communities before an order is issued.
* **Two-Way FEMA IPAWS / Wireless Emergency Alerts (WEA):** Connect the CAP 1.2 XML output directly to an IPAWS staging endpoint for authorized incident commander sign-off.

#### H. Multi-Region Dynamic Tiling & Enterprise Infrastructure
* **Dynamic Nationwide Uber H3 Hex Tiling:** Expand beyond pre-configured pilot counties to allow any user to pan/zoom anywhere in the US, dynamically generating H3 resolution 8/9 hexagons on the fly.
* **Server-Side Edge Caching (Supabase / Redis):** Cache Mireye Earth API responses on edge servers so multi-user county board sessions load instantly without consuming API rate quotas.
* **Exportable PDF Briefs:** Add 1-click generation of PDF executive briefing decks complete with map snapshots, NFPA justification, and fiscal budgets for county commissioners.

---

### 7. Token Optimization Guide for AI Agents: Files to Avoid

When interacting with this codebase using LLM-powered coding assistants (Antigravity, Claude, Cursor, Copilot), the following files and directories should be **strictly avoided or ignored** to prevent token window exhaustion and unnecessary context costs:

| File / Directory Path | Size | Approx. Tokens | Reason to Avoid & Recommended Alternative |
| :--- | :---: | :---: | :--- |
| **`mireye-test/dist/`**<br>*(e.g., `dist/assets/*.js`, `dist/assets/*.css`)* | ~940 KB | **~235,000** | **CRITICAL AVOID:** Compiled, minified JavaScript/CSS build artifacts. Ingesting this burns hundreds of thousands of tokens and gives zero intelligible source context. |
| **`mireye-test/package-lock.json`** | 162 KB | **~40,500** | **STRICT AVOID:** Massive dependency lockfile. Agents should always read `package.json` (1.1 KB / ~250 tokens) instead. |
| **`mireye-test/src/components/USAMapPaths.ts`** | 33.5 KB | **~8,400** | **AVOID:** Contains pure SVG path coordinate strings (`d="M 124.5 ..."` for all 50 states). Zero business logic, zero state, zero API code. |
| **`research.txt`** | 34.8 KB | **~8,700** | **REDUNDANT:** Raw academic research paper text. All core formulations, Rothermel weights, and architecture concepts are fully summarized in `PROJECT_OVERVIEW.md`. |
| **`ccg-engine.jsx`** | 23.9 KB | **~6,000** | **OBSOLETE PROTOTYPE:** Initial prototype file in the parent workspace. The active application logic has been migrated into TypeScript under `mireye-test/src/`. Reading this leads agents to edit dead code. |
| **`Coverage_Combustibility_Gap_Technical_Approach (1).docx`** | 11.7 KB | N/A | **BINARY FORMAT:** Microsoft Word binary file. Cannot be read as text by LLMs. |
| **`web_site_pormpt.txt`** | 4.0 KB | **~1,000** | **REDUNDANT:** Initial prompt from early scaffolding. Superseded by project documentation. |
| **`mireye-test/vite.config.ts.timestamp-*.mjs`** | ~2.5 KB | **~600** | **TEMP CACHE:** Ephemeral build timestamp cache generated by Vite. |
| **`mireye-test/node_modules/`** | >200 MB | Millions | **SYSTEM DIRECTORY:** Standard dependency folder. Never index or read into agent context. |

#### Source Code Slicing Recommendations (High-Token Source Files)
For larger source components that agents *do* need to work on, instruct the agent to **use line slicing (`StartLine`/`EndLine`) or grep search** rather than loading the entire file at once:
* **`SimulationCanvas.tsx` (43 KB / 1,007 lines / ~10,800 tokens):** Three.js WebGL rendering loop, shaders, and ECEF camera math. Inspect specific helper functions or useEffect hooks rather than reading all 1,000 lines.
* **`GoogleMap.tsx` (27 KB / 708 lines / ~6,800 tokens):** Google Maps vector overlay management. Target specific state handlers or marker update blocks.

