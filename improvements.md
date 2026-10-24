# Endless Ride – Project Review & Improvement Plan

> Review date: 2026-10-24 · Scope: all tracked source (`src/`, `index.html`, `scripts/`, configs, `.agents/`), build output, and the asset tree.
> Checks run: `tsc --noEmit` ✅ (no errors), `vite build` ✅ (628 kB JS bundle, **350 MB `dist/`**). `npm run lint` ❌ (ESLint is not installed).

---

## 1. Summary

Endless Ride is a well-scoped Three.js + TypeScript endless runner. The code is small (~3.8k LOC), strictly typed, and well commented. It already does several things right:

- **Analytic spline track**: position, tangent, and banking all come from closed-form equations, so there are no seams between chunks and lookups are cheap.
- **Worker-based chunk generation** with transferable buffers, a generation-ID guard against stale responses, and a sync fallback.
- **Pooling** for track chunks, scenery, and obstacles. **Reusable temp vectors** in the hot paths.
- **Fallbacks everywhere**: procedural horse and rider meshes if the glTF fails to load, a sync generator if the worker fails, NaN guards on inputs.
- **The hardware path works end to end**: AtomS3 firmware with a captive portal, a binary UDP protocol, and a Python WebSocket gateway.

The main weaknesses are:

1. A few **real bugs**: mobile restart, multi-touch steering, the simulated sensor taking over input, and a stale-response race condition.
2. **Duplicated "source of truth" math**: the spline and terrain constants exist in 3–4 copies, and the copies have already drifted apart.
3. **Wrong track UVs**: they are vertex-index based, not metre based, so the paving, curb, and meadow shader runs on distorted coordinates.
4. **Deployment size**: 349 MB of raw art-source files sit in `public/` and get copied into `dist/`.
5. **Draw calls are well over the project's own 60-call budget** because nothing is instanced.
6. **No tests, no linter, no CI**, and several README and skill claims don't match the code.

Each section below lists findings ordered by impact. Every finding has a concrete fix. A prioritized roadmap is at the end.

---

## 2. Critical bugs (fix first)

### 2.1 "Ride Again" button probably doesn't work on touch devices
[InputManager.ts L84-L93](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts#L84-L93) calls `e.preventDefault()` in a `touchstart` listener on `window`, with `passive: false`. Cancelling `touchstart` stops the browser from synthesizing the `click` event, and [HUD.ts L31-L33](file:///home/rengglian/repos/EndlessRide/src/ui/HUD.ts#L31-L33) relies on `click` for the restart button. The global `* { touch-action: none }` in `index.html` makes this more likely.

**Fix**
- Ignore touches whose target is interactive (`if ((e.target as HTMLElement).closest('button')) return;`), or attach the touch listeners to the canvas instead of `window`.
- Better: switch both steering and the button to **Pointer Events** (`pointerdown`/`pointerup`).

### 2.2 Multi-touch steering gets stuck
In [InputManager.ts L84-L113](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts#L84-L113):
- `touchstart` reads `e.touches[0]` instead of `e.changedTouches[0]`. A second finger never takes over steering.
- `touchend` only resets when **all** fingers are lifted. Hold left, add right, release left: `activeTouchId` still points at the lifted finger and steering stays at −1 while the user holds right.

**Fix**: track touches by `identifier` using `changedTouches`. Use the most recent active touch, or treat left+right as 0. Pointer Events with `pointerId` make this simpler.

### 2.3 The bridge's simulated sensor silently takes over steering
- [sensor_bridge.py L187-L191](file:///home/rengglian/repos/EndlessRide/scripts/sensor_bridge.py#L187-L191): with no I²C sensor, the bridge falls back to **simulated mode automatically** and broadcasts a sine-wave steer ([L141-L145](file:///home/rengglian/repos/EndlessRide/scripts/sensor_bridge.py#L141-L145)).
- [InputManager.ts L30-L36](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts#L30-L36): the game **always** connects to `ws://<page-host>:8080`, even without the `?sensor=` parameter.
- [InputManager.ts L120-L124](file:///home/rengglian/repos/EndlessRide/src/input/InputManager.ts#L120-L124): once connected, the sensor value **completely replaces keyboard input**.

Result: run the bridge on the dev machine without hardware and the horse steers itself while the keyboard does nothing.

**Fix**
- Make simulation opt-in only (`--simulate`). Without a sensor, stay idle or send nothing.
- Make the WebSocket connection opt-in (`?sensor=…`) and stop the 4-second reconnect spam (it also logs console errors on every production page load).
- Combine inputs: `steer = touch ?? (keyboard ≠ 0 ? keyboard : sensor)`.
- Add a **staleness timeout**: if no packet arrives for 250 ms, set sensor steer to 0. Otherwise a dead controller leaves the horse locked at its last value.

### 2.4 Hardware button restarts the game mid-run
[Engine.ts L101-L103](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts#L101-L103) restarts on any `'restart'` action, whatever the game state. One accidental press on the AtomS3 wipes a live run. Only allow it in `GAME_OVER`, or map it to "pause" while running.

### 2.5 Stale worker responses can cause duplicate chunk requests
In [TrackChunkManager.ts L365-L371](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts#L365-L371), `pendingRequests.delete(data.chunkIndex)` runs **before** the generation-ID check. After `reset()`, chunk indices 0–4 are requested again. A late response from the old generation then deletes the *new* pending entry, so `update()` re-requests the same chunk. The chunk gets built twice and its obstacles re-roll (randomly, see 3.2).

**Fix**: return early on a generation mismatch *before* touching `pendingRequests`, or key pending requests by `(generationId, chunkIndex)`.

### 2.6 `Engine.dispose()` leaves the render loop running
[Engine.ts L195](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts#L195) schedules `requestAnimationFrame(this.tick)` and never stores the ID. After `dispose()`, `tick` keeps rendering with a disposed renderer. Store the handle and `cancelAnimationFrame` it. Also remove the `<style>` element that [DebugHUD](file:///home/rengglian/repos/EndlessRide/src/ui/DebugHUD.ts#L57-L59) injects.

---

## 3. Correctness & consistency

### 3.1 Spline math is triplicated, terrain profile quadruplicated
The same spline equations are hard-coded in three places:
- [SplineTrack.ts L18-L64](file:///home/rengglian/repos/EndlessRide/src/track/SplineTrack.ts#L18-L64)
- [track.worker.ts L9-L62](file:///home/rengglian/repos/EndlessRide/src/track/workers/track.worker.ts#L9-L62)
- [TrackChunkManager.ts L262-L291](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts#L262-L291) (sync fallback)

The cross-section profile (`offsets`/`heights`) is also copied into [TrackChunk.getGroundHeightAtOffset](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunk.ts#L168-L182) and into the shader thresholds. Change one copy and the horse floats or clips.

**Fix**: put pure, dependency-free functions in a `src/track/trackMath.ts` (`samplePoint`, `sampleTangent`, `bankAngle`, `crossSection`). Import them from the worker, the sync fallback, `SplineTrack`, and the scenery code. Vite bundles shared modules into workers. Add a parity unit test (section 8).

### 3.2 Worker and fallback generate different obstacles
The worker uses `Math.random()` ([track.worker.ts L73](file:///home/rengglian/repos/EndlessRide/src/track/workers/track.worker.ts#L73)). The sync fallback uses a deterministic formula ([TrackChunkManager.ts L214](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts#L214)). Gameplay depends on which path runs.

**Fix**: one generator driven by a **seeded PRNG** (e.g. mulberry32 seeded with `runSeed ^ chunkIndex`). This also enables reproducible runs, daily challenges, and replays.

### 3.3 Banking angle depends on which speed is passed
`getBankingAngleAtDistance(s, speed)` defaults to 12 m/s. Track geometry (worker: hard-coded `144 = 12²`), obstacles, and the horse's position all use 12. But [HorseRunnerController.ts L304](file:///home/rengglian/repos/EndlessRide/src/entities/horse/HorseRunnerController.ts#L304) and the Debug HUD ([Engine.ts L173-L179](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts#L173-L179)) pass the **real** speed (18–30 m/s). The HUD's "track bank" therefore isn't the bank of the rendered track.

**Fix**: separate *geometric bank* (a property of the track, independent of speed) from any *visual lean* of the horse (speed dependent, applied only to the rig). Name them clearly.

### 3.4 `distance` is not arc length
The spline parameter is `z = s`, but `|dP/ds| = √(1 + x'² + y'²)` reaches about 1.06. `distance += speed·dt` therefore underestimates ground distance on curves. Displayed m/s and metres are off by up to ~6%, and the gallop cadence is slightly out of sync with ground speed.

**Fix**: advance with `ds = speed·dt / |P'(s)|`, or pre-build an arc-length lookup table per chunk.

### 3.5 Track UVs are vertex-index based, so the shader runs on distorted coordinates
[track.worker.ts L140-L141](file:///home/rengglian/repos/EndlessRide/src/track/workers/track.worker.ts#L140-L141) sets `u = j / (crossSectionVerts − 1)`, but the 11 cross-section vertices are **not evenly spaced** (−36, −18, −6.5, −4, −3.8, 0, …). As a result:
- The shader comment `3.8 / 36.0 = 0.1055` ([TrackChunkManager.ts L135-L137](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts#L135-L137)) is wrong. The path covers u ∈ [0.4, 0.6].
- The "sandstone curb" band is about **3 cm wide**, so it's effectively invisible.
- Pavers come out about **1.19 m × 0.33 m** (6.4 across the path, 150 rows per 50 m).
- Meadow noise and wildflowers are stretched about **7×** in the outer 18 m strip compared with the inner one.
- `v` restarts at 0 for every chunk and `22 × 50/12` isn't an integer, so **meadow noise and flowers have a visible seam at each chunk boundary**. Stones are fine only because `36 × 50/12 = 150` happens to be an integer.

**Fix**: put metres in the attributes: `uv = (lateralOffset_m, worldDistance_m)`. To avoid float precision loss on long runs, use `worldDistance mod 1200` with a period that every pattern frequency divides. Then write the shader in metres (`pathMask = 1 − smoothstep(3.75, 3.85, abs(u))`, and so on).

### 3.6 Terrain normals ignore the cross-section slope
Every vertex gets the banked "up" normal. That's right for the flat path, but wrong for the 31° curb step and the meadow slopes. Compute per-vertex normals in the worker (finite differences across and along the strip are cheap).

### 3.7 Collision is an instantaneous check in non-uniform space
[ObstacleManager.ts L80-L104](file:///home/rengglian/repos/EndlessRide/src/obstacles/ObstacleManager.ts#L80-L104):
- It checks only the current frame, with a ±1.2 m window. That works today only because `dt` is clamped to 0.05 s (1.5 m at 30 m/s). Lower the clamp, or let speed grow, and the horse tunnels through obstacles. **Use a swept test** over `[prevDistance, distance]`.
- The `0.82` fudge factor and fixed radii ignore the horse's length and the obstacle's width. A hurdle 2.3 m wide is treated as a 1.15 m radius circle. Use per-type **AABBs in (s, u) space** instead.
- Hurdles, logs, and fences are obstacles you *jump* in equestrian sport, but there's no jump (see 6.1).

### 3.8 Time-step handling is inconsistent
`dt` is clamped to 0.1 in [Engine](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts#L123-L126) but to 0.05 in the controller, camera, and rider. Below 20 FPS the game silently runs in slow motion. Use a **fixed-timestep simulation** (an accumulator at 60 Hz, interpolated for rendering). Physics and collisions become deterministic and independent of frame rate, which matters for a Raspberry Pi target.

### 3.9 Smaller issues
- Lateral velocity isn't zeroed when the horse hits the ±3.5 m clamp, so the steering lean persists while pressed against the edge ([HorseRunnerController.ts L151-L159](file:///home/rengglian/repos/EndlessRide/src/entities/horse/HorseRunnerController.ts#L151-L159)).
- The initial HUD speed text is `12.0 m/s` ([index.html L157](file:///home/rengglian/repos/EndlessRide/index.html#L157)) but the start speed is 18.
- Safe-area padding `env(safe-area-inset-top, 20px)` gives **0 px** on devices without a notch (the fallback only applies when `env()` is unsupported). Use `max(20px, env(safe-area-inset-top))`.
- The game starts in `RUNNING` immediately. The `GameState.START` enum value is unused, and the glTF horse and rider "pop in" a moment after the run has begun.
- Bone aliasing (`endsWith('L')` → `.L`) is fragile. It works for the Quaternius rigs but will mis-alias names such as `"BALL"` or `"TAIL"`.

---

## 4. Performance

> The project's own rules ([02-mobile-performance.md](file:///home/rengglian/repos/EndlessRide/.agents/rules/02-mobile-performance.md)) cap a frame at **≤ 60 draw calls**. Rough count from the code: 6 chunks + ~14 scenery meshes per chunk (~84) + ~24 obstacle groups × 1–4 meshes (~60) + horse + rider + reins ≈ **150+ calls**, and the shadow pass roughly doubles the casters. Measure with the Debug HUD on a target device.

### 4.1 Instance scenery and obstacles (biggest win)
- Trees: replace the 6 × 3 meshes per chunk with **one `InstancedMesh` per part** (trunk, lower foliage, upper foliage, bush) for the whole world. Update instance matrices when a chunk is recycled. That's about 4 draw calls instead of ~84.
- Obstacles: one `InstancedMesh` per type part, or merge each obstacle's parts with `BufferGeometryUtils.mergeGeometries` plus vertex colours so each obstacle is a single mesh.

### 4.2 Share obstacle geometries and dispose them
[ObstaclePool.createEntity](file:///home/rengglian/repos/EndlessRide/src/obstacles/ObstaclePool.ts#L57-L144) creates **new geometries for every pooled entity** (64+ at startup), and `dispose()` never frees them. Create each geometry once at module or pool scope, as `TrackChunk` already does.

### 4.3 Remove per-frame allocations (the README claims there are none)
- `GirlRiderEntity.getBone()` ([L73-L79](file:///home/rengglian/repos/EndlessRide/src/entities/rider/GirlRiderEntity.ts#L73-L79)) runs up to 3 map lookups **and 2 regex `replace` calls** (new strings) for about 20 bones every frame. Resolve bone references **once** after load into typed fields.
- `recycleChunkObstacles` builds a new array on every call. Use swap-remove in place.
- `DebugHUD.update` writes `innerHTML`/`innerText` (template strings plus layout work) **every frame**. Throttle to 4–5 Hz, use `textContent`, and skip the work entirely when hidden. That includes the bank-angle calculation in `Engine.tick`.
- `HUD.update` writes `innerText` every frame. Only write when the rounded value changes.

### 4.4 Avoid redundant matrix updates
Each frame the controller calls `customModel.scene.updateMatrixWorld(true)`, then `rootGroup.updateMatrixWorld(true)`, and then the renderer updates the whole scene again. Update once after the transform is set and before sampling bones, then set `matrixWorldAutoUpdate`/`matrixAutoUpdate = false` on static scenery (trees, obstacles once placed).

### 4.5 Renderer and lighting
- **Shadow shimmer**: the sun follows the horse continuously ([Engine.ts L144-L150](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts#L144-L150)). Snap the light position to the shadow-map texel grid (50 m / 1024 px ≈ 5 cm).
- `PCFSoftShadowMap` + `antialias: true` + DPR 1.5 is heavy for a Raspberry Pi 4 or a low-end phone. Add an **adaptive quality** tier (DPR 1.0, `PCFShadowMap` or a blob shadow under the horse, no MSAA) chosen from the measured frame time.
- `side: THREE.DoubleSide` on the terrain material ([TrackChunkManager.ts L56](file:///home/rengglian/repos/EndlessRide/src/track/TrackChunkManager.ts#L56)) is unnecessary because the winding is already up-facing. Remove it.
- Use `Uint16Array` indices: each chunk has 451 vertices.
- **Visible pop-in**: streaming reaches about 200–250 m ahead, but `FogExp2(0.005)` is only ~63% opaque at 200 m ([Engine.ts L60](file:///home/rengglian/repos/EndlessRide/src/core/Engine.ts#L60)). Derive the fog density from the stream distance (≈ 0.010–0.012), or stream one more chunk. Set the camera far plane to match (currently 500 m).
- The procedural cobblestone pattern has no anti-aliasing and shimmers in the distance at speed. Fade the mortar and gravel detail with `fwidth()` or by distance. `fract(sin(x)·43758)` hashes also lose precision on mediump mobile GPUs; use an integer-style hash (e.g. `pcg`, or Dave Hoskins' `hash12`).

### 4.6 Assets (load time and memory)
- Runtime models are **base64-embedded `.gltf`** files of about 3.2–3.6 MB each. That's 33% inflation plus slow JSON and base64 parsing on a Pi. Convert them with `gltf-transform` to **`.glb` + meshopt/quantization**, and **prune unused animation clips** (only gallop is used). Expect at least 5× smaller files.
- `public/assets/horse.gltf` is a byte-identical duplicate of `Ultimate_Animated_Animals/glTF/Horse.gltf`, and both are candidates. Keep one.
- The rider loads through its own `GLTFLoader` instance ([GirlRiderEntity.ts L107](file:///home/rengglian/repos/EndlessRide/src/entities/rider/GirlRiderEntity.ts#L107)) instead of `AssetLoader`. Unify them so caching, loading progress, and error handling live in one place.

### 4.7 Bundle
The main bundle is 628 kB (163 kB gzip), mostly Three.js. Use `import { WebGLRenderer, … } from 'three'` (tree-shakable), and lazy-load `GLTFLoader` and `DebugHUD` via `import()`.

---

## 5. Architecture & code quality

### 5.1 Centralize configuration
Magic numbers are spread across files and must be kept in sync by hand:

| Value | Appears in |
|---|---|
| Base speed `18.0` | controller, rider, camera, DebugHUD |
| Steer speed `12.0` | controller, rider |
| Chunk length `50` | manager, DebugHUD (`* 50`) |
| Path half-width `3.8` | SplineTrack, worker, sync fallback, TrackChunk, shader |
| Lookahead `+4` chunks | `update()` and `applyChunkData()` |

Create `src/config.ts` (game tuning) and `src/track/trackMath.ts` (geometry). Pass shader constants as `uniforms` or `#define`s built from the same config.

### 5.2 Separate the simulation from the presentation
`HorseRunnerController` currently handles physics, model loading, bone aliasing, rider attachment, rein geometry, and crash posing. Suggested split:
- `RunnerState` (pure data: distance, lateral, speed, velocity) plus `RunnerPhysics.step(state, input, dt)`: pure and unit-testable.
- `HorseView` (procedural or glTF) and `RiderView` implementing one shared interface (`update(state, phase)`, `getSaddleTransform()`, `getBitPositions()`). This removes the `if (customModel) … else …` branches.
- `Reins` as a small component.

### 5.3 Other code quality items
- **Model swap race**: `loadBestAvailableModel()` and `loadCustomRider()` are fire-and-forget. If a restart or crash happens mid-load, crash posing is applied to the wrong object. Use a load phase that is awaited before `START → RUNNING`, with a progress indicator.
- **The README claims "Rest-Pose Bone Protection"**, but the rider stores `baseRotations` and then writes absolute Euler values (`upperArmL.rotation.set(-0.9, …)`). Either apply offsets relative to the rest pose, or drop the claim and the unused maps.
- **Typing**: replace `any` (`(self as any).postMessage`, `Promise<any>` in the rider loader, `(window as any).__engine`). Add `/// <reference lib="webworker" />` and use `DedicatedWorkerGlobalScope`.
- **Debug export**: guard `window.__engine` with `import.meta.env.DEV` ([main.ts L13](file:///home/rengglian/repos/EndlessRide/src/main.ts#L13)).
- The **Debug HUD is visible by default** in production builds ([DebugHUD.ts L17](file:///home/rengglian/repos/EndlessRide/src/ui/DebugHUD.ts#L17)). Default it to hidden unless `?debug` is set or in DEV mode.
- **Disposal is incomplete**: procedural horse and rider geometries, obstacle geometries, the rider's glTF resources, and module-level scenery geometries and materials are never disposed.
- The unused `trackWidth` field in `GenerateTrackChunkRequest`, and `setObstacleManager` / `getSaddleTransform`, appear to be dead code.
- Add a worker `onerror` → fall back to sync generation at runtime. Currently it only logs, and pending chunks never arrive.

---

## 6. Gameplay & UX

### 6.1 Core loop
- **Jump** (Space, swipe up, or tilting the reins back): hurdles, logs, and fences should be jumpable while rocks must be dodged. This makes the obstacle types matter. A short airborne arc with an IK-free leg tuck in the gallop clip, or a separate "jump" clip, works well.
- **Difficulty curve**: speed grows as `18 + 0.1·√d` and only reaches the 30 m/s cap after ~14 km, while obstacle density is constant. Scale wave spacing, the double-obstacle ratio, and lateral patterns (zig-zags, slaloms) with distance.
- **Collectibles** (horseshoes, apples) to encourage lane changes, plus a score multiplier.
- **Crash feedback**: currently the model just snaps to a rotated pose. Add a short tumble or slow-motion, camera shake, a fade, and a sound.

### 6.2 Flow & meta
- Use the unused `START` state: a title screen with a loading bar, a "tap to start" prompt, and a short countdown.
- **Pause** on `visibilitychange`, `blur`, Esc, or a hardware button.
- A **high score** in `localStorage`, shown on the game-over card ("New record!").
- **Audio**: gallop hoof-beats synced to `gallopPhase`, wind noise scaled with speed, crash and UI sounds. Use the WebAudio API and resume the context on the first user gesture.
- A settings panel: quality tier, invert steering, sensor sensitivity and deadzone, mute.

### 6.3 Camera
The follow camera is rigidly locked to the horse ([RunnerCamera.ts L27-L57](file:///home/rengglian/repos/EndlessRide/src/camera/RunnerCamera.ts#L27-L57)). Add a critically damped spring on the lateral position and look target, slight roll into steering, and a small speed-based shake. The ride will feel much more dynamic, and the spring also hides 1-frame input jitter.

### 6.4 Visuals
- A sky gradient or simple sky shader instead of a flat colour. Fog and sky colours should match.
- Variation in roadside scenery: rotation around up, a few more archetypes (fences along the path, rocks, flowers). Instancing (4.1) makes this cheap.
- Dust particles behind the hooves at speed.

### 6.5 Mobile & kiosk
- Request **fullscreen** and **Screen Wake Lock** on start. Lock orientation to landscape where supported.
- Offer **DeviceOrientation tilt steering** on phones (after a permission prompt on iOS). It's the natural phone equivalent of the reins controller.
- Add **Gamepad API** support (left stick / D-pad).

---

## 7. Hardware controller (firmware & bridge)

### 7.1 AtomS3 firmware ([m5stack_atoms3_reins.ino](file:///home/rengglian/repos/EndlessRide/scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino))
- **Tilt from the accelerometer alone** ([L256-L263](file:///home/rengglian/repos/EndlessRide/scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino#L256-L263)) is corrupted by linear acceleration when the reins are shaken. The BMI270 has a gyro, so use a **complementary filter** (or Mahony) to get a stable, low-latency roll.
- **Calibration**: add "long-press BtnA = set neutral" (store the roll offset in NVS) and an invert option. Today the neutral position depends on how the device is mounted.
- **Restart is sent in a single UDP packet** ([L270-L272](file:///home/rengglian/repos/EndlessRide/scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino#L270-L272)), so one lost packet loses the press. Use a press counter (`uint8_t buttonSeq`) that the receiver edge-detects, or repeat the flag for about 5 packets.
- **No Wi-Fi reconnection** after setup. If the AP drops, packets go nowhere silently. Check `WiFi.status()` in `loop()`, reconnect, and show the status on the LCD.
- The captive-portal AP is **open**, and the runtime target-IP page has no authentication. That's acceptable for a toy on a home LAN, but add an AP password and/or a PIN shown on the LCD.
- Use `fabsf()` instead of `abs()` for floats, and add a protocol `version` byte to the packet for future changes.

### 7.2 Python bridge ([sensor_bridge.py](file:///home/rengglian/repos/EndlessRide/scripts/sensor_bridge.py))
- Disable the automatic simulation fallback (see 2.3).
- `asyncio.create_task(client.send(msg))` per packet per client ([L121-L129](file:///home/rengglian/repos/EndlessRide/scripts/sensor_bridge.py#L121-L129)) keeps no reference to the task, swallows exceptions, and queues without limit for slow clients. Use `websockets.broadcast(connected_clients, msg)`.
- Use `time.monotonic()` instead of `time.time()` for the AtomS3 liveness check.
- Use sequence numbers to drop out-of-order or duplicate UDP packets.
- Add a `requirements.txt` and a `systemd` unit example for running on a Pi.
- **Optional simplification**: the browser can't receive UDP, but the AtomS3 could serve the **WebSocket itself** (e.g. `arduinoWebSockets`), or connect over **WebSerial/USB**. Either removes the Pi from the AtomS3 path entirely.

---

## 8. Tooling, testing & CI

| Gap | Recommendation |
|---|---|
| `npm run lint` fails because ESLint isn't installed, and the agent hook swallows the error (`\|\| true`) | Add `eslint`, `typescript-eslint`, and a flat `eslint.config.js`. Add Prettier. Make the hook fail on real errors. |
| No tests | Add **Vitest**. High-value pure tests: frame orthonormality and continuity in `SplineTrack`; **parity between worker / fallback / SplineTrack** output; chunk-seam continuity; seeded obstacle generation (no impossible waves, always one open lane); collision AABB cases; `InputManager` merge and staleness logic; the `TrackChunkManager` stale-generation race (2.5). |
| No CI | GitHub Actions: `npm ci && npm run lint && tsc --noEmit && vitest run && vite build`, plus a **bundle-size budget** check. |
| No perf regression guard | A headless Playwright smoke test that runs 10 s and asserts `renderer.info.render.calls` stays within budget and there are no console errors. |
| Agent hooks | The matchers (`replace_file_content\|write_to_file`) may not match the current tool names, and the hooks discard all output. Check that they actually fire. |
| No `engines` field | Add `"engines": { "node": ">=18" }` to match the README. |

---

## 9. Repository, build & deployment

- **349 MB of art-source assets in `public/`** (`.blend`, `.fbx`, `.obj`, an 18 MB `Preview.mp4`, all 7 rider variants × 3 formats) are copied verbatim into `dist/` (**350 MB**). The `.git` directory is already 93 MB.
  - Move source files to an `art-source/` folder outside `public/`, tracked with **Git LFS** or not committed at all.
  - Keep only the optimized runtime `.glb` files in `public/` (probably < 3 MB total).
  - Consider rewriting history (`git filter-repo`) while the repo has only 2 commits.
- **License**: the README says "MIT License. See repository for full terms", but there's no `LICENSE` file. Add one, and add a `CREDITS.md` for the Quaternius CC0 packs. (The bundled `Ultimate_Modular_Women/License.txt` is titled "Ultimate Modular **Males**", which is worth a note.)
- `vite.config.ts` sets `host: true`, which exposes the dev server to the whole LAN. That's intended for mobile testing, but document it, or use `--host` only via an `npm run dev:lan` script.
- `ws://` is blocked as mixed content on HTTPS deployments. Support `wss://`, or document HTTP-only use for the hardware path.

---

## 10. Documentation accuracy

Several claims in `README.md` and the `.agents/` skills don't match the implementation. That misleads contributors and AI agents:

| Claim | Reality |
|---|---|
| "Zero In-Loop Allocations" | Regex/string allocations in `getBone`, array allocation in `recycleChunkObstacles`, and per-frame template strings in the HUDs (see 4.3). |
| "Zero-copy memory transfer" | Transfer to the main thread is zero-copy, but `TrackChunk.updateData` then **copies** into the existing attribute arrays. It's still a good choice; just describe it accurately. |
| "Rest-Pose Bone Protection" | The rider writes absolute rotations (see 5.3). |
| "Sandstone curbing trim" | About 3 cm wide because of the UV issue (see 3.5). |
| "60 FPS locked on Raspberry Pi 4" | Unverified, and the draw-call estimate is well over budget. Publish measured numbers instead. |
| Skill `horse-controller`: "4-point raycast track suspension, two-bone analytical hoof IK" | Not implemented anywhere in `src/`. |
| Bank formula in the README uses real speed | Geometry uses a fixed 12 m/s (see 3.3). |

Also add a short **CONTRIBUTING** section (coordinate conventions, how to add an obstacle type, how to regenerate optimized assets).

---

## 11. Prioritized roadmap

| Priority | Item | Section | Effort |
|---|---|---|---|
| 🔴 P0 | Fix mobile restart (touch `preventDefault`) and multi-touch steering | 2.1, 2.2 | S |
| 🔴 P0 | Sensor opt-in, no auto-simulation, staleness timeout, combined inputs | 2.3 | S |
| 🔴 P0 | Restart button only in `GAME_OVER`; stale-response race; cancel rAF | 2.4–2.6 | S |
| 🔴 P0 | Move art-source out of `public/`; ship optimized `.glb` | 4.6, 9 | M |
| 🟠 P1 | Shared `trackMath.ts` + seeded PRNG + parity tests | 3.1, 3.2, 8 | M |
| 🟠 P1 | Metre-based UVs + rewrite shader masks + proper normals | 3.5, 3.6 | M |
| 🟠 P1 | Instanced scenery/obstacles, shared geometries | 4.1, 4.2 | M |
| 🟠 P1 | ESLint + Vitest + CI pipeline | 8 | S–M |
| 🟡 P2 | Fixed-timestep loop, swept AABB collisions | 3.7, 3.8 | M |
| 🟡 P2 | Remove per-frame allocations; throttle HUD DOM writes | 4.3 | S |
| 🟡 P2 | Shadow texel snapping, fog/stream distance match, adaptive quality | 4.5 | S–M |
| 🟡 P2 | Start screen + loading, pause, high score, audio | 6.2 | M |
| 🟢 P3 | Jump mechanic, difficulty curve, collectibles | 6.1 | M–L |
| 🟢 P3 | Spring camera, sky, particles, scenery variety | 6.3, 6.4 | M |
| 🟢 P3 | Firmware: gyro fusion, calibration, reliable button, Wi-Fi reconnect | 7.1 | M |
| 🟢 P3 | Split controller into physics/view components; config module | 5.1, 5.2 | M |
| 🟢 P3 | Fix README/skill claims; add LICENSE, CREDITS, CONTRIBUTING | 9, 10 | S |

*S = under half a day, M = 1–3 days, L = more than 3 days.*
