import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class GirlRiderEntity {
  public rootGroup: THREE.Group;

  private spineGroup: THREE.Group;
  private proceduralGroup: THREE.Group;
  private customRiderGroup: THREE.Group | null = null;
  private bones: Map<string, THREE.Bone> = new Map();

  // Procedural fallback meshes
  private hair!: THREE.Mesh;
  private leftArm!: THREE.Group;
  private rightArm!: THREE.Group;

  // Materials
  private skinMat: THREE.MeshStandardMaterial;
  private jacketMat: THREE.MeshStandardMaterial;
  private pantsMat: THREE.MeshStandardMaterial;
  private hairMat: THREE.MeshStandardMaterial;
  private bootMat: THREE.MeshStandardMaterial;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.spineGroup = new THREE.Group();
    this.proceduralGroup = new THREE.Group();

    this.skinMat = new THREE.MeshStandardMaterial({
      color: 0xfde2d9,
      roughness: 0.6
    });

    this.jacketMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.7,
      metalness: 0.1
    });

    this.pantsMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.8
    });

    this.hairMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.5
    });

    this.bootMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.4
    });

    this.buildProceduralRider();
    this.rootGroup.add(this.spineGroup);
    this.spineGroup.add(this.proceduralGroup);

    // Auto-load modular woman character
    this.loadCustomRider();
  }

  private async loadCustomRider(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const customUrl = params.get('riderModel');
    const loader = new GLTFLoader();
    const candidateUrls = customUrl
      ? [customUrl]
      : [
          '/assets/Ultimate_Modular_Women/Individual Characters/glTF/Adventurer.gltf',
          '/assets/Ultimate_Modular_Women/Individual Characters/glTF/Casual.gltf',
          '/assets/Ultimate_Modular_Women/Individual Characters/glTF/Medieval.gltf'
        ];

    for (const url of candidateUrls) {
      try {
        const gltf = await new Promise<any>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });

        if (gltf && gltf.scene) {
          const group = gltf.scene as THREE.Group;

          // Scale rider (0.65) and offset by hip height so rootGroup (0,0,0) is at pelvis
          const riderScale = 0.65;
          group.scale.set(riderScale, riderScale, riderScale);
          // In Adventurer.gltf, hips are at Y ≈ 0.94 in raw model space
          group.position.set(0, -0.94 * riderScale, 0);

          // Collect bone references & enable shadows
          group.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
            if ((child as THREE.Bone).isBone) {
              this.bones.set(child.name, child as THREE.Bone);
            }
          });

          this.customRiderGroup = group;
          this.proceduralGroup.visible = false;
          this.spineGroup.add(this.customRiderGroup);
          break;
        }
      } catch {
        // Continue to next candidate or procedural fallback
      }
    }
  }

  private buildProceduralRider(): void {
    // 1. Pelvis / Hips & Breeches (origin at pelvis center)
    const hipsGeom = new THREE.BoxGeometry(0.38, 0.25, 0.35);
    const hips = new THREE.Mesh(hipsGeom, this.pantsMat);
    hips.position.set(0, 0.12, 0);
    hips.castShadow = true;
    this.proceduralGroup.add(hips);

    // 2. Torso / Jacket
    const torsoGeom = new THREE.BoxGeometry(0.36, 0.5, 0.28);
    const torso = new THREE.Mesh(torsoGeom, this.jacketMat);
    torso.position.set(0, 0.45, 0);
    torso.castShadow = true;
    this.proceduralGroup.add(torso);

    // 3. Head & Hair
    const headGeom = new THREE.BoxGeometry(0.24, 0.26, 0.24);
    const head = new THREE.Mesh(headGeom, this.skinMat);
    head.position.set(0, 0.82, 0.04);
    head.castShadow = true;
    this.proceduralGroup.add(head);

    // Equestrian Helmet
    const hairTopGeom = new THREE.BoxGeometry(0.26, 0.16, 0.26);
    const hairTop = new THREE.Mesh(hairTopGeom, this.hairMat);
    hairTop.position.set(0, 0.92, 0.04);
    this.proceduralGroup.add(hairTop);

    // Ponytail
    const ponytailGeom = new THREE.ConeGeometry(0.08, 0.45, 6);
    this.hair = new THREE.Mesh(ponytailGeom, this.hairMat);
    this.hair.position.set(0, 0.9, -0.16);
    this.hair.rotation.x = -0.7;
    this.proceduralGroup.add(this.hair);

    // 4. Arms
    this.leftArm = this.createArm(-0.24, 0.6, 0.05, 0.15);
    this.rightArm = this.createArm(0.24, 0.6, 0.05, -0.15);
    this.proceduralGroup.add(this.leftArm);
    this.proceduralGroup.add(this.rightArm);

    // 5. Legs
    const legL = this.createRiderLeg(-0.22);
    const legR = this.createRiderLeg(0.22);
    this.proceduralGroup.add(legL);
    this.proceduralGroup.add(legR);
  }

  private createArm(x: number, y: number, z: number, inwardAngle: number): THREE.Group {
    const armGroup = new THREE.Group();
    armGroup.position.set(x, y, z);

    const upperGeom = new THREE.BoxGeometry(0.12, 0.3, 0.12);
    const upper = new THREE.Mesh(upperGeom, this.jacketMat);
    upper.position.set(0, -0.12, 0.08);
    upper.rotation.x = -0.5;
    upper.rotation.z = inwardAngle;
    upper.castShadow = true;
    armGroup.add(upper);

    const foreGeom = new THREE.BoxGeometry(0.1, 0.26, 0.1);
    const fore = new THREE.Mesh(foreGeom, this.jacketMat);
    fore.position.set(0, -0.22, 0.24);
    fore.rotation.x = -1.2;
    fore.castShadow = true;
    armGroup.add(fore);

    const handGeom = new THREE.BoxGeometry(0.08, 0.08, 0.1);
    const hand = new THREE.Mesh(handGeom, this.skinMat);
    hand.position.set(0, -0.26, 0.36);
    armGroup.add(hand);

    return armGroup;
  }

  private createRiderLeg(x: number): THREE.Group {
    const legGroup = new THREE.Group();
    legGroup.position.set(x, 0.05, 0);

    const thighGeom = new THREE.BoxGeometry(0.14, 0.35, 0.16);
    const thigh = new THREE.Mesh(thighGeom, this.pantsMat);
    thigh.position.set(0, -0.05, 0.12);
    thigh.rotation.x = -0.8;
    thigh.castShadow = true;
    legGroup.add(thigh);

    const shinGeom = new THREE.BoxGeometry(0.12, 0.35, 0.12);
    const shin = new THREE.Mesh(shinGeom, this.bootMat);
    shin.position.set(0, -0.28, 0.18);
    shin.rotation.x = 0.2;
    shin.castShadow = true;
    legGroup.add(shin);

    return legGroup;
  }

  /**
   * Updates dynamic rider kinematics (gallop bobbing, banking lean into dodges, wind tuck).
   */
  public updateKinematics(
    gallopPhase: number,
    lateralVelocity: number,
    forwardSpeed: number,
    deltaTime: number
  ): void {
    // 1. Vertical Pelvis Bobbing (4.0 Hz Gallop Rhythm)
    const bob = Math.sin(gallopPhase * 2.0) * 0.035;
    this.spineGroup.position.y = bob;

    // 2. Lateral Upper-body Banking Lean into dodges (lean right when lateralVelocity > 0)
    const targetRoll = (lateralVelocity / 8.0) * 0.28;
    this.spineGroup.rotation.z += (targetRoll - this.spineGroup.rotation.z) * (1.0 - Math.exp(-12.0 * deltaTime));

    // 3. Forward Speed Wind Tuck (Pitch)
    const speedRatio = THREE.MathUtils.clamp(forwardSpeed / 22.0, 0.5, 1.0);
    this.spineGroup.rotation.x = 0.14 + speedRatio * 0.18;

    // 4. Enforce natural seated equestrian riding pose on 3D skeleton
    const upperLegL = this.bones.get('UpperLeg.L');
    const lowerLegL = this.bones.get('LowerLeg.L');
    const upperLegR = this.bones.get('UpperLeg.R');
    const lowerLegR = this.bones.get('LowerLeg.R');

    if (upperLegL && lowerLegL && upperLegR && lowerLegR) {
      // Thighs rotated forward and spread across saddle barrel
      upperLegL.rotation.set(1.35, 0.25, -0.42);
      lowerLegL.rotation.set(-1.2, 0.0, 0.0);

      upperLegR.rotation.set(1.35, -0.25, 0.42);
      lowerLegR.rotation.set(-1.2, 0.0, 0.0);
    }

    const upperArmL = this.bones.get('UpperArm.L');
    const lowerArmL = this.bones.get('LowerArm.L');
    const upperArmR = this.bones.get('UpperArm.R');
    const lowerArmR = this.bones.get('LowerArm.R');

    if (upperArmL && lowerArmL && upperArmR && lowerArmR) {
      // Arms reaching forward holding reins
      upperArmL.rotation.set(-0.55, 0.25, 0.3);
      lowerArmL.rotation.set(-0.85, -0.15, -0.4);

      upperArmR.rotation.set(-0.55, -0.25, -0.3);
      lowerArmR.rotation.set(-0.85, 0.15, 0.4);
    }

    const chest = this.bones.get('Chest') || this.bones.get('Torso');
    if (chest) {
      chest.rotation.z = this.spineGroup.rotation.z * 0.4;
      chest.rotation.x = speedRatio * 0.12;
    }

    // Ponytail Wind Flutter on procedural mesh
    if (this.hair) {
      this.hair.rotation.x = -0.7 - speedRatio * 0.4 + Math.sin(gallopPhase * 3.0) * 0.1;
      this.hair.rotation.z = Math.cos(gallopPhase * 2.0) * 0.15;
    }
  }

  public dispose(): void {
    this.skinMat.dispose();
    this.jacketMat.dispose();
    this.pantsMat.dispose();
    this.hairMat.dispose();
    this.bootMat.dispose();
  }
}
