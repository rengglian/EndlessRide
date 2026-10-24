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

      this.activeObstacles.push(obstacle);
    }
  }

  /**
   * Removes all obstacles associated with a recycled chunk.
   */
  public recycleChunkObstacles(chunkIndex: number): void {
    const remaining: ObstacleEntity[] = [];

    for (const obs of this.activeObstacles) {
      if (obs.chunkIndex === chunkIndex) {
        this.pool.release(obs);
      } else {
        remaining.push(obs);
      }
    }

    this.activeObstacles = remaining;
  }

  /**
   * Fast, zero-allocation cylinder/sphere collision check between horse and nearby obstacles.
   */
  public checkPlayerCollision(
    playerDist: number,
    playerLateral: number,
    playerRadius = 0.65
  ): boolean {
    for (let i = 0; i < this.activeObstacles.length; i++) {
      const obs = this.activeObstacles[i];

      // Longitudinal distance check (only check obstacles close to player)
      const dDist = Math.abs(obs.distance - playerDist);
      if (dDist > 1.8) {
        continue;
      }

      // Lateral distance check
      const dLat = Math.abs(obs.lateralOffset - playerLateral);
      const combinedRadius = obs.collisionRadius + playerRadius;

      if (dLat < combinedRadius * 0.82 && dDist < 1.2) {
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
