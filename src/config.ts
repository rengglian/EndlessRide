/**
 * Centralized Game Configuration & Tuning Constants
 * Endless Ride runner mechanics, track dimensions, and streaming rules.
 */

export const BASE_SPEED = 18.0;
export const MAX_SPEED = 30.0;
export const STEER_MAX_SPEED = 12.0;
export const MAX_LATERAL_OFFSET = 3.5;

export const CHUNK_LENGTH = 50.0;
export const CHUNK_SEGMENTS = 40;
export const PATH_HALF_WIDTH = 3.8;
export const CHUNKS_AHEAD = 4;
export const CHUNKS_BEHIND = 1;

/** Fixed speed used for closed-form track geometry banking */
export const GEOMETRIC_BANK_SPEED = 12.0;

/** Lateral offsets in metres for the three runner lanes */
export const LANE_OFFSETS = {
  left: -2.3,
  center: 0.0,
  right: 2.3
} as const;

export const UV_DISTANCE_PERIOD = 1200.0;
