import type {
  GenerateTrackChunkRequest,
  GenerateTrackChunkResponse,
  ObstacleAnchor,
  LaneType,
  ObstacleType
} from '../types';

function sampleSplinePoint(s: number): { x: number; y: number; z: number } {
  const x = 14.0 * Math.sin(0.012 * s) + 6.0 * Math.sin(0.028 * s + 1.2);
  const y = 3.5 * Math.sin(0.018 * s);
  const z = s;
  return { x, y, z };
}

function sampleSplineTangent(s: number): { x: number; y: number; z: number } {
  const dx = 14.0 * 0.012 * Math.cos(0.012 * s) + 6.0 * 0.028 * Math.cos(0.028 * s + 1.2);
  const dy = 3.5 * 0.018 * Math.cos(0.018 * s);
  const dz = 1.0;
  const len = Math.hypot(dx, dy, dz) || 1.0;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function computeBankedFrames(s: number) {
  const tangent = sampleSplineTangent(s);
  
  // Rightward horizontal lateral normal: Tangent x UP = (-tangent.z, 0, tangent.x)
  const hNx = -tangent.z;
  const hNz = tangent.x;
  const hLen = Math.hypot(hNx, hNz) || 1.0;
  const normX = hNx / hLen;
  const normZ = hNz / hLen;

  // Base upward normal: Lateral x Tangent -> upY = normZ * tangent.x - normX * tangent.z (+1)
  const upX = -tangent.y * normZ;
  const upY = normZ * tangent.x - normX * tangent.z;
  const upZ = tangent.y * normX;

  // Banking angle estimation
  const d2x = -14.0 * 0.012 * 0.012 * Math.sin(0.012 * s) - 6.0 * 0.028 * 0.028 * Math.sin(0.028 * s + 1.2);
  const curvature = Math.abs(d2x);
  const sign = d2x > 0 ? -1 : 1;
  const bank = Math.max(-0.22, Math.min(0.22, sign * (144.0 * curvature) / 9.81 * 2.0));

  const cosB = Math.cos(bank);
  const sinB = Math.sin(bank);

  // Bank lateral and up vectors around tangent (positive bank lowers right edge +u)
  const bankedLateral = {
    x: normX * cosB + upX * sinB,
    y: upY * sinB,
    z: normZ * cosB + upZ * sinB
  };

  const bankedUp = {
    x: -normX * sinB + upX * cosB,
    y: upY * cosB,
    z: -normZ * sinB + upZ * cosB
  };

  return { tangent, lateral: bankedLateral, up: bankedUp };
}

function generateObstacleAnchors(startDist: number, length: number): ObstacleAnchor[] {
  const anchors: ObstacleAnchor[] = [];
  const spacing = 26.0; // Distance between obstacle waves
  const lanes: LaneType[] = ['left', 'center', 'right'];
  const types: ObstacleType[] = ['rock', 'log', 'hurdle', 'fence'];

  // Skip obstacles on first 40 meters
  const startOffset = Math.max(20.0, 40.0 - startDist);

  for (let d = startOffset; d < length - 8.0; d += spacing + (Math.random() * 8.0)) {
    const worldDist = startDist + d;
    const rand = Math.random();

    if (rand < 0.6) {
      // Single obstacle in a random lane
      const chosenLane = lanes[Math.floor(Math.random() * 3)];
      const chosenType = types[Math.floor(Math.random() * types.length)];
      anchors.push({
        distance: worldDist,
        lane: chosenLane,
        obstacleType: chosenType
      });
    } else {
      // Double obstacle (1 lane open)
      const openLaneIndex = Math.floor(Math.random() * 3);
      for (let l = 0; l < 3; l++) {
        if (l !== openLaneIndex) {
          const chosenType = types[Math.floor(Math.random() * types.length)];
          anchors.push({
            distance: worldDist,
            lane: lanes[l],
            obstacleType: chosenType
          });
        }
      }
    }
  }

  return anchors;
}

self.onmessage = (event: MessageEvent<GenerateTrackChunkRequest>) => {
  const { chunkIndex, startDist, chunkLength, segments, generationId } = event.data;

  // Broad 72m wide countryside cross section: flat path, curbs, and rolling meadow slopes
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
    const center = sampleSplinePoint(s);
    const { lateral, up } = computeBankedFrames(s);

    for (let j = 0; j < crossSectionVerts; j++) {
      const u = offsets[j];
      const h = heights[j];

      // Vertex position
      positions[vIdx * 3] = center.x + lateral.x * u + up.x * h;
      positions[vIdx * 3 + 1] = center.y + lateral.y * u + up.y * h;
      positions[vIdx * 3 + 2] = center.z + lateral.z * u + up.z * h;

      // Upward normals
      normals[vIdx * 3] = up.x;
      normals[vIdx * 3 + 1] = up.y;
      normals[vIdx * 3 + 2] = up.z;

      uvs[vIdx * 2] = j / (crossSectionVerts - 1);
      uvs[vIdx * 2 + 1] = (i / segments) * (chunkLength / 12.0);

      vIdx++;
    }
  }

  // Indices: with offsets[-36 (left) -> +36 (right)] along rightward normal (-X) and s along forward (+Z),
  // (p1 - p0) is +lateral, (p3 - p0) is +tangent. (+lateral) x (+tangent) = (-X) x (+Z) = +Y (Upward).
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

  const obstacleAnchors = generateObstacleAnchors(startDist, chunkLength);

  const response: GenerateTrackChunkResponse = {
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

  // Transfer array buffers to main thread with zero copy overhead
  (self as any).postMessage(response, [
    positions.buffer,
    normals.buffer,
    uvs.buffer,
    indices.buffer
  ]);
};
