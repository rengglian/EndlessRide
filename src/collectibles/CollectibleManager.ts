import * as THREE from 'three';
import { SplineTrack } from '../track/SplineTrack';
import { CollectiblePool } from './CollectiblePool';
import type { CollectibleAnchor, CollectibleType } from '../track/types';
import type { CollectibleEntity } from './types';

const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _fwdZ = new THREE.Vector3(0, 0, 1);
const _trackQuat = new THREE.Quaternion();
const _bankQuat = new THREE.Quaternion();

export class CollectibleManager {
  private spline: SplineTrack;
  private pool: CollectiblePool;
  private activeCollectibles: CollectibleEntity[] = [];
  private elapsedTime = 0;

  constructor(scene: THREE.Scene, spline: SplineTrack) {
    this.spline = spline;
    this.pool = new CollectiblePool(scene, 16);
  }

  /**
   * Spawns collectibles for a newly generated track chunk.
   */
  public spawnChunkCollectibles(anchors: CollectibleAnchor[], chunkIndex: number): void {
    this.recycleChunkCollectibles(chunkIndex);

    for (const anchor of anchors) {
      const c = this.pool.acquire(anchor.collectibleType);
      c.distance = anchor.distance;
      c.lane = anchor.lane;
      c.chunkIndex = chunkIndex;
      c.lateralOffset = SplineTrack.LANE_OFFSETS[anchor.lane];
      c.phase = (anchor.distance * 0.37) % (Math.PI * 2);

      // Compute position and orientation along the banked track spline
      this.spline.getTransformAt(
        c.distance,
        c.lateralOffset,
        _pos,
        _tangent,
        _normal
      );

      c.mesh.position.copy(_pos);

      _trackQuat.setFromUnitVectors(_fwdZ, _tangent);
      const bank = this.spline.getBankingAngleAtDistance(c.distance);
      _bankQuat.setFromAxisAngle(_tangent, bank);
      c.mesh.quaternion.copy(_trackQuat);
      c.mesh.quaternion.premultiply(_bankQuat);

      c.mesh.matrixAutoUpdate = false;
      c.mesh.updateMatrix();
      c.mesh.updateMatrixWorld(true);

      // Reset animation offsets for inner visual group
      c.visualGroup.position.y = 0;
      c.visualGroup.rotation.y = c.phase;
      c.visualGroup.updateMatrix();

      this.activeCollectibles.push(c);
    }
  }

  /**
   * Recycles collectibles belonging to a chunk using in-place swap-remove without allocating arrays.
   */
  public recycleChunkCollectibles(chunkIndex: number): void {
    for (let i = this.activeCollectibles.length - 1; i >= 0; i--) {
      const c = this.activeCollectibles[i];
      if (c.chunkIndex === chunkIndex) {
        this.pool.release(c);
        const last = this.activeCollectibles.pop()!;
        if (i < this.activeCollectibles.length) {
          this.activeCollectibles[i] = last;
        }
      }
    }
  }

  /**
   * Updates floating bob and spin animations for active collectibles with zero allocations.
   */
  public update(dt: number): void {
    this.elapsedTime += dt;

    for (let i = 0; i < this.activeCollectibles.length; i++) {
      const c = this.activeCollectibles[i];
      c.visualGroup.rotation.y += dt * 2.6;
      c.visualGroup.position.y = Math.sin(this.elapsedTime * 3.8 + c.phase) * 0.12;
    }
  }

  /**
   * Swept collection check against horse longitudinal and lateral extents.
   * Collected items are immediately released and swap-removed in place.
   */
  public checkPlayerCollection(
    prevPlayerDist: number,
    currPlayerDist: number,
    playerLateral: number,
    onCollect?: (type: CollectibleType, entity: CollectibleEntity) => void
  ): number {
    const minS = Math.min(prevPlayerDist, currPlayerDist) - 0.9;
    const maxS = Math.max(prevPlayerDist, currPlayerDist) + 0.9;
    let collectedCount = 0;

    for (let i = this.activeCollectibles.length - 1; i >= 0; i--) {
      const c = this.activeCollectibles[i];

      // Longitudinal swept test
      if (c.distance < minS || c.distance > maxS) {
        continue;
      }

      // Lateral tolerance test
      if (Math.abs(playerLateral - c.lateralOffset) < 1.15) {
        collectedCount++;
        onCollect?.(c.type, c);

        this.pool.release(c);
        const last = this.activeCollectibles.pop()!;
        if (i < this.activeCollectibles.length) {
          this.activeCollectibles[i] = last;
        }
      }
    }

    return collectedCount;
  }

  public getActiveCount(): number {
    return this.activeCollectibles.length;
  }

  public reset(): void {
    for (const c of this.activeCollectibles) {
      this.pool.release(c);
    }
    this.activeCollectibles = [];
    this.elapsedTime = 0;
  }

  public dispose(): void {
    this.reset();
    this.pool.dispose();
  }
}
