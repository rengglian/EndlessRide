import * as THREE from 'three';
import { SplineTrack } from './SplineTrack';
import { TrackChunk } from './TrackChunk';
import { generateChunkData } from './trackMath';
import {
  CHUNK_LENGTH,
  CHUNK_SEGMENTS,
  CHUNKS_AHEAD,
  CHUNKS_BEHIND
} from '../config';
import type { ObstacleManager } from '../obstacles/ObstacleManager';
import type {
  GenerateTrackChunkRequest,
  GenerateTrackChunkResponse
} from './types';

export class TrackChunkManager {
  private scene: THREE.Scene;
  private spline: SplineTrack;
  private obstacleManager: ObstacleManager | null = null;
  private worker: Worker | null = null;
  private sharedMaterial: THREE.MeshStandardMaterial;

  public readonly chunkLength = CHUNK_LENGTH;
  private activeChunks: Map<number, TrackChunk> = new Map();
  private chunkPool: TrackChunk[] = [];
  private pendingRequests: Set<number> = new Set();
  private generationId = 0;
  private currentPlayerDistance = 0;

  constructor(scene: THREE.Scene, spline?: SplineTrack, obstacleManager?: ObstacleManager) {
    this.scene = scene;
    this.spline = spline || new SplineTrack();
    this.obstacleManager = obstacleManager || null;
    this.sharedMaterial = this.createTrackMaterial();

    try {
      this.worker = new Worker(new URL('./workers/track.worker.ts', import.meta.url), {
        type: 'module'
      });
      this.worker.onmessage = this.handleWorkerResponse.bind(this);
      this.worker.onerror = (err) => {
        console.error('Track worker error:', err);
        // Sec 5.3 Fallback: terminate broken worker and satisfy pending requests synchronously
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        const pending = Array.from(this.pendingRequests);
        for (const chunkIndex of pending) {
          this.pendingRequests.delete(chunkIndex);
          this.requestChunk(chunkIndex);
        }
      };
    } catch (e) {
      console.warn('Web Worker initialization failed; using sync fallback:', e);
      this.worker = null;
    }
  }

  public setObstacleManager(mgr: ObstacleManager): void {
    this.obstacleManager = mgr;
  }

  private createTrackMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.65,
      metalness: 0.05,
      color: 0xffffff
      // side: THREE.DoubleSide removed (Sec 4.5: winding is already up-facing)
    });

    // Custom shader modification for bright limestone paving, fine gravel, and rolling meadows
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_pars_vertex>',
        `#include <uv_pars_vertex>
         varying vec2 vTrackUv;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         vTrackUv = uv;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <uv_pars_fragment>',
        `#include <uv_pars_fragment>
         varying vec2 vTrackUv;

         // Mobile-safe Dave Hoskins hash12 (avoids sin/cos float precision issues on mediump mobile GPUs)
         float hash12(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * 0.1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>

        float u = vTrackUv.x;      // Lateral offset in metres [-36.0, +36.0]
        float s = vTrackUv.y;      // Longitudinal distance in metres [0.0, 1200.0]
        float absU = abs(u);

        // 1. Procedural Staggered Cobblestone Pavers & Gravel in Metres (Sec 3.5 & 4.5)
        // Paver dimensions: 0.40m wide x 0.50m long
        vec2 stoneUv = vec2(u * 2.5, s * 2.0);
        vec2 tileId = floor(stoneUv);
        if (mod(tileId.y, 2.0) == 1.0) {
          stoneUv.x += 0.5;
          tileId = floor(stoneUv);
        }
        vec2 tileFract = fract(stoneUv);

        // Mortar groove lines between stones
        float edgeDist = min(min(tileFract.x, 1.0 - tileFract.x), min(tileFract.y, 1.0 - tileFract.y));
        float mortarMask = 1.0 - smoothstep(0.04, 0.09, edgeDist);

        // Distance / derivative attenuation to reduce high-frequency moiré and shimmering (Sec 4.5)
        float fw = clamp(fwidth(stoneUv.x) * 3.5, 0.0, 1.0);
        float detailAtten = 1.0 - fw;

        // Per-stone random luminance variation using mobile-safe hash12
        float stoneHash = hash12(tileId);
        float stoneVar = (stoneHash - 0.5) * 0.12 * detailAtten;

        // High-frequency gravel texture speckles
        float gravelNoise = hash12(stoneUv * 8.0);
        float gravelVar = (gravelNoise - 0.5) * 0.08 * detailAtten;
        mortarMask *= detailAtten;

        // Bright, sunny limestone & light paving stone palette
        vec3 lightPaverBase = vec3(0.96, 0.93, 0.88);   // Very light warm sandstone / limestone
        vec3 mortarColor    = vec3(0.74, 0.70, 0.64);   // Clean mortar groove
        vec3 gravelColor    = vec3(0.99, 0.97, 0.92);   // Bright sunlit gravel highlights

        vec3 paverColor = mix(lightPaverBase + stoneVar + gravelVar, gravelColor, 0.25);
        paverColor = mix(paverColor, mortarColor, mortarMask * 0.75);

        // 2. Sandstone Curb / Border Trim (Sec 3.5: 35cm wide between 3.8m and 4.15m)
        vec3 curbColor = vec3(0.82, 0.79, 0.73);

        // 3. Lush Rolling Meadow & Wildflowers in Metres (Sec 3.5: uniformly scaled, seamless across chunks)
        vec2 meadowUv = vec2(u * 0.25, s * 0.25);
        float meadowNoise = sin(meadowUv.x * 2.4 + meadowUv.y * 3.6) * cos(meadowUv.x * 3.2 - meadowUv.y * 2.0);
        vec3 grassBase   = vec3(0.24, 0.58, 0.22); // Vibrant rich green
        vec3 grassSunlit = vec3(0.36, 0.72, 0.26); // Sunlit golden meadow
        vec3 meadowColor = mix(grassBase, grassSunlit, meadowNoise * 0.5 + 0.5);

        // Wildflower spots on meadows
        vec2 flowerTile = floor(meadowUv * 1.5);
        float flowerHash = hash12(flowerTile);
        if (flowerHash > 0.93) {
          vec3 flowerColor = flowerHash > 0.965 ? vec3(0.98, 0.90, 0.25) : vec3(0.94, 0.35, 0.35);
          float flowerDist = length(fract(meadowUv * 1.5) - 0.5);
          if (flowerDist < 0.28) {
            meadowColor = mix(meadowColor, flowerColor, 0.85);
          }
        }

        // 4. Metre-Based Multi-Layer Splat Blending (Sec 3.5)
        // Path: |u| <= 3.8m
        float pathMask = 1.0 - smoothstep(3.65, 3.85, absU);
        // Curb: 3.8m <= |u| <= 4.15m (35cm wide curb)
        float curbMask = smoothstep(3.65, 3.82, absU) * (1.0 - smoothstep(4.05, 4.25, absU));

        vec3 col = mix(meadowColor, curbColor, curbMask);
        col = mix(col, paverColor, pathMask);

        diffuseColor.rgb = col;
        `
      );
    };

    return mat;
  }

  /**
   * Request initial track generation ahead of player spawn.
   */
  public initTrack(initialChunkCount = CHUNKS_AHEAD + 1): void {
    for (let i = 0; i < initialChunkCount; i++) {
      this.requestChunk(i);
    }
  }

  /**
   * Linear chunk streaming: maintain CHUNKS_AHEAD chunks ahead and CHUNKS_BEHIND behind player distance.
   */
  public update(playerDistance: number): void {
    this.currentPlayerDistance = isNaN(playerDistance) ? 0 : Math.max(0, playerDistance);
    const currentChunkIdx = Math.floor(this.currentPlayerDistance / this.chunkLength);

    const minNeededChunk = Math.max(0, currentChunkIdx - CHUNKS_BEHIND);
    const maxNeededChunk = currentChunkIdx + CHUNKS_AHEAD;

    // Request needed chunks ahead
    for (let i = minNeededChunk; i <= maxNeededChunk; i++) {
      if (!this.activeChunks.has(i) && !this.pendingRequests.has(i)) {
        this.requestChunk(i);
      }
    }

    // Recycle chunks falling behind
    for (const [idx, chunk] of this.activeChunks.entries()) {
      if (idx < minNeededChunk || idx > maxNeededChunk + 1) {
        this.recycleChunk(idx, chunk);
      }
    }
  }

  private requestChunk(chunkIndex: number): void {
    this.pendingRequests.add(chunkIndex);
    const startDist = chunkIndex * this.chunkLength;

    if (this.worker) {
      const msg: GenerateTrackChunkRequest = {
        chunkIndex,
        startDist,
        chunkLength: this.chunkLength,
        segments: CHUNK_SEGMENTS,
        generationId: this.generationId,
        runSeed: 1337
      };
      this.worker.postMessage(msg);
    } else {
      // Synchronous fallback sharing identical generator math (Sec 3.1, 3.2)
      const data = generateChunkData(
        chunkIndex,
        startDist,
        this.chunkLength,
        CHUNK_SEGMENTS,
        1337,
        this.generationId
      );
      this.applyChunkData(data);
    }
  }

  private handleWorkerResponse(event: MessageEvent<GenerateTrackChunkResponse>): void {
    this.applyChunkData(event.data);
  }

  private applyChunkData(data: GenerateTrackChunkResponse): void {
    // 1. Guard against stale responses from prior generations (Sec 2.5 fix: check BEFORE deleting pending request!)
    if (data.generationId !== undefined && data.generationId !== this.generationId) {
      return;
    }

    this.pendingRequests.delete(data.chunkIndex);

    // 2. Guard against chunks no longer in needed range around the player
    const currentChunkIdx = Math.floor(this.currentPlayerDistance / this.chunkLength);
    const minNeededChunk = Math.max(0, currentChunkIdx - CHUNKS_BEHIND);
    const maxNeededChunk = currentChunkIdx + CHUNKS_AHEAD;
    if (data.chunkIndex < minNeededChunk || data.chunkIndex > maxNeededChunk + 1) {
      return;
    }

    // 3. If chunk already exists in activeChunks, recycle old one first to avoid orphaning mesh
    if (this.activeChunks.has(data.chunkIndex)) {
      const existing = this.activeChunks.get(data.chunkIndex)!;
      this.recycleChunk(data.chunkIndex, existing);
    }

    let chunk: TrackChunk;

    if (this.chunkPool.length > 0) {
      chunk = this.chunkPool.pop()!;
      chunk.updateData(data, this.spline);
      chunk.mesh.visible = true;
    } else {
      chunk = new TrackChunk(data, this.sharedMaterial, this.spline);
      this.scene.add(chunk.mesh);
    }

    this.activeChunks.set(data.chunkIndex, chunk);

    // Spawn obstacles for this chunk
    if (this.obstacleManager && data.obstacleAnchors && data.obstacleAnchors.length > 0) {
      this.obstacleManager.spawnChunkObstacles(data.obstacleAnchors, data.chunkIndex);
    }
  }

  private recycleChunk(index: number, chunk: TrackChunk): void {
    chunk.mesh.visible = false;
    this.activeChunks.delete(index);
    this.chunkPool.push(chunk);

    // Recycle obstacles belonging to this chunk
    if (this.obstacleManager) {
      this.obstacleManager.recycleChunkObstacles(index);
    }
  }

  public getActiveCount(): number {
    return this.activeChunks.size;
  }

  public reset(): void {
    this.generationId++;
    this.currentPlayerDistance = 0;
    for (const [, chunk] of this.activeChunks) {
      chunk.mesh.visible = false;
      this.chunkPool.push(chunk);
    }
    this.activeChunks.clear();
    this.pendingRequests.clear();
    this.initTrack(CHUNKS_AHEAD + 1);
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, chunk] of this.activeChunks) {
      this.scene.remove(chunk.mesh);
      chunk.dispose();
    }
    for (const chunk of this.chunkPool) {
      this.scene.remove(chunk.mesh);
      chunk.dispose();
    }
    this.activeChunks.clear();
    this.chunkPool = [];
    this.sharedMaterial.dispose();
    TrackChunk.disposeSharedResources();
  }
}
