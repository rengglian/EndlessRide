# Endless Ride 🏇

A high-performance, mobile-optimized 3D endless horse runner game built with **Three.js** and **TypeScript**. Featuring procedural banked track generation, custom GLSL terrain shader, multi-threaded Web Worker geometry streaming, analytical procedural gallop kinematics, physical motion controller hardware integration, and zero-allocation object pooling.

---

## ✨ Features

- **Procedural Banked Spline Track**:
  - Smooth infinite countryside trail dynamically computed along an analytical 3D spline curve.
  - Authentic centrifugal banking roll elevation: $bank = \text{clamp}(sign \cdot \frac{v^2 \cdot \kappa}{g} \cdot 2.0, -0.22, 0.22)$, ensuring natural lean-in on curves for both track geometry, obstacles, horse, and rider.
  - Standardized unified coordinate system: $+u$ is Screen-Right ($-X$), $-u$ is Screen-Left ($+X$), and $+Z$ is Forward.

- **Custom GLSL Countryside Paving & Meadow Shader**:
  - On-GPU procedural limestone cobblestone pavers with staggered running bond mortar grooves.
  - High-frequency procedural gravel speckle highlights and sandstone curbing trim.
  - Multi-layer procedural meadow slopes with natural color noise and sunlit wildflower patches.
  - Zero texture file dependencies: 100% computed inside custom Three.js shader chunks.

- **Web Worker Multi-Threaded Track Streaming**:
  - Offloads 72m wide terrain cross-sections (flat path, curbs, and rolling meadow hills) to background Web Workers.
  - Zero-copy memory transfer using transferable `ArrayBuffer` geometry arrays (`Float32Array` positions, normals, UVs, and `Uint32Array` indices).
  - Synchronous fallback generation for headless environments or unsupported worker setups.
  - Generation-guarded chunk manager with race condition prevention and mesh leak recycling.

- **Articulated Horse & Rider Kinematics**:
  - **Dual Rendering Modes**: Automatically binds high-detail 3D models with embedded animation mixers, with seamless fallback to a 10-node procedural box skeleton.
  - **Gallop Cadence**: Dynamic speed-dependent gallop frequency (4.4 Hz at 65 km/h racing speed).
  - **Dynamic Rider Kinematics**: Real-time pelvis bobbing, speed-based forward wind tuck, and reactive upper-body banking into turns and dodges.
  - **Rest-Pose Bone Protection**: Skeletal adjustments (shoulders, legs, neck) are anchored to baseline rest rotations, preventing additive angle drift.

- **Object Pooling & Flush Surface Alignment**:
  - Dedicated zero-garbage object pool for obstacles (hurdles, logs, rocks, and fences) and roadside scenery (evergreen trees, sunlit oaks, and bushes).
  - In-place `BufferAttribute.set()` updates on recycled track chunks, preventing GC pauses.
  - Roadside scenery and obstacles sample the banked Frenet-Serret track frame to sit flush on hills without floating or clipping.
  - Deterministic pseudo-random variation per chunk index for diverse roadside scenery distribution.

- **Real-Time Telemetry Debug HUD**:
  - Performance telemetry: FPS, frame time (ms), draw calls, triangle count, and geometry/texture memory.
  - Kinematics readouts: forward speed ($m/s$ and $km/h$), distance covered, lateral lane position ($u$), track bank angle (°), gallop stride cadence (Hz), and active chunk/obstacle counts.

- **Hardware Motion Controller Support**:
  - Wired/I2C Raspberry Pi `MPU-6050` accelerometer bridge over WebSockets.
  - Wireless ESP32-S3 `M5Stack AtomS3` rein motion controller streaming 50 Hz binary UDP packets.

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
| `Space` | Quick Restart after Game Over |
| `F3` / `H` / `` ` `` | Toggle Engine Telemetry Debug HUD |

### 2. Mobile Touch

- **Tap / Hold Left Half of Screen**: Steer Left (-1.0)
- **Tap / Hold Right Half of Screen**: Steer Right (+1.0)
- Touch steering takes priority over keyboard and sensor fallback when active.

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

### Option A: Raspberry Pi I2C Accelerometer Bridge

The Python bridge (`scripts/sensor_bridge.py`) reads tilt angles from an MPU-6050 6-axis IMU over the Raspberry Pi's I2C bus and broadcasts steering values over a local WebSocket server at `ws://<pi-ip>:8080`.

#### Hardware Wiring (Raspberry Pi GPIO)

| MPU-6050 Pin | Raspberry Pi Pin | Function |
| :--- | :--- | :--- |
| **VCC** | Pin 1 | 3.3V Power |
| **GND** | Pin 6 | Ground |
| **SDA** | Pin 3 (GPIO 2) | I2C1 Data |
| **SCL** | Pin 5 (GPIO 3) | I2C1 Clock |

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

Point your browser to the game with the `?sensor=<host>` URL query parameter:

```
http://localhost:3000/?sensor=192.168.1.50
```

---

### Option B: M5Stack AtomS3 Wireless Rein Controller

The `scripts/m5stack_atoms3_reins/` sketch turns an ultra-compact **M5Stack AtomS3** (ESP32-S3 with built-in Bosch BMI270 IMU and 128x128 color LCD) into wireless horse reins.

- **Binary UDP Protocol**: Transmits an 8-byte binary datagram at 50 Hz (`0x4552` magic identifier, sequence number, button restart flag, IEEE 754 float steer).
- **Onboard 128x128 LCD Dashboard**: Shows dynamic horizontal steering bar, target destination IP, local IP, and Wi-Fi status.
- **Captive Portal Wi-Fi Provisioning**: If unconfigured or Wi-Fi fails, creates an access point `AtomS3-Setup` at `192.168.4.1` with a mobile-friendly setup page.
- **Runtime Target IP Configuration**: Access `http://<atoms3-ip>/` in any browser on the local network to re-point the UDP destination IP without restarting.
- **Factory Reset**: Hold down the front LCD screen button (`BtnA`) during power-on to clear stored NVS credentials.

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
├── public/
│   └── assets/                  # glTF/GLB 3D character and animal models
├── scripts/
│   ├── sensor_bridge.py         # Python WebSocket/UDP IMU sensor bridge
│   └── m5stack_atoms3_reins/    # Arduino firmware for wireless M5Stack AtomS3 controller
│       └── m5stack_atoms3_reins.ino
└── src/
    ├── main.ts                  # Application bootstrap & lifecycle startup
    ├── camera/
    │   └── RunnerCamera.ts      # 3rd-person follow camera with speed FOV warp
    ├── core/
    │   └── Engine.ts            # Main game loop, scene setup, lighting, and restart orchestration
    ├── entities/
    │   ├── horse/
    │   │   ├── HorseMesh.ts     # Procedural horse geometry & analytical gallop rig
    │   │   └── HorseRunnerController.ts # Locomotion physics, banking, bone rotation manager
    │   └── rider/
    │       └── GirlRiderEntity.ts # Girl rider entity, saddle attachment, kinematic lean/bob
    ├── input/
    │   └── InputManager.ts      # Keyboard, touch, and WebSocket IMU sensor input handler
    ├── loaders/
    │   └── AssetLoader.ts       # glTF loader with animation mixer extraction
    ├── obstacles/
    │   ├── ObstacleManager.ts   # Chunk obstacle spawning, banked orientation, cylinder collision
    │   ├── ObstaclePool.ts      # Multi-type obstacle mesh pooling
    │   └── types.ts             # Obstacle type interfaces
    ├── track/
    │   ├── SplineTrack.ts       # Analytical track spline, tangent/normal evaluation, banking math
    │   ├── TrackChunk.ts        # Individual track chunk mesh, in-place buffer updates, scenery pooling
    │   ├── TrackChunkManager.ts # Linear streaming window, Web Worker orchestration, pool manager
    │   ├── types.ts             # Track geometry & worker message types
    │   └── workers/
    │       └── track.worker.ts  # Web Worker multi-threaded chunk vertex generator
    └── ui/
        ├── DebugHUD.ts          # Telemetry overlay (FPS, draw calls, speed, bank, memory)
        └── HUD.ts               # Clean gameplay HUD (distance, speed, gameover screen)
```

---

## 🛠️ Performance & Tuning

- **Target Framerate**: 60 FPS locked on mobile devices and Raspberry Pi 4.
- **Pixel Ratio**: Clamped to a max of `1.5` to prevent GPU fill-rate exhaustion on high-DPI retina screens.
- **Zero In-Loop Allocations**: Reusable vectors (`_pos`, `_tangent`, `_normal`, `_bankQuat`, `_camPos`, `_lookTarget`) are recycled across frames to eliminate garbage collection pauses.
- **Shadow Map**: PCFSoft shadows with directional sunlight target dynamically tethered to horse position for crisp, local shadow cascades.

---

## 📄 License

MIT License. See repository for full terms.
