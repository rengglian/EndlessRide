export type LaneType = 'left' | 'center' | 'right';
export type ObstacleType = 'rock' | 'log' | 'hurdle' | 'fence';

export interface ObstacleAnchor {
  distance: number;
  lane: LaneType;
  obstacleType: ObstacleType;
}

export interface GenerateTrackChunkRequest {
  chunkIndex: number;
  startDist: number;
  chunkLength: number;
  segments: number;
  trackWidth?: number;
  generationId?: number;
  runSeed?: number;
}

export interface GenerateTrackChunkResponse {
  chunkIndex: number;
  startDist: number;
  chunkLength: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  obstacleAnchors: ObstacleAnchor[];
  generationId?: number;
}
