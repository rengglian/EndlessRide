import * as THREE from 'three';
import type { ObstacleType } from '../track/types';
import type { ObstacleEntity } from './types';

export class ObstaclePool {
  private scene: THREE.Scene;
  private pool: Map<ObstacleType, ObstacleEntity[]> = new Map();
  private nextId = 0;

  // Shared reusable materials (Sec 4.2)
  private rockMat: THREE.MeshStandardMaterial;
  private woodMat: THREE.MeshStandardMaterial;
  private hurdleWhiteMat: THREE.MeshStandardMaterial;
  private hurdleRedMat: THREE.MeshStandardMaterial;

  // Shared reusable geometries allocated once across all pooled obstacles (Sec 4.2)
  private rockGeom: THREE.BufferGeometry;
  private logGeom: THREE.BufferGeometry;
  private branchGeom: THREE.BufferGeometry;
  private hurdlePostGeom: THREE.BufferGeometry;
  private hurdleBarGeom: THREE.BufferGeometry;
  private fencePostGeom: THREE.BufferGeometry;
  private fenceRailGeom: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, initialPoolSizePerType = 12) {
    this.scene = scene;

    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true
    });

    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.85,
      metalness: 0.05
    });

    this.hurdleWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
      metalness: 0.1
    });

    this.hurdleRedMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.5,
      metalness: 0.1
    });

    // Allocate shared obstacle geometries once
    this.rockGeom = new THREE.DodecahedronGeometry(0.9, 1);
    this.logGeom = new THREE.CylinderGeometry(0.35, 0.4, 2.4, 8);
    this.branchGeom = new THREE.CylinderGeometry(0.12, 0.15, 0.6, 6);
    this.hurdlePostGeom = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8);
    this.hurdleBarGeom = new THREE.BoxGeometry(2.3, 0.15, 0.08);
    this.fencePostGeom = new THREE.BoxGeometry(0.2, 1.2, 0.2);
    this.fenceRailGeom = new THREE.BoxGeometry(2.4, 0.12, 0.1);

    const types: ObstacleType[] = ['rock', 'log', 'hurdle', 'fence'];
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

  private createEntity(type: ObstacleType): ObstacleEntity {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;

    let halfWidth = 0.85;
    let halfLength = 0.75;
    let collisionRadius = 1.0;

    if (type === 'rock') {
      const mesh = new THREE.Mesh(this.rockGeom, this.rockMat);
      mesh.position.y = 0.7;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);

      halfWidth = 0.85;
      halfLength = 0.75;
      collisionRadius = 0.95;
    } else if (type === 'log') {
      const mesh = new THREE.Mesh(this.logGeom, this.woodMat);
      mesh.rotation.z = Math.PI / 2; // Lie horizontally
      mesh.position.y = 0.35;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);

      // Add small branch detail
      const b1 = new THREE.Mesh(this.branchGeom, this.woodMat);
      b1.position.set(0.5, 0.5, 0.2);
      b1.rotation.x = 0.5;
      b1.matrixAutoUpdate = false;
      b1.updateMatrix();
      group.add(b1);

      halfWidth = 1.15;
      halfLength = 0.40;
      collisionRadius = 1.1;
    } else if (type === 'hurdle') {
      // Equestrian hurdle: two side posts and striped bar
      const pLeft = new THREE.Mesh(this.hurdlePostGeom, this.hurdleWhiteMat);
      pLeft.position.set(-1.1, 0.7, 0);
      pLeft.castShadow = true;
      pLeft.matrixAutoUpdate = false;
      pLeft.updateMatrix();
      group.add(pLeft);

      const pRight = new THREE.Mesh(this.hurdlePostGeom, this.hurdleWhiteMat);
      pRight.position.set(1.1, 0.7, 0);
      pRight.castShadow = true;
      pRight.matrixAutoUpdate = false;
      pRight.updateMatrix();
      group.add(pRight);

      // Striped crossbars
      const bar1 = new THREE.Mesh(this.hurdleBarGeom, this.hurdleRedMat);
      bar1.position.set(0, 0.9, 0);
      bar1.castShadow = true;
      bar1.matrixAutoUpdate = false;
      bar1.updateMatrix();
      group.add(bar1);

      const bar2 = new THREE.Mesh(this.hurdleBarGeom, this.hurdleWhiteMat);
      bar2.position.set(0, 0.55, 0);
      bar2.castShadow = true;
      bar2.matrixAutoUpdate = false;
      bar2.updateMatrix();
      group.add(bar2);

      halfWidth = 1.10;
      halfLength = 0.25;
      collisionRadius = 1.15;
    } else {
      // Fence post barrier
      const p1 = new THREE.Mesh(this.fencePostGeom, this.woodMat);
      p1.position.set(-1.0, 0.6, 0);
      p1.castShadow = true;
      p1.matrixAutoUpdate = false;
      p1.updateMatrix();
      group.add(p1);

      const p2 = new THREE.Mesh(this.fencePostGeom, this.woodMat);
      p2.position.set(1.0, 0.6, 0);
      p2.castShadow = true;
      p2.matrixAutoUpdate = false;
      p2.updateMatrix();
      group.add(p2);

      const rail = new THREE.Mesh(this.fenceRailGeom, this.woodMat);
      rail.position.set(0, 0.8, 0);
      rail.castShadow = true;
      rail.matrixAutoUpdate = false;
      rail.updateMatrix();
      group.add(rail);

      halfWidth = 1.15;
      halfLength = 0.25;
      collisionRadius = 1.15;
    }

    return {
      id: ++this.nextId,
      type,
      mesh: group,
      distance: 0,
      lane: 'center',
      lateralOffset: 0,
      active: false,
      chunkIndex: -1,
      halfWidth,
      halfLength,
      collisionRadius
    };
  }

  public acquire(type: ObstacleType): ObstacleEntity {
    const list = this.pool.get(type)!;
    let entity: ObstacleEntity;

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

  public release(entity: ObstacleEntity): void {
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

    // Dispose shared geometries (Sec 4.2)
    this.rockGeom.dispose();
    this.logGeom.dispose();
    this.branchGeom.dispose();
    this.hurdlePostGeom.dispose();
    this.hurdleBarGeom.dispose();
    this.fencePostGeom.dispose();
    this.fenceRailGeom.dispose();

    // Dispose shared materials
    this.rockMat.dispose();
    this.woodMat.dispose();
    this.hurdleWhiteMat.dispose();
    this.hurdleRedMat.dispose();
  }
}
