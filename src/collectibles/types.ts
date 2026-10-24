import * as THREE from 'three';
import type { CollectibleType, LaneType } from '../track/types';

export interface CollectibleEntity {
  id: number;
  type: CollectibleType;
  mesh: THREE.Group;
  visualGroup: THREE.Group;
  distance: number;
  lane: LaneType;
  lateralOffset: number;
  active: boolean;
  chunkIndex: number;
  phase: number;
}
