# Endless Ride: Godot 4 (.NET / C#) Edition

Comprehensive technical and operational documentation for the Godot 4 (.NET 10 / C#) port of **Endless Ride**, targeting **Linux Desktop (x86_64)** and **NVIDIA Shield TV (Android TV / Tegra X1)**.

---

## 1. System Architecture

The Godot engine runs as the standalone central console hub, handling rendering, physics, procedural generation, network hardware controllers, and companion mobile remotes without requiring external server processes.

```
                         ┌────────────────────────────────┐
                         │         M5Stack AtomS3         │
                         │   (Wireless IMU Motion Reins)  │
                         └──────────────┬─────────────────┘
                                        │ Wi-Fi UDP (Binary packets @ 50 Hz, Port 8081)
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        NVIDIA SHIELD TV / LINUX DESKTOP                                │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                            Godot 4.7 (.NET 10 / C#)                              │  │
│  │                                                                                  │  │
│  │  ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────────┐  │  │
│  │  │  Hardware UDP Listener│  │ Embedded Web Server   │  │  Save State / Config │  │  │
│  │  │  (Port 8081 - AtomS3) │  │  (Port 8080 - HTTP/WS)│  │  (user://leaderboard)│  │  │
│  │  └──────────┬────────────┘  └───────────┬───────────┘  └──────────────────────┘  │  │
│  │             │                           │                                        │  │
│  │             └─────────────┬─────────────┘                                        │  │
│  │                           ▼                                                      │  │
│  │  ┌────────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                          Endless Ride Core Engine                          │  │  │
│  │  │  • Procedural Spline Extrusion (ArrayMesh on Background Threads)           │  │  │
│  │  │  • Custom Cobblestone & Rolling Meadow Spatial Shader                      │  │  │
│  │  │  • Animated glTF Horse, Procedural Multi-Joint Rider & Dynamic Reins       │  │  │
│  │  │  • High-Visibility Equestrian Obstacles & Collectibles Pools               │  │  │
│  │  │  • MultiMesh Roadside Scenery (Blender Pine, Oak, Birch & Flowering Bush)  │  │  │
│  │  │  • CanvasLayer In-Game HUD & Telemetry Broadcast                           │  │  │
│  │  └────────────────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
└─────────────────────────────────────────────┼──────────────────────────────────────────┘
                         │                    │
        HDMI 2.0 (4K/60) │                    │ Local Wi-Fi HTTP & WebSocket (:8080)
                         ▼                    ▼
               ┌──────────────────┐  ┌─────────────────────────────────┐
               │   Living Room    │  │   Smartphone Companion Remote   │
               │   TV / Monitor   │  │   (Safari / Chrome Web Remote)  │
               └──────────────────┘  └─────────────────────────────────┘
```

---

## 2. Controls & Input Methods

The engine seamlessly samples inputs across four simultaneous sources with zero configuration:

| Input Source | Steering | Start / Restart | Pause | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Keyboard** | `A` / `D` or `Left` / `Right` Arrows | `Space` / `Enter` | `P` / `Esc` | Instant desktop fallback |
| **Gamepad / Shield Controller** | Left Thumbstick (X-axis) / D-Pad | `A` / `Cross` Button | `Start` / `Menu` | Configured via Godot JoyAxis mapping |
| **M5Stack AtomS3 (Physical Motion)** | Hardware roll tilt (Bosch BMI270) | Screen tap / Button | N/A | Low-latency binary UDP @ 50 Hz (:8081) |
| **Smartphone Companion Web App** | Virtual touch joystick / phone tilt | On-screen tap | N/A | Served directly by Godot on port 8080 |

### Lateral Physics & Smoothing
- Forward speed: Begins at $18\text{ m/s}$, accelerating with distance traveled ($v = v_0 + a \sqrt{s}$).
- Lateral steering: Governed by exponential velocity damping:
  $$\Delta v_{\text{lat}} = (v_{\text{target}} - v_{\text{lat}}) \cdot (1 - e^{-18 \cdot \Delta t})$$
- Track boundaries: Clamped strictly to the runnable cobblestone bounds ($|u| \le 3.8\text{m}$).

---

## 3. Graphics & Shader Pipeline

The game is optimized for the **GL Compatibility** renderer (`gl_compatibility` / OpenGL ES 3) to ensure rock-solid 60 FPS on Tegra X1 (NVIDIA Shield TV) and broad compatibility on Linux.

### 3.1 Balanced Lighting Environment
- **Ambient Fill**: Configured in Color Mode (`ambient_light_source = 2`) with soft sky-blue ambient fill (`Color(0.60, 0.70, 0.82)`) at energy `0.70`. This prevents pitch-black shadow artifacts in the OpenGL ES 3 backend while keeping contrast rich.
- **Sunlight**: `DirectionalLight3D` at `1.15` energy with warm sunlight tint (`Color(1.0, 0.97, 0.90)`), soft shadow bias (`0.08`), and 180m shadow distance.
- **Tonemapping**: ACES Tonemapping (`tonemap_mode = 3`) at `1.05` exposure.

### 3.2 Procedural Cobblestone & Meadow Shader (`track_meadow.gdshader`)
The infinite track is rendered with a unified PBR spatial shader:
- **Limestone Pavers**: Staggered running-bond rectangular pavers ($0.40\text{m} \times 0.50\text{m}$) computed analytically using Dave Hoskins `hash12` noise.
- **Mortar Grooves**: Recessed dark mortar lines with smoothstep falloff and derivative attenuation (`fwidth`) to suppress high-frequency moiré shimmering at distance.
- **Curbs**: 35cm sandstone border trim separating the playable path ($|u| \le 3.8\text{m}$) from the meadow.
- **Rolling Countryside**: Two-tone procedural emerald and golden grass with randomized wildflower blooms on outer hillside slopes.
- **Matte Surface Calibration**: Calibrated albedos and roughness ($0.75 - 0.85$) prevent blinding specular blowouts.

---

## 4. 3D Models & Animation Architecture

### 4.1 Galloping Horse (`Horse.gltf`)
- **Model**: High-poly animated equestrian mesh scaled to $0.38\times$ with centered pivot.
- **Stride Cadence**: Skeletal animation `"Gallop"` is dynamically synchronized to forward running velocity:
  $$\text{SpeedScale} = \frac{v}{18.0} \times 1.6$$
- **Crash Dynamics**: On collision, triggers the skeletal `"Death"` animation with body roll tumble.

### 4.2 Adventurer Rider (`Adventurer.gltf`)
- **Origin**: Authored in Blender for the *Ultimate Modular Characters* pack (CC0).
- **Procedural Equestrian Posture**: The asset pack includes 24 on-foot combat clips but no saddle-riding clip. The rider is procedurally posed on the skeleton at runtime:
  - Bone relative rotation transform: $R_{\text{pose}} = R_{\text{rest}} \times \Delta R_{\text{local}}$.
  - **Thighs (`UpperLeg.L/R`)**: Swung forward $-63^\circ$ ($-1.10\text{ rad}$) and spread outward $\pm 0.25\text{ rad}$ across the saddle flanks.
  - **Knees (`LowerLeg.L/R`)**: Bent backward $+66^\circ$ ($+1.15\text{ rad}$) so shins hang down the horse flanks.
  - **Stirrups (`Foot.L/R`)**: IK targets parented to `Root` positioned cleanly at $( \pm 0.38\text{m}, 0.44\text{m}, 0.02\text{m})$.
  - **Reins Grip (`UpperArm`, `LowerArm`, `Wrist`)**: Reaching forward to grip the bit reins.
- **Dynamic Gallop Kinematics**:
  - Pelvic vertical bobbing: Synchronized with the horse stride ($y = \sin(2\phi) \times 0.045\text{m}$).
  - Speed-scaled wind tuck: Rider leans forward into the wind as speed climbs ($14 \to 30\text{ m/s}$).
  - Reactive lateral dodge lean: Torso rolls into sharp steering maneuvers.
  - Head gaze counter-stabilization: Keeps eyes locked forward down the track.
- **Collision & State Reset**:
  - Tumbles naturally to the ground beside the fallen horse upon impact.
  - Comprehensive reset on restart: clears positions, rotations, and re-invokes the clean equestrian saddle alignment.

### 4.3 Roadside Scenery (Blender Low-Poly Assets)
Authored in Blender and exported to `Assets/Models/` as unified single-mesh models rendered with `MultiMeshInstance3D` in 1 draw call per variant:
1. `TreePine.glb`: Tall Nordic Spruce/Pine with 3-tiered conical needle canopies.
2. `TreeOak.glb`: Broadleaf Deciduous Oak with 4 asymmetrical cloud-like canopy clusters.
3. `TreeBirch.glb`: Slender Poplar/Birch with white/cream bark and lime-gold foliage.
4. `BushMeadow.glb`: Rounded flowering shrub with wildflower blossoms.
- **Grounded Elevation**: Every tree dynamically samples the mathematical terrain height $h(u)$, with trunk roots embedded $0.5\text{m}$ below the surface to eliminate floating trees on slopes.

### 4.4 High-Visibility Equestrian Obstacles
All obstacles feature strong silhouettes and warning colors for split-second reaction times at high speed:
- **Hurdles**: Show-jumping standard wings in Royal Blue (`Color(0.10, 0.24, 0.62)`), grounded plinth board, and 5-segment alternating **Red / White / Red / White / Red** striped jump poles.
- **Rock Boulders**: Multi-boulder dark charcoal granite clusters (`Color(0.24, 0.23, 0.25)`) with emerald moss crowns.
- **Fallen Logs**: Dark walnut timber cylinder with light heartwood cut-end rings and branch stubs.
- **Rustic Fences**: Dark wood posts with high-contrast white rails and X-cross braces.

---

## 5. Network Subsystems

### 5.1 Hardware UDP Receiver (`HardwareUdpReceiver.cs`)
- Binds to UDP port `8081`.
- Receives 8-byte binary packets from the M5Stack AtomS3:
  - Header byte: `0xAA`
  - Roll angle: `int16` (scaled by $100.0$)
  - Pitch angle: `int16` (scaled by $100.0$)
  - Checksum: XOR validation byte
- Automatically zero-tares neutral position and maps tilt smoothly to $[-1.0, +1.0]$ steering.

### 5.2 Embedded Companion Web Server (`CompanionWebServer.cs`)
- Asynchronous HTTP and WebSocket server running on port `8080`.
- Serves `remote.html` to any phone connected to the same Wi-Fi network without requiring internet access.
- Broadcasts real-time telemetry at 20 Hz (`STATE`, `DISTANCE`, `SPEED`, `SCORE`, `MULTIPLIER`, `STEER`).
- Accepts remote steering inputs, tare calibration requests, difficulty preset changes, and rider name updates.

---

## 6. Project Sitemap

```
godot/
├── Assets/
│   └── Models/
│       ├── Adventurer.gltf       # High-fidelity adventurer character
│       ├── Horse.gltf            # High-poly animated galloping horse
│       ├── TreePine.glb          # Nordic spruce/pine tree
│       ├── TreeOak.glb           # Broadleaf deciduous oak
│       ├── TreeBirch.glb         # Slender birch/poplar tree
│       └── BushMeadow.glb        # Flowering meadow bush
├── Scenes/
│   └── Main.tscn                 # Primary root scene (GameManager, Camera, WorldEnvironment, Sun)
├── Scripts/
│   ├── Camera/
│   │   └── RunnerCamera.cs       # Third-person lag-follow camera with curvature lookahead
│   ├── Collectibles/
│   │   ├── CollectibleEntity.cs  # Apple & Horseshoe data
│   │   ├── CollectibleManager.cs # Spawning & magnetic collection
│   │   └── CollectiblePool.cs    # Pre-allocated mesh instance pool
│   ├── Core/
│   │   ├── Config.cs             # Tuning constants, speed progression, difficulty presets
│   │   └── GameManager.cs        # Primary game loop, state machine, input arbitrator, HUD wiring
│   ├── Entities/
│   │   ├── GirlRiderEntity.cs    # Multi-joint equestrian kinematics & bone posing
│   │   └── HorseRunnerController.cs # Locomotion, lateral physics, 4-point suspension & reins
│   ├── Networking/
│   │   ├── CompanionWebServer.cs # Port 8080 HTTP & WebSocket companion server
│   │   └── HardwareUdpReceiver.cs# Port 8081 binary UDP AtomS3 listener
│   ├── Obstacles/
│   │   ├── ObstacleEntity.cs     # Obstacle bounds & lane coordinates
│   │   ├── ObstacleManager.cs    # Swept interval collision check
│   │   └── ObstaclePool.cs       # High-visibility hurdles, rocks, logs, fences
│   ├── Track/
│   │   ├── SplineTrack.cs        # 3D space curve mathematics & banked Frenet frames
│   │   ├── TrackChunk.cs         # Chunk mesh generation & MultiMesh scenery
│   │   ├── TrackChunkManager.cs  # Infinite chunk streaming & pooling ahead/behind
│   │   └── TrackMath.cs          # Cross-section heights & paver math
│   └── UI/
│       └── InGameHUD.cs          # CanvasLayer HUD (Distance, Speed, Multiplier, Score, Countdown)
├── Shaders/
│   └── track_meadow.gdshader     # PBR cobblestone & rolling meadow spatial shader
├── builds/
│   └── linux/
│       ├── EndlessRide.x86_64    # Linux executable runner
│       └── EndlessRide.pck       # Packed game resource bundle
├── EndlessRide.csproj            # .NET 10 project file
├── EndlessRide.sln               # C# solution
├── export_presets.cfg            # Presets for Linux Desktop & Android TV
└── project.godot                 # Engine project configuration
```

---

## 7. Build & Execution Guide

### 7.1 Local Linux Desktop Run
```bash
# 1. Build C# solution
dotnet build godot/EndlessRide.sln

# 2. Export Linux package (path is relative to the --path godot project root)
/opt/godot/Godot_v4.7.2-stable_mono_linux.x86_64 --headless --path godot --export-pack "Linux Desktop (x86_64)" builds/linux/EndlessRide.pck

# 3. Launch the game
./godot/builds/linux/EndlessRide.x86_64
```

### 7.2 NVIDIA Shield TV (Android TV) Deployment
```bash
# 1. Connect over Wi-Fi ADB
adb connect <SHIELD_TV_IP>:5555

# 2. Build Android APK
/opt/godot/Godot_v4.7.2-stable_mono_linux.x86_64 --headless --path godot --export-release "Android TV (NVIDIA Shield)" builds/android/EndlessRide.apk

# 3. Install & launch
adb install -r godot/builds/android/EndlessRide.apk
adb shell monkey -p com.antigravity.endlessride -c android.intent.category.LEANBACK_LAUNCHER 1
```
