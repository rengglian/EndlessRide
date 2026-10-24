/// <reference lib="webworker" />

import type { GenerateTrackChunkRequest } from '../types';
import { generateChunkData } from '../trackMath';

self.onmessage = (event: MessageEvent<GenerateTrackChunkRequest>) => {
  const { chunkIndex, startDist, chunkLength, segments, generationId, runSeed } = event.data;

  const response = generateChunkData(
    chunkIndex,
    startDist,
    chunkLength,
    segments,
    runSeed ?? 1337,
    generationId
  );

  // Zero-copy transfer of typed array buffers to the main thread
  self.postMessage(response, [
    response.positions.buffer,
    response.normals.buffer,
    response.uvs.buffer,
    response.indices.buffer
  ]);
};
