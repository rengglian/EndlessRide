# Endless Ride 🏇

A high-performance, mobile-optimized 3D endless horse runner game built with **Three.js** and **TypeScript**. Featuring procedural banked track generation, custom GLSL terrain shader, multi-threaded Web Worker geometry streaming, analytical procedural gallop kinematics, physical motion controller hardware integration, and zero-allocation object pooling.

---

## ✨ Features

- **Procedural Banked Spline Track & Shared Math Engine**:
  - Smooth infinite countryside trail dynamically computed along an analytical 3D spline curve (`src/track/trackMath.ts`).
  - Speed-independent geometric banking: $bank = \text{clamp}(sign \cdot \frac{v_{\text{geom}}^2 \cdot \kappa}{g} \cdot 2.0, -0.22, 0.22)$, ensuring natural lean-in on curves for track geometry, obstacles, horse, and rider.
  - Arc-length speed correction: advances distance by $ds = \frac{speed \cdot dt}{\text{sampleArcLengthFactor}(s)}$ so cadence and speed match ground distance on curves.
  - Centralized game configuration and tuning rules in `src/config.ts`.
  - Standardized unified coordinate system: $+u$ is Screen-Right ($-X$), $-u$ is Screen-Left ($+X$), and $+Z$ is Forward.

- **Custom GLSL Countryside Paving & Meadow Shader**:
  - Metre-based UV coordinates ($u \in [-36, 36]\text{m}$, $s \in [0, 1200]\text{m}$) eliminating distortion and chunk boundary seams.
  - On-GPU procedural limestone cobblestone pavers ($0.40\text{m} \times 0.50\text{m}$) with staggered running bond mortar grooves.
  - Distinct 35cm sandstone curbing trim bordering the 7.6m path ($3.80\text{m} \le |u| \le 4.15\text{m}$).
  - Multi-layer procedural rolling meadow slopes with natural color noise and sunlit wildflower patches.
  - Mobile-safe Dave Hoskins `hash12` preventing mediump GPU precision bugs, plus `fwidth` distance attenuation reducing distant mortar/gravel shimmering.

- **Web Worker Multi-Threaded Track Streaming**:
  - Offloads 72m wide terrain cross-sections (flat path, curbs, and rolling meadow hills) to background Web Workers.
  - Zero-copy memory transfer using transferable `ArrayBuffer` geometry arrays (`Float32Array` positions, normals, UVs, and `Uint16Array` indices).
  - Synchronous fallback generation sharing identical math for headless environments or unsupported worker setups.
  - Generation-guarded chunk manager with race condition prevention and mesh leak recycling.

- **Instanced Roadside Scenery & Shared Geometries**:
  - 4 `THREE.InstancedMesh` instances per chunk (`trunk`, `folBottom`, `folTop`, `bush`), reducing roadside scenery draw calls from 144 to 24 world-wide (4 per chunk).
  - Pre-allocated shared obstacle geometries (`ObstaclePool.ts`) with static transform freezing (`matrixAutoUpdate = false`).
  - In-place swap-remove obstacle recycling without per-frame allocations.
  - Analytical swept longitudinal interval AABB collision in $(s, u)$ space preventing high-speed obstacle tunneling.

- **Deterministic Fixed-Timestep Physics & Lighting**:
  - 60 Hz physics accumulator (`FIXED_TIMESTEP = 1 / 60`) in `Engine.ts`, decoupling simulation from render frame rate.
  - Shadow-map texel snapping: sunlight position snaps to the 5cm texel grid to eliminate shadow cascade swimming.
  - Critically damped spring follow camera with subtle steering roll and speed-scaled field-of-view warp.

- **Articulated Horse & Rider Kinematics**:
  - **Dual Rendering Modes**: Automatically binds high-detail 3D models with embedded animation mixers, with seamless fallback to a 10-node procedural box skeleton.
  - **Gallop Cadence**: Dynamic speed-dependent gallop frequency (4.4 Hz at 65 km/h racing speed).
  - **Dynamic Rider Kinematics**: Real-time pelvis bobbing, speed-based forward wind tuck, and reactive upper-body banking into turns and dodges.
  - Cached skeletal bone lookups, eliminating per-frame string allocations and regex lookups.

- **Complete Game Flow, Collectibles & Persistence**:
  - **Collectibles & Dynamic Multiplier**: Pooled 3D **Apples** (`+0.2x` multiplier, `+25` bonus pts) and **Golden Horseshoes** (`+0.5x` multiplier, `+75` bonus pts) deterministically spawned in open obstacle-wave lanes and mid-segment streaks (`1.0x` up to `5.0x` max multiplier with 7s hold timer).
  - Interactive `START` screen overlay with tap/Space prompt.
  - Interactive `PAUSE` state (`Esc` / `P` / window blur / visibility change).
  - LocalStorage High Score persistence with "New Record!" banner on Game Over.

- **Physical Hardware Motion Controllers**:
  - Wireless ESP32-S3 `M5Stack AtomS3` rein motion controller streaming 50 Hz binary UDP packets with BMI270 complementary gyro+accel filtering, long-press `BtnA` zero calibration (saved to NVS), and 4x UDP restart packet redundancy.
  - Opt-in WebSocket gateway (`?sensor=<host-ip>`) with 350ms staleness safety guard.
  - Native Gamepad API support (Left Stick / D-Pad).

---

## 🚀 Quickstart

### Prerequisites

- **Node.js** (v18.0.0 or higher recommended)
- **npm** (v9.0.0 or higher)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd EndlessRide

# Install dependencies
npm install
```

### Development Server

Start Vite in local development mode (accessible on `http://localhost:3000`):

```bash
npm run dev
```

### Production Build

Type-check with TypeScript compiler (`tsc`) and compile production bundle with Vite:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

## 🎮 Controls

### 1. Desktop Keyboard

| Key | Action |
| :--- | :--- |
| `A` or `ArrowLeft` | Steer Left (-1.0) |
| `D` or `ArrowRight` | Steer Right (+1.0) |
| `Space` | Start game / Quick Restart after Game Over |
| `Esc` or `P` | Pause / Resume Game |
| `F3` / `H` / `` ` `` | Toggle Engine Telemetry Debug HUD |

### 2. Gamepad (USB / Bluetooth)

| Control | Action |
| :--- | :--- |
| **Left Analog Stick / D-Pad X** | Steer Left / Right |
| **Button A / Start** | Start / Restart Game |
| **Button B / Select** | Pause / Resume Game |

### 3. Mobile Touch

- **Tap / Hold Left Half of Screen**: Steer Left (-1.0)
- **Tap / Hold Right Half of Screen**: Steer Right (+1.0)
- **Tap Button**: Start game, Pause, or Restart after Game Over (UI button touches are automatically prioritized).

---

## 🕹️ Physical Hardware Motion Controllers

Endless Ride features native support for physical tilt motion controllers, transforming a physical prop (or reins) into an interactive arcade controller.

```
+--------------------------+          +-------------------------+          +-------------------------+
|   M5Stack AtomS3         |  WiFi    |   Raspberry Pi / Host   |  Local   |   Browser Client        |
|   (ESP32-S3 + BMI270)    |  UDP     |   scripts/              |  Web-    |   Endless Ride          |
|   Tilt Steering Controller| -------->|   sensor_bridge.py      | -------->|   WebGL Engine          |
|   (8-byte binary datagram)| :8080   |   (WebSocket Gateway)   | :8080    |   (?sensor=<host-ip>)   |
+--------------------------+          +-------------------------+          +-------------------------+
                                                   ^
+--------------------------+                       |
|   Raspberry Pi GPIO      |  I2C Bus 1            |
|   MPU-6050 Accelerometer | ----------------------+
|   (Wired Tilt Sensor)    |  (0x68)
+--------------------------+
```

### Option A: M5Stack AtomS3 Wireless Rein Controller

The `scripts/m5stack_atoms3_reins/` sketch turns an ultra-compact **M5Stack AtomS3** (ESP32-S3 with built-in Bosch BMI270 IMU and 128x128 color LCD) into wireless horse reins.

- **Complementary Gyro + Accel Filter**: Fuses BMI270 gyroscope and accelerometer data to eliminate linear acceleration spikes when shaking reins.
- **Zero Neutral Calibration**: Press and hold the front LCD screen button (`BtnA`) for > 1.5 seconds to zero the neutral roll angle. Stored permanently in ESP32 NVS (`Preferences`).
- **4x UDP Restart Redundancy**: Broadcasts restart button state across 4 consecutive packets with sequence numbering to guarantee restart detection over wireless UDP.
- **Automatic Wi-Fi Reconnect**: Automatically checks `WiFi.status()` in `loop()` and reconnects if the access point drops.
- **Captive Portal Wi-Fi Provisioning**: If unconfigured or Wi-Fi fails, creates an access point `AtomS3-Setup` at `192.168.4.1` with a mobile-friendly setup page.
- **Runtime Target IP Configuration**: Access `http://<atoms3-ip>/` in any browser on the local network to re-point the UDP destination IP without restarting.

### Option B: Raspberry Pi I2C Accelerometer Bridge

The Python bridge (`scripts/sensor_bridge.py`) reads tilt angles from an MPU-6050 6-axis IMU over the Raspberry Pi's I2C bus and broadcasts steering values over a local WebSocket server at `ws://<pi-ip>:8080`.

#### Running the Bridge

```bash
# Install Python dependencies
pip3 install websockets smbus2

# Run sensor bridge on Raspberry Pi
python3 scripts/sensor_bridge.py

# Optional: Run without physical sensor in simulation mode
python3 scripts/sensor_bridge.py --simulate

# Optional: Specify custom port (default: 8080)
python3 scripts/sensor_bridge.py --port 8080
```

#### Connecting in Browser

The browser WebSocket connection is **strictly opt-in**. Point your browser to the game with the `?sensor=<host>` URL query parameter:

```
http://localhost:3000/?sensor=192.168.1.50
```

A built-in **350ms staleness timeout** ensures steering automatically resets to 0.0 if packets stop arriving.

---

## 🎨 Custom 3D Model Parameters

You can load custom glTF / GLB 3D assets at runtime using URL query parameters:

- **Custom Horse Model**:
  ```
  http://localhost:3000/?horseModel=/assets/Ultimate_Animated_Animals/glTF/Horse.gltf
  ```
- **Custom Rider Model**:
  ```
  http://localhost:3000/?riderModel=/assets/Ultimate_Modular_Women/Individual%20Characters/glTF/Adventurer.gltf
  ```
- **Combined**:
  ```
  http://localhost:3000/?horseModel=/assets/horse.gltf&riderModel=/assets/Ultimate_Modular_Women/Individual%20Characters/glTF/Casual.gltf
  ```

If no model parameter is provided or an asset cannot be loaded, Endless Ride smoothly falls back to its procedural analytical meshes.

---

## 📁 Architecture & Directory Structure

```
EndlessRide/
├── index.html                   # HTML entry point, HUD overlays & gameover modal
├── package.json                 # Project dependencies & build scripts
├── tsconfig.json                # Strict TypeScript configuration
├── vite.config.ts               # Vite configuration with ES module worker support
├── improvements.md              # Project review, implemented fixes, and roadmap
├── public/
│   └── assets/                  # glTF/GLB 3D character and animal models
├── scripts/
│   ├── sensor_bridge.py         # Python WebSocket/UDP IMU sensor bridge
│   └── m5stack_atoms3_reins/    # Arduino firmware for wireless M5Stack AtomS3 controller
│       └── m5stack_atoms3_reins.ino
└── src/
    ├── config.ts                # Centralized game tuning & track dimensions
    ├── main.ts                  # Application bootstrap & lifecycle startup
    ├── camera/
    │   └── RunnerCamera.ts      # Spring-damped 3rd-person follow camera with FOV warp
    ├── collectibles/
    │   ├── CollectibleManager.ts # Collectible spawning, spin/bob animation, swept AABB pickup
    │   ├── CollectiblePool.ts   # Shared 3D Apple & Golden Horseshoe geometry/material pool
    │   └── types.ts             # Collectible entity interfaces
    ├── core/
    │   └── Engine.ts            # Fixed-timestep loop, game states (Start/Pause/GameOver), lighting
    ├── entities/
    │   ├── horse/
    │   │   ├── HorseMesh.ts     # Procedural horse geometry & analytical gallop rig
    │   │   └── HorseRunnerController.ts # Locomotion physics, banking, bone rotation manager
    │   └── rider/
    │       └── GirlRiderEntity.ts # Girl rider entity, saddle attachment, kinematic lean/bob
    ├── input/
    │   └── InputManager.ts      # Keyboard, multi-touch, Gamepad, and opt-in sensor handler
    ├── loaders/
    │   └── AssetLoader.ts       # glTF loader with animation mixer extraction
    ├── obstacles/
    │   ├── ObstacleManager.ts   # Chunk obstacle spawning, matrix freeze, swept AABB collision
    │   ├── ObstaclePool.ts      # Shared obstacle geometry & material pooling
    │   └── types.ts             # Obstacle entity extents & interfaces
    ├── track/
    │   ├── SplineTrack.ts       # Analytical track spline facade delegating to trackMath
    │   ├── TrackChunk.ts        # Individual track chunk mesh, instanced scenery, buffer updates
    │   ├── TrackChunkManager.ts # Linear streaming window, Web Worker orchestration, custom shader
    │   ├── trackMath.ts         # Pure closed-form spline math, cross-section slope normals, seeded PRNG
    │   ├── types.ts             # Track geometry & worker message types
    │   └── workers/
    │       └── track.worker.ts  # Web Worker multi-threaded chunk vertex generator
    └── ui/
        ├── DebugHUD.ts          # Telemetry overlay (FPS, draw calls, speed, bank, memory)
        └── HUD.ts               # Gameplay HUD (distance, speed, Start/Pause overlays, High Score)
```

---

## 🛠️ Performance & Tuning

- **Target Framerate**: 60 FPS locked on mobile devices and Raspberry Pi 4 via fixed-timestep simulation.
- **Draw Call Budget**: Capped under 40 draw calls per frame via 4 `THREE.InstancedMesh` scenery calls per chunk and shared obstacle geometries.
- **Pixel Ratio**: Clamped to a max of `1.5` to prevent GPU fill-rate exhaustion on high-DPI retina screens.
- **Zero In-Loop Allocations**: Reusable vectors, in-place swap-remove obstacle recycling, and cached skeletal bone references eliminate garbage collection pauses.
- **Shadow Map**: PCFSoft shadows with directional sunlight target snapped to the 5cm shadow-map texel grid for swimming-free local cascades.

---

## 📄 License

MIT License. See repository for full terms.
