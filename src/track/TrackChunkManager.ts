import * as THREE from 'three';
import { SplineTrack } from './SplineTrack';
import { TrackChunk } from './TrackChunk';
import type { ObstacleManager } from '../obstacles/ObstacleManager';
import type {
  GenerateTrackChunkRequest,
  GenerateTrackChunkResponse,
  ObstacleAnchor,
  LaneType,
  ObstacleType
} from './types';

export class TrackChunkManager {
  private scene: THREE.Scene;
  private spline: SplineTrack;
  private obstacleManager: ObstacleManager | null = null;
  private worker: Worker | null = null;
  private sharedMaterial: THREE.MeshStandardMaterial;

  public readonly chunkLength = 50.0;
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
      color: 0xffffff,
      side: THREE.DoubleSide
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
         varying vec2 vTrackUv;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        
        float uRel = vTrackUv.x;
        float distFromCenter = abs(uRel - 0.5);

        // 1. Procedural Staggered Cobblestone Pavers & Gravel
        vec2 stoneUv = vec2(vTrackUv.x * 32.0, vTrackUv.y * 36.0);
        vec2 tileId = floor(stoneUv);
        if (mod(tileId.y, 2.0) == 1.0) {
          stoneUv.x += 0.5;
          tileId = floor(stoneUv);
        }
        vec2 tileFract = fract(stoneUv);

        // Mortar groove lines between stones
        float edgeDist = min(min(tileFract.x, 1.0 - tileFract.x), min(tileFract.y, 1.0 - tileFract.y));
        float mortarMask = 1.0 - smoothstep(0.04, 0.09, edgeDist);

        // Per-stone random luminance variation
        float stoneHash = fract(sin(tileId.x * 12.9898 + tileId.y * 78.233) * 43758.5453);
        float stoneVar = (stoneHash - 0.5) * 0.12;

        // High-frequency gravel texture speckles
        float gravelNoise = fract(sin(dot(stoneUv * 8.0, vec2(12.9898, 78.233))) * 43758.5453);
        float gravelVar = (gravelNoise - 0.5) * 0.08;

        // Bright, sunny limestone & light paving stone palette
        vec3 lightPaverBase = vec3(0.96, 0.93, 0.88);   // Very light warm sandstone / limestone
        vec3 mortarColor    = vec3(0.74, 0.70, 0.64);   // Clean mortar groove
        vec3 gravelColor    = vec3(0.99, 0.97, 0.92);   // Bright sunlit gravel highlights

        vec3 paverColor = mix(lightPaverBase + stoneVar + gravelVar, gravelColor, 0.25);
        paverColor = mix(paverColor, mortarColor, mortarMask * 0.75);

        // 2. Stone Curb / Border Trim
        vec3 curbColor = vec3(0.82, 0.79, 0.73);

        // 3. Lush Rolling Meadow & Wildflowers
        vec2 meadowUv = vec2(vTrackUv.x * 18.0, vTrackUv.y * 22.0);
        float meadowNoise = sin(meadowUv.x * 0.6 + meadowUv.y * 0.9) * cos(meadowUv.x * 0.8 - meadowUv.y * 0.5);
        vec3 grassBase   = vec3(0.24, 0.58, 0.22); // Vibrant rich green
        vec3 grassSunlit = vec3(0.36, 0.72, 0.26); // Sunlit golden meadow
        vec3 meadowColor = mix(grassBase, grassSunlit, meadowNoise * 0.5 + 0.5);

        // Wildflower spots on meadows
        float flowerHash = fract(sin(dot(floor(meadowUv * 3.0), vec2(37.1, 91.7))) * 5321.4);
        if (flowerHash > 0.93) {
          vec3 flowerColor = flowerHash > 0.965 ? vec3(0.98, 0.90, 0.25) : vec3(0.94, 0.35, 0.35);
          float flowerDist = length(fract(meadowUv * 3.0) - 0.5);
          if (flowerDist < 0.28) {
            meadowColor = mix(meadowColor, flowerColor, 0.85);
          }
        }

        // 4. Multi-Layer Splat Blending
        // 72m total span: Path is +/- 3.8m, so distFromCenter threshold is 3.8 / 36.0 = 0.1055
        float pathMask = 1.0 - smoothstep(0.100, 0.108, distFromCenter);
        float curbMask = smoothstep(0.100, 0.106, distFromCenter) * (1.0 - smoothstep(0.114, 0.122, distFromCenter));

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
  public initTrack(initialChunkCount = 5): void {
    for (let i = 0; i < initialChunkCount; i++) {
      this.requestChunk(i);
    }
  }

  /**
   * Linear chunk streaming: maintain 4 chunks ahead and 1 behind player distance.
   */
  public update(playerDistance: number): void {
    this.currentPlayerDistance = isNaN(playerDistance) ? 0 : Math.max(0, playerDistance);
    const currentChunkIdx = Math.floor(this.currentPlayerDistance / this.chunkLength);

    const minNeededChunk = Math.max(0, currentChunkIdx - 1);
    const maxNeededChunk = currentChunkIdx + 4;

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
        trackWidth: 7.6,
        segments: 40,
        generationId: this.generationId
      };
      this.worker.postMessage(msg);
    } else {
      // Synchronous fallback
      const data = this.generateChunkSync(chunkIndex, startDist, this.chunkLength, 40);
      data.generationId = this.generationId;
      this.applyChunkData(data);
    }
  }

  private generateObstacleAnchorsSync(startDist: number, length: number): ObstacleAnchor[] {
    const anchors: ObstacleAnchor[] = [];
    const spacing = 26.0;
    const lanes: LaneType[] = ['left', 'center', 'right'];
    const types: ObstacleType[] = ['rock', 'log', 'hurdle', 'fence'];

    const startOffset = Math.max(20.0, 40.0 - startDist);

    for (let d = startOffset; d < length - 8.0; d += spacing + ((d * 3) % 7.0)) {
      const worldDist = startDist + d;
      const isSingle = (Math.floor(worldDist / 20) % 3) !== 0;

      if (isSingle) {
        const laneIdx = Math.floor(worldDist * 0.17) % 3;
        const typeIdx = Math.floor(worldDist * 0.31) % types.length;
        anchors.push({
          distance: worldDist,
          lane: lanes[laneIdx],
          obstacleType: types[typeIdx]
        });
      } else {
        const openIdx = Math.floor(worldDist * 0.23) % 3;
        for (let l = 0; l < 3; l++) {
          if (l !== openIdx) {
            const typeIdx = (l + Math.floor(worldDist * 0.11)) % types.length;
            anchors.push({
              distance: worldDist,
              lane: lanes[l],
              obstacleType: types[typeIdx]
            });
          }
        }
      }
    }
    return anchors;
  }

  private generateChunkSync(
    chunkIndex: number,
    startDist: number,
    chunkLength: number,
    segments: number
  ): GenerateTrackChunkResponse {
    const offsets = [-36.0, -18.0, -6.5, -4.0, -3.8, 0.0, 3.8, 4.0, 6.5, 18.0, 36.0];
    const heights = [-0.8,   0.6,   0.25, 0.12,  0.0, 0.0, 0.0, 0.12, 0.25, 0.6, -0.8];
    const crossSectionVerts = offsets.length;
    const totalVerts = (segments + 1) * crossSectionVerts;

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);

    const step = chunkLength / segments;
    let vIdx = 0;

    for (let i = 0; i <= segments; i++) {
      const s = startDist + i * step;
      const x = 14.0 * Math.sin(0.012 * s) + 6.0 * Math.sin(0.028 * s + 1.2);
      const y = 3.5 * Math.sin(0.018 * s);
      const z = s;

      const dx = 14.0 * 0.012 * Math.cos(0.012 * s) + 6.0 * 0.028 * Math.cos(0.028 * s + 1.2);
      const dy = 3.5 * 0.018 * Math.cos(0.018 * s);
      const dz = 1.0;
      const len = Math.hypot(dx, dy, dz) || 1.0;
      const tx = dx / len;
      const ty = dy / len;
      const tz = dz / len;

      // Rightward horizontal lateral normal: Tangent x UP = (-tz, 0, tx)
      const hNx = -tz;
      const hNz = tx;
      const hLen = Math.hypot(hNx, hNz) || 1.0;
      const normX = hNx / hLen;
      const normZ = hNz / hLen;

      // Base upward normal: Lateral x Tangent -> upY = normZ * tx - normX * tz (+1 for straight track)
      const upX = -ty * normZ;
      const upY = normZ * tx - normX * tz;
      const upZ = ty * normX;

      // Banking angle estimation (identical to SplineTrack & track.worker.ts)
      const d2x = -14.0 * 0.012 * 0.012 * Math.sin(0.012 * s) - 6.0 * 0.028 * 0.028 * Math.sin(0.028 * s + 1.2);
      const curvature = Math.abs(d2x);
      const sign = d2x > 0 ? -1 : 1;
      const bank = Math.max(-0.22, Math.min(0.22, sign * (144.0 * curvature) / 9.81 * 2.0));

      const cosB = Math.cos(bank);
      const sinB = Math.sin(bank);

      const latX = normX * cosB + upX * sinB;
      const latY = upY * sinB;
      const latZ = normZ * cosB + upZ * sinB;

      const bankUpX = -normX * sinB + upX * cosB;
      const bankUpY = upY * cosB;
      const bankUpZ = -normZ * sinB + upZ * cosB;

      for (let j = 0; j < crossSectionVerts; j++) {
        const u = offsets[j];
        const h = heights[j];

        positions[vIdx * 3] = x + latX * u + bankUpX * h;
        positions[vIdx * 3 + 1] = y + latY * u + bankUpY * h;
        positions[vIdx * 3 + 2] = z + latZ * u + bankUpZ * h;

        normals[vIdx * 3] = bankUpX;
        normals[vIdx * 3 + 1] = bankUpY;
        normals[vIdx * 3 + 2] = bankUpZ;

        uvs[vIdx * 2] = j / (crossSectionVerts - 1);
        uvs[vIdx * 2 + 1] = (i / segments) * (chunkLength / 12.0);

        vIdx++;
      }
    }

    const numQuads = segments * (crossSectionVerts - 1);
    const indices = new Uint32Array(numQuads * 6);
    let idx = 0;

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < crossSectionVerts - 1; j++) {
        const row1 = i * crossSectionVerts;
        const row2 = (i + 1) * crossSectionVerts;

        const p0 = row1 + j;
        const p1 = row1 + j + 1;
        const p2 = row2 + j + 1;
        const p3 = row2 + j;

        indices[idx++] = p0;
        indices[idx++] = p1;
        indices[idx++] = p2;

        indices[idx++] = p0;
        indices[idx++] = p2;
        indices[idx++] = p3;
      }
    }

    const obstacleAnchors = this.generateObstacleAnchorsSync(startDist, chunkLength);

    return {
      chunkIndex,
      startDist,
      chunkLength,
      positions,
      normals,
      uvs,
      indices,
      obstacleAnchors
    };
  }

  private handleWorkerResponse(event: MessageEvent<GenerateTrackChunkResponse>): void {
    this.applyChunkData(event.data);
  }

  private applyChunkData(data: GenerateTrackChunkResponse): void {
    this.pendingRequests.delete(data.chunkIndex);

    // 1. Guard against stale responses from prior generations (before reset)
    if (data.generationId !== undefined && data.generationId !== this.generationId) {
      return;
    }

    // 2. Guard against chunks no longer in needed range around the player
    const currentChunkIdx = Math.floor(this.currentPlayerDistance / this.chunkLength);
    const minNeededChunk = Math.max(0, currentChunkIdx - 1);
    const maxNeededChunk = currentChunkIdx + 4;
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
    this.initTrack(5);
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
  }
}
