# Mobile & Tablet WebGL Performance Optimization Rules

Mobile WebGL performance is constrained by Tile-Based Deferred Rendering (TBDR) GPUs (Apple A-series/M-series, Qualcomm Adreno, ARM Mali), thermal throttling, and aggressive mobile browser memory (VRAM) limits. In an Endless Runner with high forward speed and continuous chunk streaming, all code generated for this project MUST strictly comply with these performance rules.

---

## 1. Frame Budget & Draw Call Hard Caps

*   **Target Framerate**: 60 FPS ($16.66\text{ ms}$ total frame budget).
    *   Main Thread CPU Budget: $\le 6.0\text{ ms}$ (JavaScript, physics, input, horse steering, spline queries).
    *   WebGL Engine CPU Overhead: $\le 2.0\text{ ms}$ (Three.js matrix world updates, frustum culling).
    *   GPU Execution Budget: $\le 8.0\text{ ms}$ (Vertex processing, rasterization, shading, post-processing).
*   **Draw Call Cap**: $\le 60$ draw calls per frame on mobile devices. Under NO circumstances may a frame exceed 80 draw calls.
*   **Triangle Budget**: $\le 150\text{k}$ rendered triangles per frame on mobile viewports.

---

## 2. Linear Chunk Streaming & Obstacle Object Pooling

1.  **Linear Track Chunk Streaming**:
    *   Never maintain a 2D radial chunk grid. Endless runners stream strictly linearly along the forward progression axis.
    *   Keep only 3–5 active chunks ahead of the player and 1 chunk behind the camera.
    *   Recycle old track chunk geometries and materials via a pre-allocated chunk ring buffer to avoid memory allocations and buffer re-creation.
2.  **Mandatory 100% Obstacle Pooling**:
    *   Instantiating or deleting meshes/colliders while running causes catastrophic GC frame drops.
    *   Pre-allocate a fixed pool of obstacle entities (e.g. 20 rocks, 20 logs, 15 hurdles, 10 fences) at game startup.
    *   Activate obstacles from the pool when new chunks spawn ahead, and return them to the pool when chunks exit behind the camera:
    ```typescript
    export class ObstaclePool {
      private available: Map<ObstacleType, ObstacleEntity[]> = new Map();
      private inUse: Set<ObstacleEntity> = new Set();

      public acquire(type: ObstacleType): ObstacleEntity {
        const list = this.available.get(type);
        const obstacle = list && list.length > 0 ? list.pop()! : this.createInstance(type);
        obstacle.active = true;
        this.inUse.add(obstacle);
        return obstacle;
      }

      public release(obstacle: ObstacleEntity): void {
        obstacle.active = false;
        obstacle.mesh.visible = false;
        obstacle.collider.setEnabled(false);
        this.inUse.delete(obstacle);
        this.available.get(obstacle.type)?.push(obstacle);
      }
    }
    ```
3.  **Instanced Track Scenery & Foliage**:
    *   Foliage, boundary fences, lanterns, and trees along the track edges MUST use `THREE.InstancedMesh` per chunk. Individual mesh instances for scenery are strictly forbidden.

---

## 3. Zero-GC (Zero Garbage Collection) in the Render Loop

Garbage collection pauses directly cause visible micro-stutters during fast gallop motion. The 60 FPS animation loop (`Engine.tick()`, `HorseRunnerController.update()`, `RunnerCamera.update()`) MUST be 100% allocation-free.

### Forbidden inside the tick loop:
*   `new THREE.Vector3()`, `new THREE.Quaternion()`, `new THREE.Matrix4()`, `new THREE.Raycaster()`, `new THREE.Box3()`
*   `array.map()`, `array.filter()`, `array.slice()`, object spreading `{ ...obj }`, array spreading `[ ...arr ]`
*   Spline point allocations: sampling curves MUST populate pre-allocated target vectors (`spline.getPointAt(t, _outVec)`).
*   Creating anonymous closures or arrow callbacks inside `update()` / `render()`.

### Mandatory Object Pooling Pattern:
```typescript
// Define reusable scratch variables at module scope
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();

export class HorseRunnerController {
  public update(deltaTime: number): void {
    // Re-use scratch vectors without heap allocations
    this.spline.getPointAt(this.trackProgress, _v0);
    this.spline.getTangentAt(this.trackProgress, _tangent);
    
    // Lateral displacement offset
    _normal.set(-_tangent.z, 0, _tangent.x).normalize();
    _v0.addScaledVector(_normal, this.lateralOffset);

    this.mesh.position.copy(_v0);
  }
}
```

---

## 4. Device Pixel Ratio (DPR) & Resolution Scaling

1.  **DPR Clamping**:
    ```typescript
    // Mandatory DPR clamp
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    ```
2.  **Dynamic Resolution Scaling (DRS)**: If consecutive frame times exceed $18\text{ ms}$ over a 60-frame rolling window, scale down internal render target resolution to `0.85x` or `0.75x` to preserve 60 FPS pacing.

---

## 5. Texture & VRAM Budget (KTX2 / Basis Universal)

1.  **Mandatory KTX2 Compression**: All 2D textures (albedo, normal, roughness, splat maps) MUST be delivered in `.ktx2` format using Basis Universal (ETC1S or UASTC).
2.  **Texture Dimensions**:
    *   Track surface & splat maps: $\le 1024 \times 1024$.
    *   Horse & Rider albedo/normal maps: $\le 1024 \times 1024$.
    *   Obstacles & props: Atlas $\le 1024 \times 1024$ shared across all obstacle models.
    *   UI & Icons: Atlas $\le 512 \times 512$.
3.  **Mipmaps & Anisotropy**: Always generate mipmaps. Limit `maxAnisotropy` to `2` or `4` on mobile devices.

---

## 6. Shaders & Overdraw Management

1.  **Precision Qualifier**: Explicitly use `precision mediump float;` in custom shaders.
2.  **Alpha Testing vs Alpha Blending**: For foliage and vegetation along track borders, use `alphaTest: 0.5` and `depthWrite: true` rather than alpha blending (`transparent: true`) to avoid sorting overhead and severe TBDR overdraw penalties.
3.  **Discard Optimization**: Keep alpha testing discard statements as early as possible in fragment shaders to allow early depth rejection.
