# Workflow: Build Procedural Track & Obstacle Chunk System (`/build-chunk-system`)

Use this workflow to construct, refactor, or verify the endless runner procedural curved track streaming engine, Web Worker spline extrusion, obstacle pooling, and Left/Right steering mechanics.

---

## Phase 1: Spline Math & Web Worker Infrastructure
1.  Verify Web Worker support in the build pipeline (e.g., Vite `?worker` or Comlink).
2.  Create `src/track/workers/track.worker.ts` with strict TypeScript typing for input messages (`GenerateTrackChunkRequest`) and transferable output messages (`GenerateTrackChunkResponse`).
3.  Implement continuous 3D curve mathematical formulas with smooth horizontal curvature and gentle vertical elevation undulations.
4.  Implement analytical tangent, lateral normal, and curve banking angle calculations inside the worker.

## Phase 2: Track Extrusion & Obstacle Anchor Generation
1.  Extrude ribbon cross-section vertices (path center, border curbs, downward terrain skirts) along the spline slices.
2.  Calculate analytical surface normals directly in the worker without main-thread geometry overhead.
3.  Implement procedural obstacle anchor distribution along discrete lanes (Left, Center, Right), guaranteeing at least one open path through every obstacle pattern.
4.  Send positions, normals, UVs, indices, and obstacle anchor arrays back to main thread using transferable `ArrayBuffer` objects.

## Phase 3: Linear Track Chunk Manager & Pooling
1.  Implement `TrackChunkManager.ts` to manage forward linear chunk streaming (maintain 4 active chunks ahead, 1 behind).
2.  Implement `ObstaclePool.ts` to pre-allocate rock, log, hurdle, and fence entities at startup.
3.  Bind incoming chunk obstacle anchors to pool instances and position them along the curved track lanes.
4.  Recycle out-of-view chunks and release obstacles back to the pool as the horse gallops forward.

## Phase 4: Horse, Girl Rider & Left/Right Controller Integration
1.  Implement `HorseRunnerController.ts` for continuous gallop progression along spline arc-length with distance acceleration.
2.  Implement `InputManager.ts` and `TouchSteer.ts` for Left/Right lateral steering, damping, and track boundary clamping.
3.  Attach `GirlRiderEntity.ts` to horse saddle with dynamic pelvis oscillation ($4.0\text{ Hz}$), roll banking lean, and rein IK.
4.  Implement `RunnerCamera.ts` to track behind the horse with look-ahead curve anticipation and smooth lateral lag.

## Phase 5: Verification & Safety Checklist
*   [ ] Verify 60 FPS fluidity and zero GC allocations during high-speed horse galloping across chunk boundaries.
*   [ ] Verify transferable buffers are used (`buffer.byteLength === 0` after postMessage).
*   [ ] Verify all obstacle patterns provide at least one passable route for Left/Right dodging.
*   [ ] Confirm obstacle colliders trigger appropriate stumble / game over events on collision.
*   [ ] Run `npm run lint` or `./.agents/scripts/lint-and-validate.sh` with zero errors.
