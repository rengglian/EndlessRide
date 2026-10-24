import * as THREE from 'three';
import type { ObstacleType } from '../track/types';
import type { ObstacleEntity } from './types';

export class ObstaclePool {
  private scene: THREE.Scene;
  private pool: Map<ObstacleType, ObstacleEntity[]> = new Map();
  private nextId = 0;

  // Shared reusable materials
  private rockMat: THREE.MeshStandardMaterial;
  private woodMat: THREE.MeshStandardMaterial;
  private hurdleWhiteMat: THREE.MeshStandardMaterial;
  private hurdleRedMat: THREE.MeshStandardMaterial;

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
    let collisionRadius = 1.0;

    if (type === 'rock') {
      const geom = new THREE.DodecahedronGeometry(0.9, 1);
      const mesh = new THREE.Mesh(geom, this.rockMat);
      mesh.position.y = 0.7;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      collisionRadius = 0.95;
    } else if (type === 'log') {
      const geom = new THREE.CylinderGeometry(0.35, 0.4, 2.4, 8);
      const mesh = new THREE.Mesh(geom, this.woodMat);
      mesh.rotation.z = Math.PI / 2; // Lie horizontally
      mesh.position.y = 0.35;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      // Add a couple of small stump branches
      const branchGeom = new THREE.CylinderGeometry(0.12, 0.15, 0.6, 6);
      const b1 = new THREE.Mesh(branchGeom, this.woodMat);
      b1.position.set(0.5, 0.5, 0.2);
      b1.rotation.x = 0.5;
      group.add(b1);
      collisionRadius = 1.1;
    } else if (type === 'hurdle') {
      // Equestrian hurdle: two side posts and striped bar
      const postGeom = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8);
      const pLeft = new THREE.Mesh(postGeom, this.hurdleWhiteMat);
      pLeft.position.set(-1.1, 0.7, 0);
      pLeft.castShadow = true;
      group.add(pLeft);

      const pRight = new THREE.Mesh(postGeom, this.hurdleWhiteMat);
      pRight.position.set(1.1, 0.7, 0);
      pRight.castShadow = true;
      group.add(pRight);

      // Striped crossbars
      const barGeom = new THREE.BoxGeometry(2.3, 0.15, 0.08);
      const bar1 = new THREE.Mesh(barGeom, this.hurdleRedMat);
      bar1.position.set(0, 0.9, 0);
      bar1.castShadow = true;
      group.add(bar1);

      const bar2 = new THREE.Mesh(barGeom, this.hurdleWhiteMat);
      bar2.position.set(0, 0.55, 0);
      bar2.castShadow = true;
      group.add(bar2);

      collisionRadius = 1.15;
    } else {
      // Fence post barrier
      const postGeom = new THREE.BoxGeometry(0.2, 1.2, 0.2);
      const p1 = new THREE.Mesh(postGeom, this.woodMat);
      p1.position.set(-1.0, 0.6, 0);
      p1.castShadow = true;
      group.add(p1);

      const p2 = new THREE.Mesh(postGeom, this.woodMat);
      p2.position.set(1.0, 0.6, 0);
      p2.castShadow = true;
      group.add(p2);

      const railGeom = new THREE.BoxGeometry(2.4, 0.12, 0.1);
      const rail = new THREE.Mesh(railGeom, this.woodMat);
      rail.position.set(0, 0.8, 0);
      rail.castShadow = true;
      group.add(rail);

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
    this.rockMat.dispose();
    this.woodMat.dispose();
    this.hurdleWhiteMat.dispose();
    this.hurdleRedMat.dispose();
  }
}
