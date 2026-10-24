import * as THREE from 'three';
import { SplineTrack } from './SplineTrack';
import { getGroundHeightAtOffset } from './trackMath';
import type { GenerateTrackChunkResponse } from './types';

// Shared materials for roadside scenery (Sec 4.1)
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

// Shared geometries for scenery (trunks embedded into ground to prevent floating)
const trunkGeom = new THREE.CylinderGeometry(0.22, 0.42, 2.6, 5);
const foliageBottomGeom = new THREE.ConeGeometry(1.7, 2.4, 6);
const foliageTopGeom = new THREE.ConeGeometry(1.25, 1.9, 6);
const bushGeom = new THREE.DodecahedronGeometry(0.9, 1);

// Scratch vectors and matrices to eliminate per-frame/chunk GC allocations
const _treePos = new THREE.Vector3();
const _treeTangent = new THREE.Vector3();
const _treeNormal = new THREE.Vector3();
const _treeUp = new THREE.Vector3();
const _partPos = new THREE.Vector3();
const _partScale = new THREE.Vector3();
const _rotQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _instMatrix = new THREE.Matrix4();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export class TrackChunk {
  public chunkIndex: number;
  public startDist: number;
  public chunkLength: number;
  public mesh: THREE.Mesh;
  public geometry: THREE.BufferGeometry;
  public material: THREE.MeshStandardMaterial;

  public sceneryGroup: THREE.Group;
  public readonly sceneryCount = 6;

  // 4 InstancedMeshes per chunk replacing individual mesh groups (Sec 4.1: 4 draw calls instead of 24)
  private trunkInstanced: THREE.InstancedMesh;
  private folBottomInstanced: THREE.InstancedMesh;
  private folTopInstanced: THREE.InstancedMesh;
  private bushInstanced: THREE.InstancedMesh;

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
    this.sceneryGroup.matrixAutoUpdate = false;
    this.mesh.add(this.sceneryGroup);

    // Pre-allocate 4 InstancedMeshes for scenery
    this.trunkInstanced = new THREE.InstancedMesh(trunkGeom, trunkMat, this.sceneryCount);
    this.trunkInstanced.castShadow = true;
    this.trunkInstanced.receiveShadow = false;
    this.trunkInstanced.matrixAutoUpdate = false;

    this.folBottomInstanced = new THREE.InstancedMesh(foliageBottomGeom, foliageMat, this.sceneryCount);
    this.folBottomInstanced.castShadow = true;
    this.folBottomInstanced.receiveShadow = false;
    this.folBottomInstanced.matrixAutoUpdate = false;

    this.folTopInstanced = new THREE.InstancedMesh(foliageTopGeom, foliageLightMat, this.sceneryCount);
    this.folTopInstanced.castShadow = true;
    this.folTopInstanced.receiveShadow = false;
    this.folTopInstanced.matrixAutoUpdate = false;

    this.bushInstanced = new THREE.InstancedMesh(bushGeom, bushMat, this.sceneryCount);
    this.bushInstanced.castShadow = true;
    this.bushInstanced.receiveShadow = true;
    this.bushInstanced.matrixAutoUpdate = false;

    this.sceneryGroup.add(this.trunkInstanced);
    this.sceneryGroup.add(this.folBottomInstanced);
    this.sceneryGroup.add(this.folTopInstanced);
    this.sceneryGroup.add(this.bushInstanced);

    if (spline) {
      this.populateScenery(spline);
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
      (indexAttr.array as Uint16Array).set(data.indices);
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

  private populateScenery(spline: SplineTrack): void {
    for (let i = 0; i < this.sceneryCount; i++) {
      // Deterministic pseudo-random variation per chunk and slot
      const seed = Math.abs(this.chunkIndex * 73856093) ^ (i * 19349663);
      const rand1 = ((seed & 0xffff) / 65535);
      const rand2 = (((seed >> 16) & 0xffff) / 65535);
      const randYaw = (((seed ^ (seed >> 8)) & 0xffff) / 65535) * Math.PI * 2;

      const s = this.startDist + (i + 0.15 + rand1 * 0.7) * (this.chunkLength / this.sceneryCount);
      const side = (i + (this.chunkIndex % 2)) % 2 === 0 ? 1 : -1;
      const uOffset = side * (7.0 + rand2 * 11.0); // 7.0m to 18.0m in meadow hills
      const groundH = getGroundHeightAtOffset(uOffset);

      // Sample banked frame to sit flush on banked meadow surface
      spline.getBankedTransformAt(s, uOffset, groundH, _treePos, _treeTangent, _treeNormal, _treeUp);

      // Align base orientation with terrain banked up, plus random Y-rotation for visual variety (Sec 6.4)
      _rotQuat.setFromUnitVectors(_upAxis, _treeUp);
      _yawQuat.setFromAxisAngle(_treeUp, randYaw);
      _rotQuat.premultiply(_yawQuat);

      const isBush = (i + this.chunkIndex) % 3 === 0;

      if (isBush) {
        // Bush slot: collapse tree instance matrices to zero scale
        this.trunkInstanced.setMatrixAt(i, _zeroMatrix);
        this.folBottomInstanced.setMatrixAt(i, _zeroMatrix);
        this.folTopInstanced.setMatrixAt(i, _zeroMatrix);

        // Position bush embedded slightly into surface
        const bScale = 0.95 + rand2 * 0.45;
        _partPos.copy(_treePos).addScaledVector(_treeUp, 0.32);
        _partScale.set(bScale * 1.2, bScale * 0.85, bScale * 1.2);
        _instMatrix.compose(_partPos, _rotQuat, _partScale);
        this.bushInstanced.setMatrixAt(i, _instMatrix);
      } else {
        // Tree slot: collapse bush instance matrix to zero scale
        this.bushInstanced.setMatrixAt(i, _zeroMatrix);

        const tScale = 0.85 + rand1 * 0.45;
        _partScale.set(tScale, tScale, tScale);

        // Trunk
        _partPos.copy(_treePos).addScaledVector(_treeUp, 1.0 * tScale);
        _instMatrix.compose(_partPos, _rotQuat, _partScale);
        this.trunkInstanced.setMatrixAt(i, _instMatrix);

        // Foliage lower tier
        _partPos.copy(_treePos).addScaledVector(_treeUp, 2.6 * tScale);
        _instMatrix.compose(_partPos, _rotQuat, _partScale);
        this.folBottomInstanced.setMatrixAt(i, _instMatrix);

        // Foliage upper tier
        _partPos.copy(_treePos).addScaledVector(_treeUp, 3.9 * tScale);
        _instMatrix.compose(_partPos, _rotQuat, _partScale);
        this.folTopInstanced.setMatrixAt(i, _instMatrix);
      }
    }

    // Flag instance matrices for GPU upload and update bounding spheres for frustum culling
    this.trunkInstanced.instanceMatrix.needsUpdate = true;
    this.folBottomInstanced.instanceMatrix.needsUpdate = true;
    this.folTopInstanced.instanceMatrix.needsUpdate = true;
    this.bushInstanced.instanceMatrix.needsUpdate = true;

    this.trunkInstanced.computeBoundingSphere();
    this.folBottomInstanced.computeBoundingSphere();
    this.folTopInstanced.computeBoundingSphere();
    this.bushInstanced.computeBoundingSphere();
  }

  public static disposeSharedResources(): void {
    trunkGeom.dispose();
    foliageBottomGeom.dispose();
    foliageTopGeom.dispose();
    bushGeom.dispose();

    trunkMat.dispose();
    foliageMat.dispose();
    foliageLightMat.dispose();
    bushMat.dispose();
  }

  public dispose(): void {
    this.geometry.dispose();
    this.trunkInstanced.dispose();
    this.folBottomInstanced.dispose();
    this.folTopInstanced.dispose();
    this.bushInstanced.dispose();
  }
}
