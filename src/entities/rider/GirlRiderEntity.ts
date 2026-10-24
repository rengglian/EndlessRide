import * as THREE from 'three';
import { AssetLoader } from '../../loaders/AssetLoader';

export class GirlRiderEntity {
  public rootGroup: THREE.Group;

  private spineGroup: THREE.Group;
  private proceduralGroup: THREE.Group;
  private customRiderGroup: THREE.Group | null = null;
  private bones: Map<string, THREE.Bone> = new Map();
  private baseRotations: Map<string, THREE.Euler> = new Map();

  // Cached direct bone references for zero per-frame lookups & regex allocations
  private hipsBone?: THREE.Bone;
  private abdomenBone?: THREE.Bone;
  private torsoBone?: THREE.Bone;
  private chestBone?: THREE.Bone;
  private neckBone?: THREE.Bone;
  private headBone?: THREE.Bone;
  private upperArmLBone?: THREE.Bone;
  private lowerArmLBone?: THREE.Bone;
  private upperArmRBone?: THREE.Bone;
  private lowerArmRBone?: THREE.Bone;
  private wristLBone?: THREE.Bone;
  private wristRBone?: THREE.Bone;
  private upperLegLBone?: THREE.Bone;
  private lowerLegLBone?: THREE.Bone;
  private upperLegRBone?: THREE.Bone;
  private lowerLegRBone?: THREE.Bone;

  // Procedural fallback meshes
  private proceduralHeadGroup!: THREE.Group;
  private hair!: THREE.Mesh;
  private leftArm!: THREE.Group;
  private rightArm!: THREE.Group;
  private leftHandMesh: THREE.Mesh | null = null;
  private rightHandMesh: THREE.Mesh | null = null;
  private leftLeg!: THREE.Group;
  private rightLeg!: THREE.Group;

  // Materials
  private skinMat: THREE.MeshStandardMaterial;
  private jacketMat: THREE.MeshStandardMaterial;
  private pantsMat: THREE.MeshStandardMaterial;
  private hairMat: THREE.MeshStandardMaterial;
  private bootMat: THREE.MeshStandardMaterial;

  // Smoothed kinematic states (framerate-independent exponential damping)
  private smoothedLateralVel = 0;
  private smoothedSteer = 0;

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

  public getBone(name: string): THREE.Bone | undefined {
    return (
      this.bones.get(name) ||
      this.bones.get(name.replace(/\./g, '')) ||
      this.bones.get(name.replace(/([LR])$/, '.$1'))
    );
  }

  public getBaseRotation(name: string): THREE.Euler | undefined {
    return (
      this.baseRotations.get(name) ||
      this.baseRotations.get(name.replace(/\./g, '')) ||
      this.baseRotations.get(name.replace(/([LR])$/, '.$1'))
    );
  }

  public getHandPositions(outLeft: THREE.Vector3, outRight: THREE.Vector3): void {
    if (this.customRiderGroup && this.wristLBone && this.wristRBone) {
      this.wristLBone.getWorldPosition(outLeft);
      this.wristRBone.getWorldPosition(outRight);
    } else if (this.leftHandMesh && this.rightHandMesh) {
      this.leftHandMesh.getWorldPosition(outLeft);
      this.rightHandMesh.getWorldPosition(outRight);
    } else {
      this.rootGroup.localToWorld(outLeft.set(-0.15, 0.35, 0.3));
      this.rootGroup.localToWorld(outRight.set(0.15, 0.35, 0.3));
    }
  }

  private async loadCustomRider(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const customUrl = params.get('riderModel');
    const candidateUrls = customUrl
      ? [customUrl]
      : [
          '/assets/Ultimate_Modular_Women/Individual Characters/glTF/Adventurer.gltf',
          '/assets/Ultimate_Modular_Women/Individual Characters/glTF/Casual.gltf',
          '/assets/Ultimate_Modular_Women/Individual Characters/glTF/Medieval.gltf'
        ];

    for (const url of candidateUrls) {
      try {
        const gltf = await AssetLoader.loadGLTF(url);

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
              const bone = child as THREE.Bone;
              this.bones.set(bone.name, bone);
              this.baseRotations.set(bone.name, bone.rotation.clone());

              // Populate dotted and undotted name aliases for GLTFLoader compatibility
              if (bone.name.endsWith('L') || bone.name.endsWith('R')) {
                const dotted = bone.name.replace(/([LR])$/, '.$1');
                this.bones.set(dotted, bone);
                this.baseRotations.set(dotted, bone.rotation.clone());
              }
              if (bone.name.includes('.')) {
                const undotted = bone.name.replace(/\./g, '');
                this.bones.set(undotted, bone);
                this.baseRotations.set(undotted, bone.rotation.clone());
              }
            }
          });

          // 1. Neutralize asymmetric idle twist on Body and Torso
          const bodyBone = this.getBone('Body');
          const torsoBone = this.getBone('Torso');
          if (bodyBone) {
            bodyBone.rotation.set(0, 0, 0);
            this.baseRotations.set('Body', bodyBone.rotation.clone());
          }
          if (torsoBone) {
            torsoBone.rotation.set(0.15, 0, 0);
            this.baseRotations.set('Torso', torsoBone.rotation.clone());
          }

          // 2. Reparent Foot bones to LowerLeg bones so feet articulate naturally with the legs
          const lowerLegL = this.getBone('LowerLeg.L');
          const footL = this.getBone('Foot.L');
          const lowerLegR = this.getBone('LowerLeg.R');
          const footR = this.getBone('Foot.R');

          if (lowerLegL && footL) {
            lowerLegL.add(footL);
            footL.position.set(0, 0.535, 0);
            footL.rotation.set(-1.45, 0, 0.05); // heels down, toe in stirrup
            this.baseRotations.set('Foot.L', footL.rotation.clone());
          }
          if (lowerLegR && footR) {
            lowerLegR.add(footR);
            footR.position.set(0, 0.535, 0);
            footR.rotation.set(-1.45, 0, -0.05);
            this.baseRotations.set('Foot.R', footR.rotation.clone());
          }

          // 3. Curl fingers into loose reins-holding grip
          const fingerBones = [
            'Index1.L', 'Index2.L', 'Middle1.L', 'Middle2.L', 'Ring1.L', 'Ring2.L', 'Pinky1.L', 'Pinky2.L',
            'Index1.R', 'Index2.R', 'Middle1.R', 'Middle2.R', 'Ring1.R', 'Ring2.R', 'Pinky1.R', 'Pinky2.R',
            'Thumb1.L', 'Thumb2.L', 'Thumb1.R', 'Thumb2.R'
          ];
          for (const fName of fingerBones) {
            const b = this.getBone(fName);
            if (b) {
              if (fName.startsWith('Thumb')) {
                b.rotation.x = -0.45;
                b.rotation.y = -0.25;
              } else {
                b.rotation.x = -0.65;
              }
              this.baseRotations.set(fName, b.rotation.clone());
            }
          }

          // Cache direct bone fields once after load for zero runtime regex or Map lookup overhead
          this.hipsBone = this.getBone('Hips');
          this.abdomenBone = this.getBone('Abdomen');
          this.torsoBone = this.getBone('Torso');
          this.chestBone = this.getBone('Chest');
          this.neckBone = this.getBone('Neck');
          this.headBone = this.getBone('Head');
          this.upperArmLBone = this.getBone('UpperArm.L');
          this.lowerArmLBone = this.getBone('LowerArm.L');
          this.upperArmRBone = this.getBone('UpperArm.R');
          this.lowerArmRBone = this.getBone('LowerArm.R');
          this.wristLBone = this.getBone('Wrist.L');
          this.wristRBone = this.getBone('Wrist.R');
          this.upperLegLBone = this.getBone('UpperLeg.L');
          this.lowerLegLBone = this.getBone('LowerLeg.L');
          this.upperLegRBone = this.getBone('UpperLeg.R');
          this.lowerLegRBone = this.getBone('LowerLeg.R');

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

    // 3. Head & Helmet Group (articulated for gaze stabilization)
    this.proceduralHeadGroup = new THREE.Group();
    this.proceduralHeadGroup.position.set(0, 0.82, 0.04);

    const headGeom = new THREE.BoxGeometry(0.24, 0.26, 0.24);
    const head = new THREE.Mesh(headGeom, this.skinMat);
    head.castShadow = true;
    this.proceduralHeadGroup.add(head);

    // Equestrian Helmet
    const hairTopGeom = new THREE.BoxGeometry(0.26, 0.16, 0.26);
    const hairTop = new THREE.Mesh(hairTopGeom, this.hairMat);
    hairTop.position.set(0, 0.1, 0);
    this.proceduralHeadGroup.add(hairTop);

    // Ponytail
    const ponytailGeom = new THREE.ConeGeometry(0.08, 0.45, 6);
    this.hair = new THREE.Mesh(ponytailGeom, this.hairMat);
    this.hair.position.set(0, 0.08, -0.2);
    this.hair.rotation.x = -0.7;
    this.proceduralHeadGroup.add(this.hair);

    this.proceduralGroup.add(this.proceduralHeadGroup);

    // 4. Arms
    this.leftArm = this.createArm(-0.24, 0.6, 0.05, 0.15, true);
    this.rightArm = this.createArm(0.24, 0.6, 0.05, -0.15, false);
    this.proceduralGroup.add(this.leftArm);
    this.proceduralGroup.add(this.rightArm);

    // 5. Legs
    this.leftLeg = this.createRiderLeg(-0.22);
    this.rightLeg = this.createRiderLeg(0.22);
    this.proceduralGroup.add(this.leftLeg);
    this.proceduralGroup.add(this.rightLeg);
  }

  private createArm(x: number, y: number, z: number, inwardAngle: number, isLeft: boolean): THREE.Group {
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

    if (isLeft) {
      this.leftHandMesh = hand;
    } else {
      this.rightHandMesh = hand;
    }

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
   * Updates dynamic rider kinematics (multi-joint equestrian biomechanics, independent seat,
   * spine chain wind-tuck & roll banking, gaze stabilization, elastic rein give-and-take, stirrup suspension).
   */
  public updateKinematics(
    gallopPhase: number,
    lateralVelocity: number,
    forwardSpeed: number,
    deltaTime: number,
    _saddleElevationDelta = 0,
    saddlePitchDelta = 0
  ): void {
    const dt = isNaN(deltaTime) || deltaTime <= 0 ? 0.0166 : Math.min(deltaTime, 0.05);

    // 1. Framerate-independent exponential filtering for responsive yet jitter-free rider posture
    const filterK = 14.0;
    const alpha = 1.0 - Math.exp(-filterK * dt);
    this.smoothedLateralVel += (lateralVelocity - this.smoothedLateralVel) * alpha;

    const steerRatio = THREE.MathUtils.clamp(this.smoothedLateralVel / 12.0, -1.0, 1.0);
    this.smoothedSteer += (steerRatio - this.smoothedSteer) * alpha;

    const speedRatio = THREE.MathUtils.clamp((forwardSpeed - 18.0) / 12.0, 0.0, 1.0);

    // Vertical positioning is handled by the horse mount suspension
    this.spineGroup.position.set(0, 0, 0);

    if (this.customRiderGroup) {
      this.spineGroup.rotation.set(0, 0, 0);

      // --- A. Pelvis & Hip Shock Absorption (Hips) ---
      if (this.hipsBone) {
        const hipCounterPitch = -saddlePitchDelta * 0.6 + Math.sin(gallopPhase) * 0.04;
        this.hipsBone.rotation.x = -0.14 + hipCounterPitch;
      }

      // --- B. Progressive Spine Chain (Abdomen -> Torso -> Chest) ---
      const abdomenTuck = 0.06 + speedRatio * 0.08;
      const torsoTuck = 0.12 + speedRatio * 0.1;
      const chestTuck = 0.06 + speedRatio * 0.08;

      const targetRoll = this.smoothedSteer * 0.22;
      const targetYaw = -this.smoothedSteer * 0.12;

      if (this.abdomenBone) {
        this.abdomenBone.rotation.set(abdomenTuck, targetYaw * 0.2, targetRoll * 0.25);
      }
      if (this.torsoBone) {
        this.torsoBone.rotation.set(torsoTuck, targetYaw * 0.4, targetRoll * 0.35);
      }
      if (this.chestBone) {
        this.chestBone.rotation.set(chestTuck, targetYaw * 0.4, targetRoll * 0.4);
      }

      // --- C. Head & Gaze Stabilization (Neck -> Head) ---
      const totalSpinePitch = abdomenTuck + torsoTuck + chestTuck + saddlePitchDelta * 0.35;
      const pitchCompensation = -totalSpinePitch * 0.85;
      const rollCompensation = -targetRoll * 0.7;
      const lookYaw = -this.smoothedSteer * 0.28;

      if (this.neckBone) {
        this.neckBone.rotation.set(pitchCompensation * 0.45, lookYaw * 0.3, rollCompensation * 0.35);
      }
      if (this.headBone) {
        this.headBone.rotation.set(pitchCompensation * 0.55, lookYaw * 0.7, rollCompensation * 0.65);
      }

      // --- D. Dynamic Elastic Rein-Following Arms ---
      const reinCadence = Math.sin(gallopPhase) * 0.04;
      const pullL = this.smoothedSteer < 0 ? -this.smoothedSteer * 0.16 : -this.smoothedSteer * 0.08;
      const pullR = this.smoothedSteer > 0 ? this.smoothedSteer * 0.16 : this.smoothedSteer * 0.08;

      if (this.upperArmLBone && this.lowerArmLBone) {
        this.upperArmLBone.rotation.set(
          -0.9 + reinCadence * 0.5 - pullL * 0.4,
          0.2 - pullL * 0.2,
          -0.9 - pullL * 0.3
        );
        this.lowerArmLBone.rotation.set(
          -1.1 - reinCadence * 0.8 + pullL * 0.5,
          0.0,
          -1.3 - pullL * 0.2
        );
      }

      if (this.upperArmRBone && this.lowerArmRBone) {
        this.upperArmRBone.rotation.set(
          -0.9 + reinCadence * 0.5 - pullR * 0.4,
          -0.2 + pullR * 0.2,
          0.9 + pullR * 0.3
        );
        this.lowerArmRBone.rotation.set(
          -1.1 - reinCadence * 0.8 + pullR * 0.5,
          0.0,
          1.3 + pullR * 0.2
        );
      }

      // --- E. Stirrup & Knee Suspension ---
      const kneeSpring = Math.sin(gallopPhase) * 0.04;
      const insideShift = this.smoothedSteer * 0.05;

      if (this.upperLegLBone && this.lowerLegLBone) {
        this.upperLegLBone.rotation.set(1.4 + kneeSpring * 0.3 - insideShift, 0.15, -0.35);
        this.lowerLegLBone.rotation.set(1.7 + kneeSpring * 0.6 - insideShift * 0.5, 0.0, 0.0);
      }

      if (this.upperLegRBone && this.lowerLegRBone) {
        this.upperLegRBone.rotation.set(1.4 + kneeSpring * 0.3 + insideShift, -0.15, 0.35);
        this.lowerLegRBone.rotation.set(1.7 + kneeSpring * 0.6 + insideShift * 0.5, 0.0, 0.0);
      }
    } else {
      // Procedural Fallback Mesh Kinematics
      const targetRoll = this.smoothedSteer * 0.22;
      this.spineGroup.rotation.z = targetRoll;
      this.spineGroup.rotation.x = 0.14 + speedRatio * 0.18;

      // Head gaze stabilization
      if (this.proceduralHeadGroup) {
        this.proceduralHeadGroup.rotation.x = -this.spineGroup.rotation.x * 0.85;
        this.proceduralHeadGroup.rotation.y = -this.smoothedSteer * 0.28;
        this.proceduralHeadGroup.rotation.z = -targetRoll * 0.7;
      }

      // Procedural arms give-and-take & steer pull
      const reinCadence = Math.sin(gallopPhase) * 0.04;
      const pullL = this.smoothedSteer < 0 ? -this.smoothedSteer * 0.2 : -this.smoothedSteer * 0.08;
      const pullR = this.smoothedSteer > 0 ? this.smoothedSteer * 0.2 : this.smoothedSteer * 0.08;

      if (this.leftArm) {
        this.leftArm.rotation.x = reinCadence - pullL;
        this.leftArm.rotation.z = 0.15 + pullL * 0.15;
      }
      if (this.rightArm) {
        this.rightArm.rotation.x = reinCadence - pullR;
        this.rightArm.rotation.z = -0.15 - pullR * 0.15;
      }

      // Procedural legs stirrup suspension
      const kneeSpring = Math.sin(gallopPhase) * 0.05;
      const insideShift = this.smoothedSteer * 0.05;
      if (this.leftLeg) {
        this.leftLeg.rotation.x = kneeSpring - insideShift;
      }
      if (this.rightLeg) {
        this.rightLeg.rotation.x = kneeSpring + insideShift;
      }

      // Ponytail aerodynamic wind flutter
      if (this.hair) {
        this.hair.rotation.x = -0.7 - speedRatio * 0.35 + Math.sin(gallopPhase * 2.0) * 0.12;
        this.hair.rotation.z = Math.cos(gallopPhase) * 0.15 - targetRoll * 0.5;
      }
    }
  }

  public reset(): void {
    this.smoothedLateralVel = 0;
    this.smoothedSteer = 0;
    this.spineGroup.position.set(0, 0, 0);
    this.spineGroup.rotation.set(0, 0, 0);
  }

  public dispose(): void {
    this.rootGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
      }
    });
    this.skinMat.dispose();
    this.jacketMat.dispose();
    this.pantsMat.dispose();
    this.hairMat.dispose();
    this.bootMat.dispose();
  }
}
