import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedModel {
  scene: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  animations: THREE.AnimationClip[];
  saddleBone: THREE.Object3D | null;
  gallopAction?: THREE.AnimationAction | null;
  gallopDuration?: number;
}

export class AssetLoader {
  private static gltfLoader = new GLTFLoader();

  /**
   * Unified GLTF loader method for characters and props.
   */
  public static async loadGLTF(url: string): Promise<GLTF | null> {
    return new Promise((resolve) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (error) => {
          console.info(`Could not load GLTF at "${url}":`, error);
          resolve(null);
        }
      );
    });
  }

  /**
   * Loads a GLTF/GLB model from URL, centers along Z, applies scale (0.38 for Quaternius animals),
   * and prepares shadows and animation mixer.
   */
  public static async loadModel(url: string, scale = 0.38): Promise<LoadedModel | null> {
    const gltf = await this.loadGLTF(url);
    if (!gltf) return null;

    const group = gltf.scene;

    // Apply scale
    group.scale.set(scale, scale, scale);

    // Center horse mesh along Z so pivot is at the saddle (Z ≈ 0.72 in unscaled model space)
    group.position.set(0, 0, -0.72 * scale);

    // Enable shadows
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if ('roughness' in m) {
              (m as THREE.MeshStandardMaterial).roughness = Math.max(0.4, (m as THREE.MeshStandardMaterial).roughness || 0.6);
            }
          });
        }
      }
    });

    // Setup animation mixer if animation clips exist
    let mixer: THREE.AnimationMixer | null = null;
    let gallopAction: THREE.AnimationAction | null = null;
    let gallopDuration = 0.6;
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(group);
      const gallopClip =
        gltf.animations.find(
          (a) =>
            a.name.toLowerCase() === 'gallop' ||
            a.name.toLowerCase().includes('gallop') ||
            a.name.toLowerCase().includes('run')
        ) || gltf.animations[0];

      gallopAction = mixer.clipAction(gallopClip);
      gallopAction.setLoop(THREE.LoopRepeat, Infinity);
      gallopAction.play();
      gallopDuration = gallopClip.duration || 0.6;
    }

    // Search for saddle or spine bone (prioritize torso2 directly beneath saddle)
    let saddleBone: THREE.Object3D | null = null;
    group.traverse((node) => {
      const name = node.name.toLowerCase();
      if (name === 'torso2' || name.includes('saddle')) {
        saddleBone = node;
      }
    });
    if (!saddleBone) {
      group.traverse((node) => {
        const name = node.name.toLowerCase();
        if (
          name === 'torso' ||
          name === 'back' ||
          name.includes('spine')
        ) {
          if (!saddleBone) saddleBone = node;
        }
      });
    }

    return {
      scene: group,
      mixer,
      animations: gltf.animations || [],
      saddleBone,
      gallopAction,
      gallopDuration
    };
  }
}
