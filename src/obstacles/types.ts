import * as THREE from 'three';
import type { LaneType, ObstacleType } from '../track/types';

export interface ObstacleEntity {
  id: number;
  type: ObstacleType;
  mesh: THREE.Group;
  distance: number;
  lane: LaneType;
  lateralOffset: number;
  active: boolean;
  chunkIndex: number;
  collisionRadius: number;
}
