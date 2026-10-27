# Game Architecture & Engineering Rules

## 1. Core Engine Stack & Technology Baseline

All 3D gameplay code in this repository MUST adhere to the following architecture stack:

*   **Genre & Mechanics**: 3D Endless Runner featuring a girl riding a galloping horse along a procedural winding track with obstacles, controlled via Left/Right lateral steering (keyboard, touch, Raspberry Pi I2C accelerometer, or wireless ESP32 / M5Stack AtomS3 motion controller).
*   **Primary 3D Engine**: Three.js (r160+) with TypeScript (strict mode enabled).
*   **Locomotion Physics & Collision**: Analytical spline projection, zero-allocation bounding collision checks, and continuous arc-length progress tracking.
*   **Procedural Math & Splines**: Continuous 3D parametric curve math and noise generation executed in Web Workers.
*   **Threading & Workers**: Web Workers managed via raw `postMessage` with `Transferable` buffers (`ArrayBuffer`) with zero main-thread stall.
*   **Hardware Compatibility**: Runs seamlessly on desktop, mobile, and low-power embedded single-board computers (Raspberry Pi 4 @ 45–60 FPS).
*   **Asset Format**: glTF 2.0 (`.gltf`/`.glb`) with normalized scaling ($0.38$) and procedural bone retargeting for modular characters.

---

## 2. Modular Architecture & Component Boundaries

The codebase follows a decoupled, service-oriented modular architecture tailored for an endless runner:

```
src/
├── core/                  # Engine loop, canvas lifecycle, WebGL renderer, time, game state
│   ├── Engine.ts          # Orchestrator: tick loop, lighting tracking, render pass, telemetry
├── track/                 # Procedural curved track and linear chunk streaming
│   ├── SplineTrack.ts     # Continuous 3D curve generator with lateral banking and curvature
│   ├── TrackChunkManager.ts # Linear forward chunk streaming, obstacle bridging, multi-texture material
│   ├── TrackChunk.ts      # Curved path mesh, curbs, rolling meadow skirts, grounded scenery props
│   └── workers/           # Track geometry generation worker scripts
│       └── track.worker.ts # Spline sampling, 72m wide vertex extrusion, analytical normal computation
├── obstacles/             # Obstacle spawning, pooling, and placement along track
│   ├── ObstacleManager.ts # Difficulty-driven spawner placing hazards along spline lanes
│   ├── ObstaclePool.ts    # Pre-allocated object pool for rocks, logs, hurdles, and fences
│   └── types.ts           # Obstacle entity definitions and collision parameters
├── entities/              # Game entities and kinematic controllers
│   ├── horse/
│   │   ├── HorseMesh.ts             # Low-poly horse fallback geometry
│   │   └── HorseRunnerController.ts # Forward track gallop ($18-30 m/s), shoulder reach, banking roll
│   └── rider/
│       └── GirlRiderEntity.ts       # Modular adventurer character seated with equestrian bone posture
├── camera/                # Dynamic runner follow camera
│   └── RunnerCamera.ts    # Level-horizon follow camera tracking spline tangent with dynamic FOV speed warp
├── input/                 # Left/Right hardware input abstraction layer
│   └── InputManager.ts    # Swapped touch zones, keyboard fallback, and WebSocket IMU sensor client
├── loaders/               # Asset management
│   └── AssetLoader.ts     # Asynchronous glTF/glb loader with animation mixer management
└── ui/                    # HUD and Game Over overlays
    ├── HUD.ts             # Distance traveled, current speed, score display, game over modal
    └── DebugHUD.ts        # Live FPS, draw calls, triangles, steering meter, stride cadence, chunk/obstacle counts
```

---

## 3. Gameplay Mechanics & Game Loop Specifications

1.  **High-Speed Forward Progression**:
    *   Base Gallop Speed ($v_0$): **$18.0\text{ m/s}$ ($65\text{ km/h}$)**.
    *   Speed Scaling: Accelerates smoothly up to **$30.0\text{ m/s}$ ($108\text{ km/h}$)** over distance.
    *   Gallop Stride Cadence: Base frequency $4.4\text{ Hz}$, scaled dynamically with velocity.
2.  **Left / Right Player Control & Sensor Input**:
    *   User input is normalized lateral steering: $u_{\text{in}} \in [-1.0, 1.0]$.
    *   Input Sources:
        1. **Keyboard**: `KeyA` / `ArrowLeft` (Steer Right / Left as mapped) & `KeyD` / `ArrowRight`.
        2. **Touch**: Left/Right screen zones with immediate touch response.
        3. **Hardware Accelerometer / IMU**: WebSocket stream on `ws://localhost:8080` (or `?sensor=<ip>`) from Raspberry Pi I2C (MPU-6050) or wireless ESP32 / M5Stack AtomS3 (BMI270 binary UDP stream relayed via bridge).
3.  **Procedural Countryside Landscape**:
    *   Broad $72\text{m}$ rolling meadow terrain mesh filling the horizon.
    *   Light limestone cobblestone paving & fine gravel procedural shader with darker mortar grooves and curbs.
    *   Ground-elevation sampled roadside scenery (trees and bushes) planted firmly into the hillsides.
4.  **Obstacle Placement & Collision Resolution**:
    *   Obstacles (boulders, fallen logs, striped equestrian hurdles, wooden fences) are generated procedurally along discrete Left, Center, and Right lanes.
    *   Every obstacle wave guarantees at least one clear passage lane.
    *   Zero-allocation collision checks trigger crash animations and transition to `GameOver`.

---

## 4. Hardware Motion Controller Specifications

*   **Raspberry Pi 4**: Native hardware acceleration via Chromium Mesa V3D driver.
*   **I2C Accelerometer Bridge** (`scripts/sensor_bridge.py`): Samples MPU-6050 / ADXL345 at $50\text{ Hz}$ on GPIO pins 3 (SDA) and 5 (SCL), computing low-pass filtered roll angles.
*   **M5Stack AtomS3 (C126)** ([`scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino`](file:///home/rengglian/repos/EndlessRide/scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino)): Wireless ESP32-S3 with built-in Bosch BMI270 6-axis IMU, captive portal setup & runtime target IP web config, 100 Hz 32-byte raw IMU binary UDP streaming (`0x4553`), live steering meter on $128 \times 128$ color LCD, and push-button restart.
