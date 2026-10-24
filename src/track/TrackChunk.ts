import * as THREE from 'three';
import { SplineTrack } from './SplineTrack';
import type { GenerateTrackChunkResponse } from './types';

// Shared materials for roadside scenery
const trunkMat = new THREE.MeshStandardMaterial({
  color: 0x4a2e18,
  roughness: 0.9,
  metalness: 0.05
});

const foliageMat = new THREE.MeshStandardMaterial({
  color: 0x226829, // Lush evergreen / oak
  roughness: 0.8,
  flatShading: true
});

const foliageLightMat = new THREE.MeshStandardMaterial({
  color: 0x388235, // Sunlit meadow green
  roughness: 0.8,
  flatShading: true
});

const bushMat = new THREE.MeshStandardMaterial({
  color: 0x2f7532,
  roughness: 0.85,
  flatShading: true
});

// Shared geometries for scenery (trunks embedded 0.5m into ground to prevent floating)
const trunkGeom = new THREE.CylinderGeometry(0.22, 0.42, 2.6, 5);
const foliageBottomGeom = new THREE.ConeGeometry(1.7, 2.4, 6);
const foliageTopGeom = new THREE.ConeGeometry(1.25, 1.9, 6);
const bushGeom = new THREE.DodecahedronGeometry(0.9, 1);

const _treePos = new THREE.Vector3();
const _treeTangent = new THREE.Vector3();
const _treeNormal = new THREE.Vector3();
const _treeUp = new THREE.Vector3();

export class TrackChunk {
  public chunkIndex: number;
  public startDist: number;
  public chunkLength: number;
  public mesh: THREE.Mesh;
  public geometry: THREE.BufferGeometry;
  public material: THREE.MeshStandardMaterial;

  public sceneryGroup: THREE.Group;
  private readonly sceneryCount = 6;
  private treePool: THREE.Group[] = [];
  private bushPool: THREE.Mesh[] = [];

  constructor(
    data: GenerateTrackChunkResponse,
    sharedMaterial: THREE.MeshStandardMaterial,
    spline?: SplineTrack
  ) {
    this.chunkIndex = data.chunkIndex;
    this.startDist = data.startDist;
    this.chunkLength = data.chunkLength;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    this.material = sharedMaterial;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    this.sceneryGroup = new THREE.Group();
    this.mesh.add(this.sceneryGroup);

    // Pre-allocate fixed pool of scenery objects once to eliminate per-chunk allocations
    this.initSceneryPool();

    if (spline) {
      this.populateScenery(spline);
    }
  }

  private initSceneryPool(): void {
    for (let i = 0; i < this.sceneryCount; i++) {
      // Bush mesh
      const bush = new THREE.Mesh(bushGeom, bushMat);
      bush.castShadow = true;
      bush.receiveShadow = true;
      bush.visible = false;
      this.bushPool.push(bush);
      this.sceneryGroup.add(bush);

      // Tree group
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 1.0;
      trunk.castShadow = true;
      tree.add(trunk);

      const folBottom = new THREE.Mesh(foliageBottomGeom, foliageMat);
      folBottom.position.y = 2.6;
      folBottom.castShadow = true;
      tree.add(folBottom);

      const folTop = new THREE.Mesh(foliageTopGeom, foliageLightMat);
      folTop.position.y = 3.9;
      folTop.castShadow = true;
      tree.add(folTop);

      tree.visible = false;
      this.treePool.push(tree);
      this.sceneryGroup.add(tree);
    }
  }

  public updateData(data: GenerateTrackChunkResponse, spline?: SplineTrack): void {
    this.chunkIndex = data.chunkIndex;
    this.startDist = data.startDist;
    this.chunkLength = data.chunkLength;

    // Update existing BufferAttribute arrays in-place to avoid GC pressure
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const normAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uvAttr = this.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const indexAttr = this.geometry.getIndex();

    if (posAttr && posAttr.array.length === data.positions.length) {
      (posAttr.array as Float32Array).set(data.positions);
      posAttr.needsUpdate = true;
    } else {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    }

    if (normAttr && normAttr.array.length === data.normals.length) {
      (normAttr.array as Float32Array).set(data.normals);
      normAttr.needsUpdate = true;
    } else {
      this.geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    }

    if (uvAttr && uvAttr.array.length === data.uvs.length) {
      (uvAttr.array as Float32Array).set(data.uvs);
      uvAttr.needsUpdate = true;
    } else {
      this.geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    }

    if (indexAttr && indexAttr.array.length === data.indices.length) {
      (indexAttr.array as Uint32Array).set(data.indices);
      indexAttr.needsUpdate = true;
    } else {
      this.geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    }

    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    if (spline) {
      this.populateScenery(spline);
    }
  }

  /**
   * Computes ground surface elevation at lateral offset u.
   */
  private getGroundHeightAtOffset(u: number): number {
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

  private populateScenery(spline: SplineTrack): void {
    for (let i = 0; i < this.sceneryCount; i++) {
      // Deterministic pseudo-random variation per chunk and slot
      const seed = Math.abs(this.chunkIndex * 73856093) ^ (i * 19349663);
      const rand1 = ((seed & 0xffff) / 65535);
      const rand2 = (((seed >> 16) & 0xffff) / 65535);

      const s = this.startDist + (i + 0.15 + rand1 * 0.7) * (this.chunkLength / this.sceneryCount);
      const side = (i + (this.chunkIndex % 2)) % 2 === 0 ? 1 : -1;
      const uOffset = side * (7.0 + rand2 * 11.0); // 7.0m to 18.0m in meadow hills
      const groundH = this.getGroundHeightAtOffset(uOffset);

      // Sample banked frame to sit flush on banked meadow surface
      spline.getBankedTransformAt(s, uOffset, groundH, _treePos, _treeTangent, _treeNormal, _treeUp);

      const bush = this.bushPool[i];
      const tree = this.treePool[i];

      const isBush = (i + this.chunkIndex) % 3 === 0;

      if (isBush) {
        if (tree) tree.visible = false;
        if (bush) {
          bush.visible = true;
          bush.position.copy(_treePos);
          // Embedded slightly into surface along banked up
          bush.position.addScaledVector(_treeUp, 0.32);
          const bScale = 0.95 + rand2 * 0.45;
          bush.scale.set(bScale * 1.2, bScale * 0.85, bScale * 1.2);
        }
      } else {
        if (bush) bush.visible = false;
        if (tree) {
          tree.visible = true;
          tree.position.copy(_treePos);
          const tScale = 0.85 + rand1 * 0.45;
          tree.scale.set(tScale, tScale, tScale);
        }
      }
    }
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}
