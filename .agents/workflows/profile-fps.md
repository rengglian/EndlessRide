# Workflow: Profile FPS, Draw Calls & Runner Telemetry (`/profile-fps`)

Use this workflow to conduct a full performance and memory diagnostic of the endless runner 3D rendering pipeline, identify frame drops during high-speed galloping, and generate an actionable optimization report.

---

## Phase 1: Telemetry Activation & Benchmark Warmup
1.  Enable `WebGLProfiler` and `PerformanceHUD` in the engine loop.
2.  Trigger an automated continuous gallop run through 20 procedural track chunks ($1200\text{m}$ distance) with rapid simulated Left/Right steering inputs.
3.  Discard the initial 3 seconds to allow shader compilation and Web Worker startup to settle.

## Phase 2: Metric Sampling Window (60 Seconds)
Capture samples at 60Hz and compute:
*   **Average FPS** and **1% Low FPS** (frame stutter / micro-freeze indicator).
*   **CPU Frame Time (ms)**: Average, 95th percentile ($P_{95}$), and maximum ($P_{\max}$).
*   **GPU Frame Time (ms)**: Measured via `EXT_disjoint_timer_query_webgl2`.
*   **Draw Calls**: Per-frame total calls (target $\le 60$).
*   **Active Chunks & Obstacles**: Monitored count of active chunk meshes and pooled obstacle entities.
*   **JS Heap Size**: Differential heap growth before vs after traversing 20 track chunks.

## Phase 3: Bottleneck Classification

Evaluate metrics against project performance budgets:

| Metric | Budget | Status Rule | Remediation |
| :--- | :--- | :--- | :--- |
| **FPS** | $\ge 58\text{ FPS}$ | Warning if $<55$, Critical if $<45$ | Inspect CPU/GPU split |
| **Draw Calls** | $\le 60$ | Critical if $>75$ | Batch obstacles/props into `InstancedMesh` |
| **CPU Time** | $\le 6.0\text{ ms}$ | Critical if $>10.0\text{ ms}$ | Audit physics step & zero-GC allocations |
| **GPU Time** | $\le 8.0\text{ ms}$ | Critical if $>12.0\text{ ms}$ | Lower DPR to 1.5/1.0 or simplify track splat shader |
| **Geometry Leak** | $\Delta = 0$ | Critical if $\Delta > 0$ after chunk recycling | Audit chunk unmounting and obstacle pool release |
| **Heap Drift** | $< 2.0\text{ MB}$ | Critical if $> 5.0\text{ MB}$ | Audit vector allocations in spline/input update |

## Phase 4: Generate Diagnostic Artifact
Output the findings as a structured markdown artifact:
*   Summary table of all metrics vs budgets.
*   Identified hot code paths or allocation sites inside the runner render loop.
*   Direct code diff proposals for any detected bottlenecks.
