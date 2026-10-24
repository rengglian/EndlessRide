import * as THREE from 'three';
import { SplineTrack } from '../track/SplineTrack';
import { ObstaclePool } from './ObstaclePool';
import type { ObstacleAnchor } from '../track/types';
import type { ObstacleEntity } from './types';

const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _fwdZ = new THREE.Vector3(0, 0, 1);
const _trackQuat = new THREE.Quaternion();
const _bankQuat = new THREE.Quaternion();

export class ObstacleManager {
  private spline: SplineTrack;
  private pool: ObstaclePool;
  private activeObstacles: ObstacleEntity[] = [];

  constructor(scene: THREE.Scene, spline: SplineTrack) {
    this.spline = spline;
    this.pool = new ObstaclePool(scene, 16);
  }

  /**
   * Spawns obstacles for a newly ready track chunk.
   */
  public spawnChunkObstacles(anchors: ObstacleAnchor[], chunkIndex: number): void {
    // Avoid double spawning for the same chunk
    this.recycleChunkObstacles(chunkIndex);

    for (const anchor of anchors) {
      const obstacle = this.pool.acquire(anchor.obstacleType);
      obstacle.distance = anchor.distance;
      obstacle.lane = anchor.lane;
      obstacle.chunkIndex = chunkIndex;
      obstacle.lateralOffset = SplineTrack.LANE_OFFSETS[anchor.lane];

      // Calculate position on curved track
      this.spline.getTransformAt(
        obstacle.distance,
        obstacle.lateralOffset,
        _pos,
        _tangent,
        _normal
      );

      obstacle.mesh.position.copy(_pos);

      // Align obstacle with track tangent direction and track banking
      _trackQuat.setFromUnitVectors(_fwdZ, _tangent);
      const bank = this.spline.getBankingAngleAtDistance(obstacle.distance);
      _bankQuat.setFromAxisAngle(_tangent, bank);
      obstacle.mesh.quaternion.copy(_trackQuat);
      obstacle.mesh.quaternion.premultiply(_bankQuat);

      // Static obstacle matrix freeze (Sec 4.4)
      obstacle.mesh.matrixAutoUpdate = false;
      obstacle.mesh.updateMatrix();
      obstacle.mesh.updateMatrixWorld(true);

      this.activeObstacles.push(obstacle);
    }
  }

  /**
   * Removes all obstacles associated with a recycled chunk using in-place swap-remove (Sec 4.3).
   */
  public recycleChunkObstacles(chunkIndex: number): void {
    for (let i = this.activeObstacles.length - 1; i >= 0; i--) {
      const obs = this.activeObstacles[i];
      if (obs.chunkIndex === chunkIndex) {
        this.pool.release(obs);
        const last = this.activeObstacles.pop()!;
        if (i < this.activeObstacles.length) {
          this.activeObstacles[i] = last;
        }
      }
    }
  }

  /**
   * Swept AABB collision check in (s, u) longitudinal/lateral space (Sec 3.7).
   * Supports swept interval [prevDist, currDist] as well as backward-compatible 2-arg (currDist, lateral).
   */
  public checkPlayerCollision(
    prevPlayerDist: number,
    currPlayerDist: number,
    playerLateral: number,
    playerHalfWidth?: number,
    playerHalfLength?: number
  ): boolean;
  public checkPlayerCollision(
    playerDist: number,
    playerLateral: number,
    playerRadius?: number
  ): boolean;
  public checkPlayerCollision(
    arg1: number,
    arg2: number,
    arg3?: number,
    arg4 = 0.42,
    arg5 = 0.85
  ): boolean {
    let prevDist: number;
    let currDist: number;
    let lateral: number;
    let halfWidth = arg4;
    let halfLength = arg5;

    if (arg3 === undefined) {
      // 2-arg call: (currPlayerDist, playerLateral)
      prevDist = arg1;
      currDist = arg1;
      lateral = arg2;
    } else if (typeof arg3 === 'number') {
      // Check if 3-arg call is legacy (dist, lateral, radius) or swept (prev, curr, lateral)
      if (Math.abs(arg2) <= 4.0 && Math.abs(arg1) > 4.0 && arg3 <= 1.5) {
        // Legacy: (playerDist, playerLateral, playerRadius)
        prevDist = arg1;
        currDist = arg1;
        lateral = arg2;
        halfWidth = arg3 * 0.65;
        halfLength = arg3;
      } else {
        // Swept: (prevPlayerDist, currPlayerDist, playerLateral)
        prevDist = arg1;
        currDist = arg2;
        lateral = arg3;
      }
    } else {
      prevDist = arg1;
      currDist = arg1;
      lateral = arg2;
    }

    const minPlayerS = Math.min(prevDist, currDist) - halfLength;
    const maxPlayerS = Math.max(prevDist, currDist) + halfLength;

    for (let i = 0; i < this.activeObstacles.length; i++) {
      const obs = this.activeObstacles[i];
      const obsMinS = obs.distance - obs.halfLength;
      const obsMaxS = obs.distance + obs.halfLength;

      // Longitudinal swept interval overlap
      if (maxPlayerS < obsMinS || minPlayerS > obsMaxS) {
        continue;
      }

      // Lateral extent overlap
      const dLat = Math.abs(lateral - obs.lateralOffset);
      if (dLat < (obs.halfWidth + halfWidth)) {
        return true;
      }
    }

    return false;
  }

  public getActiveCount(): number {
    return this.activeObstacles.length;
  }

  public reset(): void {
    for (const obs of this.activeObstacles) {
      this.pool.release(obs);
    }
    this.activeObstacles = [];
  }

  public dispose(): void {
    this.reset();
    this.pool.dispose();
  }
}
