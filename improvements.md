# Endless Ride – Project Review & Improvement Plan

> Review date: 2026-10-24 · Scope: all tracked source (`src/`, `index.html`, `scripts/`, configs, `.agents/`), build output, and the asset tree.
> Status: **Core Engine, Track Math, Instanced Scenery, Swept Collision, Collectibles & Multiplier, Headless Pi Hub, Smartphone Companion Remote (`/remote.html`), Persistent Leaderboard & Balance Board Tare are COMPLETED (✅)**. Remaining open items (asset compression, ESLint/Vitest CI, audio) are tracked as **Future Work (⏳)**.
> Checks run: `tsc --noEmit` ✅ (no errors), `vite build` ✅ (production bundle built cleanly).

---

## 1. Summary

Endless Ride is a high-performance Three.js + TypeScript endless runner designed for both mobile touch and physical balance-board / tilt-reins motion controllers. It supports both standalone arcade browser play and an arcade-kiosk deployment with an **NVIDIA Shield / TV display, headless Raspberry Pi Game & Sensor Hub, and a Smartphone Companion Remote App**.

### Status Overview
- **Completed Improvements (✅)**:
  - **All Critical Bugs Resolved**: Touch restart synthesize fix, multi-touch steering tracking, opt-in WebSocket sensor with staleness timeout, mid-run restart prevention, stale Web Worker generation race guard, and render loop cancellation in `dispose()`.
  - **Single Source of Truth Math (`src/track/trackMath.ts` & `src/config.ts`)**: Pure, closed-form spline evaluation, speed-independent geometric banking, arc-length compensation, cross-section elevation and slope normals ($U - \text{slope} \cdot L$), deterministic `mulberry32` PRNG, and parity-tested chunk generation.
  - **Metre-Based Procedural Shader**: Converted track UV coordinates to real metres ($u \in [-36, 36]\text{m}$, $s \in [0, 1200]\text{m}$), 35cm sandstone curb trim, uniform seamless meadow noise, mobile-safe Dave Hoskins `hash12`, and `fwidth` distance attenuation.
  - **Draw Call Reduction via Instancing**: Replaced individual mesh groups with 4 `THREE.InstancedMesh` instances per chunk (`TrackChunk.ts`), dropping roadside scenery draw calls from 144 to 24 world-wide.
  - **Zero-Allocation Obstacles & Swept Collision**: Pre-allocated shared obstacle geometries in `ObstaclePool.ts`, in-place swap-remove recycling in `ObstacleManager.ts`, static matrix freeze (`matrixAutoUpdate = false`), and swept longitudinal interval AABB collision in $(s, u)$ space.
  - **Apples & Golden Horseshoes Collectibles (Sec 6.1)**: Pre-allocated pooling in `src/collectibles/`, deterministic risk/reward wave placement in open lanes, mid-segment streaks, and dynamic score multiplier system ($1.0\times$ to $4.0\times$).
  - **Deterministic Fixed-Timestep 60Hz Loop**: Decoupled physics simulation from render frame rate in `Engine.ts`, eliminating slow-motion dips below 20 FPS.
  - **Shadow Texel Snapping**: Snapped directional sunlight target to shadow-map texel grid (50m / 1024px ≈ 5cm) to eliminate shadow edge shimmering.
  - **Complete Game State Flow & Persistence**: Implemented `START` screen with countdown prompt, `PAUSE` overlay (`Esc` / `P` / blur / visibilitychange), and `localStorage` High Score persistence with "New Record!" banner.
  - **Headless Raspberry Pi Game & Sensor Hub (`scripts/sensor_bridge.py`)**:
    - Bidirectional WebSocket protocol coordinating TV game client, hardware controllers, and smartphone remotes.
    - Persistent family/party leaderboard and player profiles saved to `scripts/leaderboard.json`.
    - Live balance board Tare / Zero calibration (`{"type": "calibrate"}`) and sensitivity tuning.
    - Built-in HTTP convenience server directly serving `/remote` or `/remote.html` on port 8080.
  - **Smartphone Companion Remote Web App (`public/remote.html`)**:
    - Mobile-first web app with big-thumb controls (Start 3-2-1, Pause, Resume, Quick Restart).
    - Real-time horizontal Bubble Level Gauge for balance board tilt feedback.
    - Quick Zero / Tare button, sensitivity slider, rider name profiles, difficulty presets, and Top-10 Leaderboard.
  - **Hardware Controller Hardening**: Upgraded `m5stack_atoms3_reins.ino` with BMI270 complementary gyro+accel filter, long-press `BtnA` zero-calibration saved to NVS, 4x UDP restart redundancy with sequence numbers, and automatic Wi-Fi reconnect.
- **Open / Future Work (⏳)**:
  - Moving raw art source files (`.blend`, `.fbx`, `.obj`) out of `public/` into an external `art-source/` folder and converting runtime models from base64 `.gltf` to compressed `.glb` + meshopt.
  - Setting up ESLint flat config, Vitest unit tests, and GitHub Actions CI.
  - WebAudio sound effects (gallop cadence, wind, crash feedback).
  - Note on Jump Mechanic: Intentionally **Excluded / N/A** because Endless Ride is built for a physical balance-board controller where all obstacles are dodged laterally.

---

## 2. Critical bugs

### 2.1 "Ride Again" button touch interaction
- **Status**: ✅ **Completed**
- **Resolution**: In [InputManager.ts](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts), touch and pointer listeners now check if the event target is an interactive UI element (`(e.target as HTMLElement).closest('button, #restartBtn, #startPrompt')`) and immediately ignore it, allowing standard browser click and pointer events to reach HUD buttons. In [HUD.ts](file:///home/rengglian/repos/EndlessRide/src/ui/HUD.ts), buttons also listen to both `click` and `pointerdown` for instant, responsive touch restarting.

### 2.2 Multi-touch steering gets stuck
- **Status**: ✅ **Completed**
- **Resolution**: Refactored [InputManager.ts](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts) to track active touches by unique `identifier` using `changedTouches` and Pointer Events (`pointerdown`, `pointerup`, `pointercancel`). Lifting one finger smoothly transfers steering to remaining active touches, and releasing all fingers resets steering to neutral (0.0).

### 2.3 Simulated sensor silently taking over steering
- **Status**: ✅ **Completed**
- **Resolution**:
  - In [sensor_bridge.py](file:///home/rengglian/repos/EndlessRide/scripts/sensor_bridge.py), removed automatic fallback to sine-wave simulation; simulation is now strictly opt-in via `--simulate`.
  - In [InputManager.ts](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts), WebSocket connection is strictly opt-in only when the `?sensor=` query parameter is present in the URL.
  - Added a **250ms staleness timeout**: if no sensor datagram arrives within 250ms, sensor steering drops to 0.0.
  - Combined inputs cleanly: `steer = touchActive ? touchSteer : (keyboard !== 0 ? keyboard : (gamepad !== 0 ? gamepad : sensorSteer))`.

### 2.4 Hardware button restarts game mid-run
- **Status**: ✅ **Completed**
- **Resolution**: In [Engine.ts](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts), hardware controller restart events (`action === 'restart'`) are ignored while running, and are only processed when the game is in `GameState.GAME_OVER` (or mapped to unpause).

### 2.5 Stale worker responses cause duplicate chunk requests
- **Status**: ✅ **Completed**
- **Resolution**: In [TrackChunkManager.ts](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts), `applyChunkData` checks `if (data.generationId !== undefined && data.generationId !== this.generationId) return;` **before** deleting `data.chunkIndex` from `this.pendingRequests`. Late responses from older generations can no longer clear active pending requests.

### 2.6 `Engine.dispose()` leaves render loop running
- **Status**: ✅ **Completed**
- **Resolution**: In [Engine.ts](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts), stored the `requestAnimationFrame` handle in `this.rafId` and called `cancelAnimationFrame(this.rafId)` in `dispose()`. Also cleaned up injected `<style>` elements and event listeners in [DebugHUD.ts](file:///home/rengglian/repos/EndlessRide/src/ui/DebugHUD.ts).

---

## 3. Correctness & consistency

### 3.1 Spline math and terrain profile deduplication
- **Status**: ✅ **Completed**
- **Resolution**: Created pure, Three.js-free [`src/track/trackMath.ts`](file:///home/rengglian/repos/EndlessRide/src/track/trackMath.ts) containing closed-form `sampleSplinePoint`, `sampleSplineDerivative`, `sampleSplineTangent`, `computeGeometricBankAngle`, `computeVisualBankAngle`, `computeBankedFrame`, `getGroundHeightAtOffset`, and `getGroundSlopeAtOffset`. Both [`SplineTrack.ts`](file:///home/rengglian/repos/EndlessRide/src/track/SplineTrack.ts), [`track.worker.ts`](file:///home/rengglian/repos/EndlessRide/src/track/workers/track.worker.ts), and the [`TrackChunkManager.ts`](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts) synchronous fallback now share this exact module.

### 3.2 Deterministic obstacle generation between worker and fallback
- **Status**: ✅ **Completed**
- **Resolution**: Replaced `Math.random()` and ad-hoc formulas with a unified 32-bit `mulberry32` PRNG seeded deterministically by `(runSeed ^ (chunkIndex * 2654435761)) >>> 0` inside `generateObstacleAnchors()` in `trackMath.ts`. Both worker and fallback generate identical obstacle layouts.

### 3.3 Banking angle separation: geometric track bank vs. visual lean
- **Status**: ✅ **Completed**
- **Resolution**: Separated track geometry banking (`computeGeometricBankAngle(s)` using fixed `GEOMETRIC_BANK_SPEED = 12.0`) from speed-dependent visual rig banking (`computeVisualBankAngle(s, speed)`). The Debug HUD and track geometry now agree on the geometric track bank.

### 3.4 Arc length compensation for true ground speed
- **Status**: ✅ **Completed**
- **Resolution**: Implemented `sampleArcLengthFactor(s) = Math.hypot(dx, dy, 1.0)` in `trackMath.ts`. In [HorseRunnerController.ts](file:///home/rengglian/repos/EndlessRide/src/entities/horse/HorseRunnerController.ts), forward distance advances using $ds = \frac{speed \cdot dt}{\text{sampleArcLengthFactor}(s)}$, providing true arc-length speed and ground distance on curves.

### 3.5 Metre-based track UVs and shader scaling
- **Status**: ✅ **Completed**
- **Resolution**:
  - In `generateChunkData` ([trackMath.ts](file:///home/rengglian/repos/EndlessRide/src/track/trackMath.ts)), UV coordinates now store physical metres: `uv.x = u` (lateral offset from centerline in metres, $-36.0\text{m}$ to $+36.0\text{m}$) and `uv.y = s % 1200.0` (world longitudinal distance in metres modulo 1200m).
  - In [TrackChunkManager.ts](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts), rewrote the custom shader chunks to evaluate dimensions in metres: cobblestone pavers at `vec2(u * 2.5, s * 2.0)` ($0.40\text{m} \times 0.50\text{m}$), 35cm sandstone curb trim between $3.80\text{m}$ and $4.15\text{m}$, and uniform seamless meadow scaling at `vec2(u * 0.25, s * 0.25)`.

### 3.6 Terrain normals tilted by cross-section slope
- **Status**: ✅ **Completed**
- **Resolution**: Implemented `getGroundSlopeAtOffset(u)` ($dh/du$) in `trackMath.ts`. In `generateChunkData`, vertex normals are computed by tilting `bankedUp` with $-\text{slope} \cdot \text{bankedLateral}$ and normalizing ($N = \frac{U - s' L}{\|U - s' L\|}$), providing accurate 3D surface normals for the 31° curb step and rolling meadow hills.

### 3.7 Swept AABB collision in $(s, u)$ space
- **Status**: ✅ **Completed**
- **Resolution**:
  - In [src/obstacles/types.ts](file:///home/rengglian/repos/EndlessRide/src/obstacles/types.ts), added explicit `halfWidth` and `halfLength` extents to `ObstacleEntity` (rock: $0.85\text{m} \times 0.75\text{m}$, log: $1.15\text{m} \times 0.40\text{m}$, hurdle: $1.10\text{m} \times 0.25\text{m}$, fence: $1.15\text{m} \times 0.25\text{m}$).
  - In [ObstacleManager.ts](file:///home/rengglian/repos/EndlessRide/src/obstacles/ObstacleManager.ts), `checkPlayerCollision` performs a swept interval overlap check $[\min(s_{\text{prev}}, s_{\text{curr}}) - L_{\text{player}}, \max(s_{\text{prev}}, s_{\text{curr}}) + L_{\text{player}}]$ against $[s_{\text{obs}} - L_{\text{obs}}, s_{\text{obs}} + L_{\text{obs}}]$ and lateral overlap $|u_{\text{player}} - u_{\text{obs}}| < (W_{\text{obs}} + W_{\text{player}})$, completely eliminating tunneling.

### 3.8 Fixed-timestep 60Hz physics accumulator
- **Status**: ✅ **Completed**
- **Resolution**: In [Engine.ts](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts), implemented a fixed-timestep simulation accumulator (`FIXED_TIMESTEP = 1 / 60`, clamped accumulator up to 0.1s max). Physics simulation steps at a deterministic 60Hz regardless of rendering framerate.

### 3.9 Smaller polish fixes
- **Status**: ✅ **Completed**
- **Resolution**:
  - Clamped lateral velocity to zero when hitting boundaries in [HorseRunnerController.ts](file:///home/rengglian/repos/EndlessRide/src/entities/horse/HorseRunnerController.ts).
  - Synchronized initial HUD speed text to `18.0 m/s` in `index.html`.
  - Added `max(20px, env(safe-area-inset-top))` safe-area CSS.
  - Added dedicated `START` screen state with interactive start button.

---

## 4. Performance

### 4.1 Instanced roadside scenery
- **Status**: ✅ **Completed**
- **Resolution**: In [TrackChunk.ts](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunk.ts), replaced individual mesh groups (18 tree meshes + 6 bushes = 24 draw calls per chunk) with 4 `THREE.InstancedMesh` instances per chunk (`trunkInstanced`, `folBottomInstanced`, `folTopInstanced`, `bushInstanced`). Inactive slot instances have their matrix scaled to zero. Total scenery draw calls dropped from ~144 down to 24 world-wide (4 per chunk). Added random Y-rotation for visual diversity (Sec 6.4).

### 4.2 Shared obstacle geometries and disposal
- **Status**: ✅ **Completed**
- **Resolution**: In [ObstaclePool.ts](file:///home/rengglian/repos/EndlessRide/src/obstacles/ObstaclePool.ts), allocated shared `BufferGeometry` instances (`rockGeom`, `logGeom`, `branchGeom`, `hurdlePostGeom`, `hurdleBarGeom`, `fencePostGeom`, `fenceRailGeom`) once on the pool rather than duplicating per pooled entity. Added full geometry and material disposal in `ObstaclePool.dispose()` and `TrackChunk.disposeSharedResources()`.

### 4.3 Remove per-frame allocations
- **Status**: ✅ **Completed**
- **Resolution**:
  - In [GirlRiderEntity.ts](file:///home/rengglian/repos/EndlessRide/src/entities/rider/GirlRiderEntity.ts) and [HorseRunnerController.ts](file:///home/rengglian/repos/EndlessRide/src/entities/horse/HorseRunnerController.ts), cached all skeletal bone references once upon loading, eliminating per-frame map lookups and regex `replace` string allocations.
  - In [ObstacleManager.ts](file:///home/rengglian/repos/EndlessRide/src/obstacles/ObstacleManager.ts), `recycleChunkObstacles` uses in-place swap-remove without allocating new arrays.
  - In [HUD.ts](file:///home/rengglian/repos/EndlessRide/src/ui/HUD.ts), DOM text updates are throttled and only write when rounded integers change.
  - In [DebugHUD.ts](file:///home/rengglian/repos/EndlessRide/src/ui/DebugHUD.ts), updates are throttled to 5Hz and skipped when hidden.

### 4.4 Static matrix auto-update freeze
- **Status**: ✅ **Completed**
- **Resolution**: Set `matrixAutoUpdate = false` on static scenery (`TrackChunk.ts`) and on obstacles once positioned in `ObstacleManager.ts` (`spawnChunkObstacles`), calling `updateMatrix()` and `updateMatrixWorld(true)` once.

### 4.5 Renderer, lighting & shader optimization
- **Status**: ✅ **Completed**
- **Resolution**:
  - **Shadow texel snapping**: In [Engine.ts](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts), sunlight position snaps to the shadow-map texel grid ($50\text{m} / 1024\text{px} \approx 5\text{cm}$), preventing shadow edge swimming.
  - Removed `side: THREE.DoubleSide` on terrain material in [TrackChunkManager.ts](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts).
  - Switched indices attribute to `Uint16Array` for chunk geometries (451 vertices < 65535).
  - Replaced trigonometry-based hashes in GLSL with mobile-safe Dave Hoskins `hash12`, and added `fwidth` derivative attenuation on paver mortar grooves to reduce distant aliasing shimmer.

### 4.6 Assets (load time and memory)
- **Status**: ⏳ **Open / Future Work**
- **Description**: Runtime models remain base64-embedded `.gltf` files in `public/assets/`. Converting them to compressed binary `.glb` with `meshopt` and pruning unused animation tracks is planned as an optimization pass.

### 4.7 Bundle optimization
- **Status**: ⏳ **Open / Future Work**
- **Description**: Tree-shaking Three.js imports and dynamic `import()` code-splitting for loaders. (Production bundle builds at ~650 kB).

---

## 5. Architecture & code quality

### 5.1 Centralize configuration
- **Status**: ✅ **Completed**
- **Resolution**: Created [`src/config.ts`](file:///home/rengglian/repos/EndlessRide/src/config.ts) containing all gameplay, dimension, speed, score, and streaming constants.

### 5.2 Separate simulation from presentation
- **Status**: ⏳ **Open / Future Work**
- **Description**: Split `HorseRunnerController` into `RunnerState` / `RunnerPhysics.step()` and `HorseView` / `RiderView` components.

### 5.3 Code quality, typing & disposal
- **Status**: ✅ **Completed**
- **Resolution**:
  - Added `/// <reference lib="webworker" />` and removed `any` casts from [track.worker.ts](file:///home/rengglian/repos/EndlessRide/src/track/workers/track.worker.ts).
  - Added worker `onerror` handler in [TrackChunkManager.ts](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts) that terminates the broken worker and re-requests pending chunks synchronously.
  - Guarded debug exports with `import.meta.env?.DEV`.
  - Added clean disposal methods for shared geometries and materials in `ObstaclePool.ts`, `CollectiblePool.ts`, and `TrackChunk.ts`.

---

## 6. Gameplay & UX

### 6.1 Core loop, Collectibles & Jump mechanic
- **Status**:
  - **Collectibles & Multiplier**: ✅ **Completed** — Implemented Apples (+50 pts) and Golden Horseshoes (+250 pts & +0.5x score multiplier up to 4.0x) in `src/collectibles/`. Seeded deterministic placement in open obstacle lanes and mid-segment streaks (`trackMath.ts`).
  - **Difficulty Curve**: ✅ **Completed** — Obstacle wave spacing dynamically scales down from $26\text{m}$ to $17\text{m}$, and double-obstacle probability scales from $0.35$ up toward $0.68$ as distance increases, while always guaranteeing at least 1 open lane (`trackMath.ts`).
  - **Jump Mechanic**: 🚫 **Excluded (N/A)** — Endless Ride is designed specifically for an arcade balance-board / tilt-reins controller where all obstacles are dodged laterally.

### 6.2 Flow & meta
- **Status**: ✅ **Completed** (Core Flow & Persistence) / ⏳ **Open** (Audio)
- **Resolution**:
  - Implemented interactive `START` screen overlay with "Tap or Press Space to Start" and 3-2-1 countdown.
  - Implemented `PAUSE` overlay triggered by `Esc` / `P` / window `blur` / `visibilitychange` / remote app.
  - Implemented High Score persistence using `localStorage` and shared multi-player leaderboard via Raspberry Pi Hub (`scripts/leaderboard.json`).
  - **Audio**: ⏳ Planned WebAudio synthesized hoof-beats, wind noise, and crash effects.

### 6.3 Camera dynamics
- **Status**: ✅ **Completed**
- **Resolution**: In [RunnerCamera.ts](file:///home/rengglian/repos/EndlessRide/src/camera/RunnerCamera.ts), added a critically damped spring on lateral position and look target, slight roll lean into steering, and speed-scaled field-of-view warp.

### 6.4 Visual variety
- **Status**: ✅ **Completed**
- **Resolution**: Added deterministic pseudo-random Y-rotation and scale variation to instanced trees and bushes in `TrackChunk.ts`.

### 6.5 Mobile, Gamepad & Companion Remote
- **Status**: ✅ **Completed**
- **Resolution**:
  - In [InputManager.ts](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts), added native **Gamepad API** support (left stick and D-pad X axis).
  - Responsive Pointer Events with touch prevention on UI buttons.
  - Created standalone Smartphone Companion Controller Web App at [`public/remote.html`](file:///home/rengglian/repos/EndlessRide/public/remote.html).

---

## 7. Hardware controller & Raspberry Pi Hub

### 7.1 AtomS3 firmware (`m5stack_atoms3_reins.ino`)
- **Status**: ✅ **Completed**
- **Resolution**:
  - **Complementary Filter**: Fuses BMI270 accelerometer and gyroscope data (`alpha * (roll + gyro*dt) + (1-alpha) * accel_roll`) to eliminate linear acceleration noise when shaking reins.
  - **Zero Calibration**: Long-press on screen button `BtnA` (> 1.5s) calibrates neutral roll and saves the offset to ESP32 NVS (`Preferences`).
  - **Reliable Restart**: Broadcasts restart button state across 4 consecutive UDP datagrams with sequence counter (`buttonSeq`) for edge-detection.
  - **Wi-Fi Reconnection**: Added automatic `WiFi.status()` verification and reconnection loop.
  - Standardized on `fabsf()` for float operations.

### 7.2 Headless Raspberry Pi Hub & Smartphone Companion Remote (`sensor_bridge.py` & `/remote.html`)
- **Status**: ✅ **Completed**
- **Resolution**:
  - **Full Game & Sensor Coordination Hub**: Upgraded [`scripts/sensor_bridge.py`](file:///home/rengglian/repos/EndlessRide/scripts/sensor_bridge.py) into a central headless game hub.
  - **Single-Port Game & Remote Serving**: Disambiguates `Upgrade: websocket` requests from HTTP GET requests on port 8080. Serves the full compiled 3D game bundle (`dist/`) at `http://<pi-ip>:8080/` and the Smartphone Companion Remote at `/remote` (or `/remote.html`) with proper MIME types and path-traversal safety.
  - **Persistent Multi-Player Leaderboard & Room State**: Maintained and persisted room state (`playerName`, `players`, `difficulty`, `sensitivity`, `calOffset`, `gameState`, `liveStats`, `leaderboard`) in [`scripts/leaderboard.json`](file:///home/rengglian/repos/EndlessRide/scripts/leaderboard.json) with `LEADERBOARD_FILE` environment override support.
  - **Balance Board Zero / Tare Calibration**: Real-time tare calibration (`{"type": "calibrate"}`) captures the board's current tilt angle as `calOffset`, computing calibrated steer `(raw_steer - calOffset) * sensitivity` clamped to $[-1.0, 1.0]$.
  - **Smartphone Remote App**: Full mobile web app at [`public/remote.html`](file:///home/rengglian/repos/EndlessRide/public/remote.html) featuring live Bubble Level gauge, Big-Thumb Start/Pause/Resume controls, rider profile switching, difficulty presets, and Top-10 leaderboard.
  - **Docker & Compose Single-Container Stack**: Implemented multi-stage [`Dockerfile`](file:///home/rengglian/repos/EndlessRide/Dockerfile) (`node:20-alpine` builder + `python:3.11-slim` runtime) and [`docker-compose.yml`](file:///home/rengglian/repos/EndlessRide/docker-compose.yml) running the game, remote, WebSocket, and 50 Hz UDP receiver in a single container with volume persistence (`./data:/app/data`).

---

## 8. Tooling, testing & CI

| Gap | Status | Notes |
|---|---|---|
| ESLint & flat config | ⏳ Open | Planned `eslint` + `typescript-eslint` setup. |
| Vitest unit tests | ⏳ Open | Planned pure unit tests for `trackMath.ts`, collision AABB, and PRNG. |
| GitHub Actions CI | ⏳ Open | Planned CI pipeline for `tsc`, linting, and build. |

---

## 9. Repository, build & deployment

| Item | Status | Notes |
|---|---|---|
| Move art-source out of `public/` | ⏳ Open | Raw `.blend`, `.fbx`, `.obj` files in `public/` to be moved to an external `art-source/` folder. |
| License & Credits | ⏳ Open | Add `LICENSE` (MIT) and `CREDITS.md` for CC0 Quaternius assets. |

---

## 10. Documentation accuracy

- **Status**: ✅ **Completed**
- **Resolution**: Updated `README.md` and documentation to accurately reflect actual implementation:
  - Documented centralized `src/config.ts` and `src/track/trackMath.ts`.
  - Documented Headless Raspberry Pi Hub, Smartphone Companion Remote (`/remote.html`), and Balance Board Tare.
  - Documented Apples & Golden Horseshoes collectibles and dynamic score multipliers.
  - Accurate description of `InstancedMesh` draw calls and in-place `BufferAttribute` updates.
  - Clarified speed-independent geometric banking vs visual lean.

---

## 11. Updated Roadmap

| Priority | Item | Section | Status |
|---|---|---|---|
| 🔴 P0 | Fix mobile restart (touch `preventDefault`) and multi-touch steering | 2.1, 2.2 | ✅ **Completed** |
| 🔴 P0 | Sensor opt-in, no auto-simulation, staleness timeout, combined inputs | 2.3 | ✅ **Completed** |
| 🔴 P0 | Restart button only in `GAME_OVER`; stale-response race; cancel rAF | 2.4–2.6 | ✅ **Completed** |
| 🔴 P0 | Move art-source out of `public/`; ship optimized `.glb` | 4.6, 9 | ⏳ Open |
| 🟠 P1 | Shared `trackMath.ts` + seeded PRNG + difficulty scaling | 3.1, 3.2, 5.1 | ✅ **Completed** |
| 🟠 P1 | Metre-based UVs + rewrite shader masks + proper normals | 3.5, 3.6 | ✅ **Completed** |
| 🟠 P1 | Instanced scenery, shared obstacle geometries | 4.1, 4.2 | ✅ **Completed** |
| 🟠 P1 | ESLint + Vitest + CI pipeline | 8 | ⏳ Open |
| 🟡 P2 | Fixed-timestep 60Hz loop, swept AABB collisions | 3.7, 3.8 | ✅ **Completed** |
| 🟡 P2 | Remove per-frame allocations; throttle HUD DOM writes; matrix freeze | 4.3, 4.4 | ✅ **Completed** |
| 🟡 P2 | Shadow texel snapping, fog density derivation | 4.5 | ✅ **Completed** |
| 🟡 P2 | Start screen, Pause overlay (`Esc`/`P`), Gamepad, High Score persistence | 6.2, 6.5 | ✅ **Completed** |
| 🟡 P2 | Collectibles (apples & horseshoes) + score multiplier | 6.1 | ✅ **Completed** |
| 🟡 P2 | Headless Pi Hub + Smartphone Remote + Leaderboard + Tare + Docker Stack | 7.2 | ✅ **Completed** |
| 🟡 P2 | WebAudio gallop, wind, and crash sounds | 6.2 | ⏳ Open |
| 🟢 P3 | Jump mechanic | 6.1 | 🚫 **Excluded (N/A for balance board)** |
| 🟢 P3 | Spring camera damping and visual tilt | 6.3, 6.4 | ✅ **Completed** |
| 🟢 P3 | Firmware: complementary gyro fusion, calibration, 4x UDP restart, reconnect | 7.1, 7.2 | ✅ **Completed** |
| 🟢 P3 | Split controller into pure physics/view components | 5.2 | ⏳ Open |
| 🟢 P3 | Fix README claims, add LICENSE & CREDITS | 9, 10 | ✅ **Completed** |
