/**
 * Pure, Three.js-free track spline mathematics, terrain profiles, and chunk geometry generation.
 * Shared across the main thread (SplineTrack, TrackChunkManager) and Web Workers.
 */

import {
  CHUNK_LENGTH,
  CHUNK_SEGMENTS,
  GEOMETRIC_BANK_SPEED,
  UV_DISTANCE_PERIOD
} from '../config';
import type {
  GenerateTrackChunkResponse,
  ObstacleAnchor,
  LaneType,
  ObstacleType
} from './types';

/**
 * 72m wide cross-section offsets from centerline in metres.
 * [-36m (left meadow), -3.8m (curb edge), 0.0m (path center), +3.8m (curb edge), +36m (right meadow)]
 */
export const CROSS_SECTION_OFFSETS = [
  -36.0, -18.0, -6.5, -4.0, -3.8, 0.0, 3.8, 4.0, 6.5, 18.0, 36.0
] as const;

/**
 * Height offsets corresponding to CROSS_SECTION_OFFSETS in metres.
 */
export const CROSS_SECTION_HEIGHTS = [
  -0.8, 0.6, 0.25, 0.12, 0.0, 0.0, 0.0, 0.12, 0.25, 0.6, -0.8
] as const;

export interface SplineVec3 {
  x: number;
  y: number;
  z: number;
}

export interface BankedFrame {
  point: SplineVec3;
  tangent: SplineVec3;
  lateral: SplineVec3;
  up: SplineVec3;
  bankAngle: number;
}

/**
 * Sample the central spline 3D position at forward parameter s.
 */
export function sampleSplinePoint(s: number): SplineVec3 {
  const validS = isNaN(s) ? 0 : s;
  const x = 14.0 * Math.sin(0.012 * validS) + 6.0 * Math.sin(0.028 * validS + 1.2);
  const y = 3.5 * Math.sin(0.018 * validS);
  const z = validS;
  return { x, y, z };
}

/**
 * First derivative dP/ds of the spline.
 */
export function sampleSplineDerivative(s: number): { dx: number; dy: number; dz: number } {
  const validS = isNaN(s) ? 0 : s;
  const dx = 14.0 * 0.012 * Math.cos(0.012 * validS) + 6.0 * 0.028 * Math.cos(0.028 * validS + 1.2);
  const dy = 3.5 * 0.018 * Math.cos(0.018 * validS);
  const dz = 1.0;
  return { dx, dy, dz };
}

/**
 * Arc-length scaling factor |dP/ds| = sqrt(dx^2 + dy^2 + dz^2).
 * True ground speed ds/dt = speed / sampleArcLengthFactor(s) (Sec 3.4).
 */
export function sampleArcLengthFactor(s: number): number {
  const { dx, dy } = sampleSplineDerivative(s);
  return Math.hypot(dx, dy, 1.0);
}

/**
 * Sample the forward unit tangent vector at parameter s.
 */
export function sampleSplineTangent(s: number): SplineVec3 {
  const { dx, dy, dz } = sampleSplineDerivative(s);
  const len = Math.hypot(dx, dy, dz) || 1.0;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/**
 * Compute the track's intrinsic geometric bank roll angle in radians at parameter s.
 * Speed-independent property of the fixed track geometry (Sec 3.3).
 */
export function computeGeometricBankAngle(s: number): number {
  const validS = isNaN(s) ? 0 : s;
  const d2x = -14.0 * 0.012 * 0.012 * Math.sin(0.012 * validS) - 6.0 * 0.028 * 0.028 * Math.sin(0.028 * validS + 1.2);
  const curvature = Math.abs(d2x);
  const sign = d2x > 0 ? -1 : 1;
  const g = 9.81;
  const rawBank = (GEOMETRIC_BANK_SPEED * GEOMETRIC_BANK_SPEED * curvature) / g;
  return Math.max(-0.22, Math.min(0.22, sign * rawBank * 2.0));
}

/**
 * Compute speed-dependent visual lean angle in radians for visual rig/HUD (Sec 3.3).
 */
export function computeVisualBankAngle(s: number, speed: number): number {
  const validS = isNaN(s) ? 0 : s;
  const validSpeed = isNaN(speed) ? GEOMETRIC_BANK_SPEED : speed;
  const d2x = -14.0 * 0.012 * 0.012 * Math.sin(0.012 * validS) - 6.0 * 0.028 * 0.028 * Math.sin(0.028 * validS + 1.2);
  const curvature = Math.abs(d2x);
  const sign = d2x > 0 ? -1 : 1;
  const g = 9.81;
  const rawBank = (validSpeed * validSpeed * curvature) / g;
  return Math.max(-0.22, Math.min(0.22, sign * rawBank * 2.0));
}

/**
 * Computes the complete banked coordinate frame (point, tangent, lateral, up, bankAngle) at parameter s.
 */
export function computeBankedFrame(s: number, speed: number = GEOMETRIC_BANK_SPEED): BankedFrame {
  const point = sampleSplinePoint(s);
  const tangent = sampleSplineTangent(s);

  // Unbanked rightward horizontal lateral normal: Tangent x UP = (-tangent.z, 0, tangent.x)
  const hNx = -tangent.z;
  const hNz = tangent.x;
  const hLen = Math.hypot(hNx, hNz) || 1.0;
  const normX = hNx / hLen;
  const normZ = hNz / hLen;

  // Base upward normal: Lateral x Tangent -> upY = normZ * tangent.x - normX * tangent.z (+1)
  const upX = -tangent.y * normZ;
  const upY = normZ * tangent.x - normX * tangent.z;
  const upZ = tangent.y * normX;

  const bankAngle = speed === GEOMETRIC_BANK_SPEED
    ? computeGeometricBankAngle(s)
    : computeVisualBankAngle(s, speed);

  const cosB = Math.cos(bankAngle);
  const sinB = Math.sin(bankAngle);

  // Bank lateral and up vectors around tangent (positive bank lowers right edge +u)
  const lateral: SplineVec3 = {
    x: normX * cosB + upX * sinB,
    y: upY * sinB,
    z: normZ * cosB + upZ * sinB
  };

  const up: SplineVec3 = {
    x: -normX * sinB + upX * cosB,
    y: upY * cosB,
    z: -normZ * sinB + upZ * cosB
  };

  return { point, tangent, lateral, up, bankAngle };
}

/**
 * Computes terrain surface elevation h(u) at lateral offset u in metres.
 */
export function getGroundHeightAtOffset(u: number): number {
  const absU = Math.abs(u);
  if (absU <= 3.8) {
    return 0.0;
  } else if (absU <= 4.0) {
    return 0.12 * ((absU - 3.8) / 0.2);
  } else if (absU <= 6.5) {
    return 0.12 + 0.13 * ((absU - 4.0) / 2.5);
  } else if (absU <= 18.0) {
    return 0.25 + 0.35 * ((absU - 6.5) / 11.5);
  } else if (absU <= 36.0) {
    return 0.60 - 1.40 * ((absU - 18.0) / 18.0);
  }
  return -0.8;
}

/**
 * Computes cross-section slope dh/du at lateral offset u in metres.
 * Used to tilt vertex surface normals for accurate lighting (Sec 3.6).
 */
export function getGroundSlopeAtOffset(u: number): number {
  const absU = Math.abs(u);
  const sign = u < 0 ? -1 : (u > 0 ? 1 : 0);

  if (absU < 3.8) {
    return 0.0;
  } else if (absU === 3.8) {
    return sign * 0.3; // Average of flat path (0.0) and curb step (0.6)
  } else if (absU < 4.0) {
    return sign * 0.6; // 0.12 / 0.2 = 0.6 (31 degree slope)
  } else if (absU === 4.0) {
    return sign * 0.326; // Average of curb step (0.6) and inner meadow (0.052)
  } else if (absU < 6.5) {
    return sign * (0.13 / 2.5); // 0.052
  } else if (absU === 6.5) {
    return sign * 0.0412; // Average of inner meadow (0.052) and hill slope (0.030435)
  } else if (absU < 18.0) {
    return sign * (0.35 / 11.5); // ~0.030435
  } else if (absU === 18.0) {
    return sign * -0.02367; // Average of hill rise (0.030435) and outer ditch drop (-0.077778)
  } else if (absU < 36.0) {
    return sign * (-1.40 / 18.0); // -0.077778
  } else if (absU === 36.0) {
    return sign * -0.03889; // Average of outer ditch drop (-0.077778) and boundary flat (0.0)
  }
  return 0.0;
}

/**
 * 32-bit seeded pseudo-random number generator (Mulberry32).
 * Returns values in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded obstacle generation with distance-based difficulty progression (Sec 3.2 & 6.1).
 */
export function generateObstacleAnchors(
  startDist: number,
  chunkLength: number,
  chunkIndex: number,
  runSeed: number = 1337
): ObstacleAnchor[] {
  const anchors: ObstacleAnchor[] = [];
  const lanes: LaneType[] = ['left', 'center', 'right'];
  const types: ObstacleType[] = ['rock', 'log', 'hurdle', 'fence'];

  // Seed mulberry32 deterministically with (runSeed ^ (chunkIndex * 2654435761)) >>> 0
  const seed = (runSeed ^ Math.imul(chunkIndex, 2654435761)) >>> 0;
  const rng = mulberry32(seed);

  // Difficulty scaling factor based on distance reached (0.0 at start, 1.0 around 2500m)
  const progress = Math.min(1.0, Math.max(0.0, startDist / 2500.0));

  // Wave spacing scales from 26m down toward 17m
  const baseSpacing = 26.0 - 9.0 * progress;

  // Double obstacle probability scales from 0.35 up toward 0.68
  const doubleProb = 0.35 + 0.33 * progress;

  // Skip obstacles on first 40 meters
  const startOffset = Math.max(20.0, 40.0 - startDist);

  let d = startOffset;
  while (d < chunkLength - 8.0) {
    const worldDist = startDist + d;
    const isDouble = rng() < doubleProb;

    if (!isDouble) {
      // Single obstacle in a random lane
      const laneIdx = Math.floor(rng() * 3);
      const typeIdx = Math.floor(rng() * types.length);
      anchors.push({
        distance: worldDist,
        lane: lanes[laneIdx],
        obstacleType: types[typeIdx]
      });
    } else {
      // Double obstacle (always guarantee at least 1 open lane!)
      const openLaneIndex = Math.floor(rng() * 3);
      for (let l = 0; l < 3; l++) {
        if (l !== openLaneIndex) {
          const typeIdx = Math.floor(rng() * types.length);
          anchors.push({
            distance: worldDist,
            lane: lanes[l],
            obstacleType: types[typeIdx]
          });
        }
      }
    }

    d += baseSpacing + rng() * 6.0;
  }

  return anchors;
}

/**
 * Single shared track chunk data generator used by BOTH track.worker.ts and
 * TrackChunkManager synchronous fallback (Sec 3.1, 3.2).
 */
export function generateChunkData(
  chunkIndex: number,
  startDist: number,
  chunkLength: number = CHUNK_LENGTH,
  segments: number = CHUNK_SEGMENTS,
  runSeed: number = 1337,
  generationId?: number
): GenerateTrackChunkResponse {
  const crossSectionVerts = CROSS_SECTION_OFFSETS.length;
  const totalVerts = (segments + 1) * crossSectionVerts;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  const step = chunkLength / segments;
  let vIdx = 0;

  for (let i = 0; i <= segments; i++) {
    const s = startDist + i * step;
    const { point, lateral, up } = computeBankedFrame(s, GEOMETRIC_BANK_SPEED);
    const modS = ((s % UV_DISTANCE_PERIOD) + UV_DISTANCE_PERIOD) % UV_DISTANCE_PERIOD;

    for (let j = 0; j < crossSectionVerts; j++) {
      const u = CROSS_SECTION_OFFSETS[j];
      const h = CROSS_SECTION_HEIGHTS[j];
      const slope = getGroundSlopeAtOffset(u);

      // Vertex position
      positions[vIdx * 3] = point.x + lateral.x * u + up.x * h;
      positions[vIdx * 3 + 1] = point.y + lateral.y * u + up.y * h;
      positions[vIdx * 3 + 2] = point.z + lateral.z * u + up.z * h;

      // Cross-section slope normal: tilt bankedUp with -slope * bankedLateral and normalize (Sec 3.6)
      const nx = up.x - slope * lateral.x;
      const ny = up.y - slope * lateral.y;
      const nz = up.z - slope * lateral.z;
      const nLen = Math.hypot(nx, ny, nz) || 1.0;
      normals[vIdx * 3] = nx / nLen;
      normals[vIdx * 3 + 1] = ny / nLen;
      normals[vIdx * 3 + 2] = nz / nLen;

      // Metre-based UVs: u is lateral metres, modS is world metres mod 1200 (Sec 3.5)
      uvs[vIdx * 2] = u;
      uvs[vIdx * 2 + 1] = modS;

      vIdx++;
    }
  }

  // Indices: Uint16Array for 451 vertices < 65535 (Sec 4.5)
  const numQuads = segments * (crossSectionVerts - 1);
  const indices = new Uint16Array(numQuads * 6);
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

  const obstacleAnchors = generateObstacleAnchors(startDist, chunkLength, chunkIndex, runSeed);

  return {
    chunkIndex,
    startDist,
    chunkLength,
    positions,
    normals,
    uvs,
    indices,
    obstacleAnchors,
    generationId
  };
}
