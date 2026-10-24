import * as THREE from 'three';
import type { CollectibleType } from '../track/types';
import type { CollectibleEntity } from './types';

export class CollectiblePool {
  private scene: THREE.Scene;
  private pool: Map<CollectibleType, CollectibleEntity[]> = new Map();
  private nextId = 0;

  // Shared reusable materials
  private appleMat: THREE.MeshStandardMaterial;
  private stemMat: THREE.MeshStandardMaterial;
  private leafMat: THREE.MeshStandardMaterial;
  private horseshoeMat: THREE.MeshStandardMaterial;

  // Shared reusable geometries allocated once across all pooled collectibles
  private appleGeom: THREE.BufferGeometry;
  private stemGeom: THREE.BufferGeometry;
  private leafGeom: THREE.BufferGeometry;
  private horseshoeGeom: THREE.BufferGeometry;
  private calkGeom: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, initialPoolSizePerType = 16) {
    this.scene = scene;

    // Materials
    this.appleMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.25,
      metalness: 0.08,
      emissive: 0x3b0707
    });

    this.stemMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.8,
      metalness: 0.05
    });

    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.4,
      metalness: 0.1
    });

    this.horseshoeMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0x422006
    });

    // Geometries
    const appleSphere = new THREE.SphereGeometry(0.32, 12, 10);
    appleSphere.scale(1.0, 0.92, 1.0);
    this.appleGeom = appleSphere;

    this.stemGeom = new THREE.CylinderGeometry(0.025, 0.04, 0.16, 6);
    this.leafGeom = new THREE.BoxGeometry(0.16, 0.04, 0.08);

    this.horseshoeGeom = new THREE.TorusGeometry(0.34, 0.085, 8, 16, Math.PI * 1.35);
    this.calkGeom = new THREE.BoxGeometry(0.18, 0.1, 0.18);

    const types: CollectibleType[] = ['apple', 'horseshoe'];
    for (const type of types) {
      this.pool.set(type, []);
      for (let i = 0; i < initialPoolSizePerType; i++) {
        const entity = this.createEntity(type);
        entity.active = false;
        entity.mesh.visible = false;
        this.scene.add(entity.mesh);
        this.pool.get(type)!.push(entity);
      }
    }
  }

  private createEntity(type: CollectibleType): CollectibleEntity {
    const outerMesh = new THREE.Group();
    outerMesh.matrixAutoUpdate = false;

    const visualGroup = new THREE.Group();
    visualGroup.matrixAutoUpdate = true;
    outerMesh.add(visualGroup);

    if (type === 'apple') {
      const appleGroup = new THREE.Group();
      appleGroup.matrixAutoUpdate = false;

      const body = new THREE.Mesh(this.appleGeom, this.appleMat);
      body.castShadow = true;
      body.receiveShadow = false;
      body.matrixAutoUpdate = false;
      body.updateMatrix();
      appleGroup.add(body);

      const stem = new THREE.Mesh(this.stemGeom, this.stemMat);
      stem.position.set(0, 0.35, 0);
      stem.rotation.z = -0.15;
      stem.castShadow = true;
      stem.matrixAutoUpdate = false;
      stem.updateMatrix();
      appleGroup.add(stem);

      const leaf = new THREE.Mesh(this.leafGeom, this.leafMat);
      leaf.position.set(0.08, 0.32, 0);
      leaf.rotation.set(0.2, 0.3, 0.4);
      leaf.castShadow = true;
      leaf.matrixAutoUpdate = false;
      leaf.updateMatrix();
      appleGroup.add(leaf);

      appleGroup.position.y = 1.0; // 1.0m above ground
      appleGroup.updateMatrix();
      visualGroup.add(appleGroup);
    } else {
      const horseshoeGroup = new THREE.Group();
      horseshoeGroup.matrixAutoUpdate = false;

      const shoe = new THREE.Mesh(this.horseshoeGeom, this.horseshoeMat);
      shoe.rotation.z = Math.PI * 0.825;
      shoe.castShadow = true;
      shoe.matrixAutoUpdate = false;
      shoe.updateMatrix();
      horseshoeGroup.add(shoe);

      const ang1 = Math.PI * 0.825;
      const ang2 = Math.PI * 0.825 + Math.PI * 1.35;

      const calk1 = new THREE.Mesh(this.calkGeom, this.horseshoeMat);
      calk1.position.set(0.34 * Math.cos(ang1), 0.34 * Math.sin(ang1), 0);
      calk1.castShadow = true;
      calk1.matrixAutoUpdate = false;
      calk1.updateMatrix();
      horseshoeGroup.add(calk1);

      const calk2 = new THREE.Mesh(this.calkGeom, this.horseshoeMat);
      calk2.position.set(0.34 * Math.cos(ang2), 0.34 * Math.sin(ang2), 0);
      calk2.castShadow = true;
      calk2.matrixAutoUpdate = false;
      calk2.updateMatrix();
      horseshoeGroup.add(calk2);

      horseshoeGroup.position.y = 1.15; // 1.15m above ground
      horseshoeGroup.updateMatrix();
      visualGroup.add(horseshoeGroup);
    }

    return {
      id: ++this.nextId,
      type,
      mesh: outerMesh,
      visualGroup,
      distance: 0,
      lane: 'center',
      lateralOffset: 0,
      active: false,
      chunkIndex: -1,
      phase: 0
    };
  }

  public acquire(type: CollectibleType): CollectibleEntity {
    const list = this.pool.get(type)!;
    let entity: CollectibleEntity;

    if (list.length > 0) {
      entity = list.pop()!;
    } else {
      entity = this.createEntity(type);
      this.scene.add(entity.mesh);
    }

    entity.active = true;
    entity.mesh.visible = true;
    return entity;
  }

  public release(entity: CollectibleEntity): void {
    entity.active = false;
    entity.mesh.visible = false;
    this.pool.get(entity.type)?.push(entity);
  }

  public dispose(): void {
    for (const list of this.pool.values()) {
      for (const entity of list) {
        this.scene.remove(entity.mesh);
      }
    }
    this.pool.clear();

    this.appleGeom.dispose();
    this.stemGeom.dispose();
    this.leafGeom.dispose();
    this.horseshoeGeom.dispose();
    this.calkGeom.dispose();

    this.appleMat.dispose();
    this.stemMat.dispose();
    this.leafMat.dispose();
    this.horseshoeMat.dispose();
  }
}
