import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedModel {
  scene: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  animations: THREE.AnimationClip[];
  saddleBone: THREE.Object3D | null;
}

export class AssetLoader {
  private static gltfLoader = new GLTFLoader();

  /**
   * Loads a GLTF/GLB model from URL, centers along Z, applies scale (0.38 for Quaternius animals),
   * and prepares shadows and animation mixer.
   */
  public static async loadModel(url: string, scale = 0.38): Promise<LoadedModel | null> {
    return new Promise((resolve) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
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
          if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(group);
            const gallopClip =
              gltf.animations.find(
                (a) =>
                  a.name.toLowerCase() === 'gallop' ||
                  a.name.toLowerCase().includes('gallop') ||
                  a.name.toLowerCase().includes('run')
              ) || gltf.animations[0];

            const action = mixer.clipAction(gallopClip);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
          }

          // Search for saddle or spine bone
          let saddleBone: THREE.Object3D | null = null;
          group.traverse((node) => {
            const name = node.name.toLowerCase();
            if (
              name === 'back' ||
              name === 'torso2' ||
              name === 'torso' ||
              name.includes('saddle') ||
              name.includes('spine')
            ) {
              if (!saddleBone) saddleBone = node;
            }
          });

          resolve({
            scene: group,
            mixer,
            animations: gltf.animations || [],
            saddleBone
          });
        },
        undefined,
        (error) => {
          console.info(`Could not load model at "${url}":`, error);
          resolve(null);
        }
      );
    });
  }
}
