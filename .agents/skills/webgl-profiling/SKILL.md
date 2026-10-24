---
name: webgl-profiling
description: >-
  Provides profiling protocols, instrumentation harnesses, GPU timer query integration, VRAM memory leak detection, real-time Debug HUD telemetry, and Raspberry Pi 4 performance targets for endless runner WebGL applications.
---

# WebGL Profiling & Performance Instrumentation Skill

This skill documents performance benchmarking, memory budgeting, real-time telemetry overlays, and optimization guidelines for low-power embedded devices (such as the Raspberry Pi 4).

---

## 1. Performance Targets & Budgeting

| Metric | Desktop / Mobile Target | Raspberry Pi 4 (Mesa V3D) Target |
| :--- | :--- | :--- |
| **Target Framerate** | **60 FPS** ($16.6\text{ ms}$) | **45 – 60 FPS** ($16.6 - 22.2\text{ ms}$) |
| **Draw Calls** | $< 50$ calls / frame | $< 35$ calls / frame |
| **Polycount / Tris** | $< 50,000$ triangles | $< 30,000$ triangles |
| **Shadow Map Budget** | $1024 \times 1024$ PCFSoft | $512 \times 512$ / $1024 \times 1024$ |
| **DPR Clamping** | $\le 1.5$ | $\le 1.0$ (at $720\text{p}$ / $1080\text{p}$) |
| **VRAM Resident Assets** | $< 40\text{ MB}$ | $< 30\text{ MB}$ |

---

## 2. Built-in Real-Time Debug HUD (`DebugHUD.ts`)

The game includes an integrated real-time telemetry HUD overlay:

### Metrics Monitored:
1. **Performance**: Rolling FPS (color-coded: green $\ge 55$, yellow $30-54$, red $<30$), frame time ($\text{ms}$), WebGL draw calls, triangle count ($k$), geometries & textures in VRAM.
2. **Steering & Input**: Dynamic horizontal deflection meter `[-1.00, +1.00]`, current lane (`LEFT`, `CENTER`, `RIGHT`).
3. **Horse Kinematics**: Speed ($m/s$ and $km/h$), distance ($m$), lateral offset $u$ ($m$), track bank angle ($^\circ$), gallop stride cadence ($Hz$).
4. **World Streaming**: Active streamed chunk count ($m$ ahead) and active obstacle count in pool.

### Toggling:
Press **`F3`**, **`H`**, or **`~`** (or click the header badge) to toggle visibility.

---

## 3. Raspberry Pi 4 Optimization Guidelines

1. **Hardware Acceleration Verification**:
   * Visit `chrome://gpu` in Chromium; ensure **"WebGL: Hardware accelerated"** is active.
2. **Resolution Tuning**:
   * Running at $1280 \times 720$ ($720\text{p}$) or $1080\text{p}$ with DPR $1.0$ yields smooth $60\text{ FPS}$ with low thermal overhead.
3. **Web Worker Offloading**:
   * Procedural terrain extrusion runs in a separate Web Worker thread, allowing the 4-core Cortex-A72 CPU to handle chunk math concurrently without blocking the main render thread.
