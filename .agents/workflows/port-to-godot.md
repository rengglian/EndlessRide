# Workflow: Port Endless Ride to Godot 4 (.NET / C#)

> Master execution workflow for porting the Three.js codebase to Godot 4 (.NET 10 / C#) targeting NVIDIA Shield TV (Android TV) and Linux Desktop.

---

## Tooling & Environment Verification
- **Godot Engine**: Godot Mono / .NET edition v4.8-beta1 located at `/opt/godot/Godot_v4.8-beta1_mono_linux_x86_64/Godot_v4.8-beta1_mono_linux.x86_64`.
- **.NET SDK**: .NET 10 SDK (`dotnet-sdk-10.0`, version `10.0.113`) at `/usr/lib/dotnet/dotnet`.
- **Android SDK**: Located at `/home/rengglian/Android/Sdk`.
- **Java**: OpenJDK 21 / 25 at `/usr/lib/jvm/`.
- **Target Git Branch**: `godot-port`.

---

## Port Execution Phases & Subagent Responsibilities

### Phase 1: Project Scaffolding & Math Engine (Subagents: `godot-port-lead`, `godot-track-engineer`)
1. Create `godot/` project root directory.
2. Initialize `godot/project.godot` with 3D settings, window size, input map, and render pipeline.
3. Configure `godot/EndlessRide.csproj` targeting `net10.0` with `Godot.NET.Sdk` `4.7.2`.
4. Port `src/config.ts` to `godot/Scripts/Core/Config.cs`.
5. Port `src/track/trackMath.ts` to `godot/Scripts/Track/TrackMath.cs` (pure C# math, zero Godot dependencies, unit-tested).
6. Port `src/track/SplineTrack.ts` to `godot/Scripts/Track/SplineTrack.cs`.

### Phase 2: Procedural Track Geometry & Shaders (Subagents: `godot-track-engineer`, `godot-port-lead`)
1. Implement `TrackChunk.cs` generating procedural `ArrayMesh` for path, curbs, and meadow skirts.
2. Port GLSL shader from Three.js to Godot Shading Language: `godot/Shaders/track_meadow.gdshader`.
3. Integrate multithreaded chunk generation via `Godot.WorkerThreadPool`.
4. Implement `TrackChunkManager.cs` for linear forward streaming and pool recycling.
5. Setup `MultiMeshInstance3D` for instanced trees, bushes, and curbside scenery.

### Phase 3: Kinematics, Horse Controller & Rider (Subagents: `godot-gameplay-animator`)
1. Create `HorseRunnerController.cs` with lateral steering, acceleration, and dynamic banking roll.
2. Implement 4-point raycast/elevation track suspension.
3. Port `GirlRiderEntity.cs` procedural animations (pelvis bounce, speed tuck, lateral dodge).
4. Implement dynamic reins ribbons using `ImmediateMesh`.
5. Import glTF models (`horse.gltf`, modular character) and bind animations.

### Phase 4: Hazards, Collectibles & Collision (Subagents: `godot-gameplay-animator`, `godot-port-lead`)
1. Port `ObstaclePool.cs` and `ObstacleManager.cs` for pooled rocks, hurdles, and fences.
2. Port `CollectiblePool.cs` and `CollectibleManager.cs` for apples and golden horseshoes.
3. Implement swept longitudinal interval AABB collision detection in $(s, u)$ space.
4. Hook collision triggers to game over and stumble sequences.

### Phase 5: Hardware UDP, Embedded Web Server & UI (Subagents: `godot-tv-network-engineer`, `godot-port-lead`)
1. Implement `UdpMotionReceiver.cs` listening on port `8081` for M5Stack AtomS3 binary packets.
2. Implement `EmbeddedWebServer.cs` on port `8080` serving the companion remote app (`public/remote.html`).
3. Build CanvasLayer HUD (`HUD.tscn`) and Android TV Leanback navigation menus (`LeanbackMenu.tscn`).
4. Implement persistent top-10 leaderboard in `user://leaderboard.json`.

### Phase 6: Build, Verification & Android TV Deployment
1. Build and verify Linux desktop standalone build (`dotnet build`).
2. Run headless smoke tests (`godot --headless`).
3. Configure `export_presets.cfg` for Android TV / NVIDIA Shield APK export.
4. Verify ADB connection and APK deployment.
