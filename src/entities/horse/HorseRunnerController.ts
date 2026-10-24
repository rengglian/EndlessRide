import * as THREE from 'three';
import { SplineTrack } from '../../track/SplineTrack';
import { HorseMesh } from './HorseMesh';
import { GirlRiderEntity } from '../rider/GirlRiderEntity';
import { AssetLoader, type LoadedModel } from '../../loaders/AssetLoader';

const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _fwdZ = new THREE.Vector3(0, 0, 1);
const _trackQuat = new THREE.Quaternion();
const _bankQuat = new THREE.Quaternion();

export class HorseRunnerController {
  public rootGroup: THREE.Group;
  public horseMesh: HorseMesh;
  public girlRider: GirlRiderEntity;
  private customModel: LoadedModel | null = null;
  private spline: SplineTrack;

  // Custom horse bone references
  private horseBones: Map<string, THREE.Bone> = new Map();
  private horseBaseRotations: Map<string, THREE.Euler> = new Map();

  // Kinematic parameters
  public distance = 0;
  public speed = 18.0; // Fast initial gallop speed (65 km/h)
  public lateralOffset = 0; // u across track width [-3.5, 3.5]
  public lateralVelocity = 0;

  private gallopPhase = 0;
  private isCrashed = false;

  public readonly maxLateralOffset = 3.5;
  public readonly steerMaxSpeed = 12.0; // Responsive high-speed lateral agility
  private readonly riderBaseY = 1.22;
  private readonly riderBaseZ = 0.0;

  constructor(scene: THREE.Scene, spline: SplineTrack) {
    this.spline = spline;
    this.rootGroup = new THREE.Group();

    this.horseMesh = new HorseMesh();
    this.girlRider = new GirlRiderEntity();

    // Attach girl rider to horse saddle
    this.horseMesh.saddleGroup.add(this.girlRider.rootGroup);
    this.rootGroup.add(this.horseMesh.rootGroup);

    scene.add(this.rootGroup);

    // Auto-load available 3D glTF/GLB models
    this.loadBestAvailableModel();

    // Initial position at distance 0
    this.updateTransform();
  }

  private async loadBestAvailableModel(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const customUrl = params.get('horseModel');
    const candidateUrls = customUrl
      ? [customUrl]
      : [
          '/assets/Ultimate_Animated_Animals/glTF/Horse.gltf',
          '/assets/horse.gltf'
        ];

    for (const url of candidateUrls) {
      const loaded = await AssetLoader.loadModel(url, 0.38);
      if (loaded) {
        this.customModel = loaded;
        // Hide procedural mesh and show loaded glTF model
        this.horseMesh.rootGroup.visible = false;
        this.rootGroup.add(loaded.scene);

        // Collect horse bone references and store base rest rotations to prevent unbounded additive drift
        loaded.scene.traverse((child) => {
          if ((child as THREE.Bone).isBone) {
            this.horseBones.set(child.name, child as THREE.Bone);
            this.horseBaseRotations.set(child.name, (child as THREE.Bone).rotation.clone());
          }
        });

        // Position girl rider firmly on top of horse saddle (centered at Z=0)
        this.girlRider.rootGroup.position.set(0, this.riderBaseY, this.riderBaseZ);
        this.rootGroup.add(this.girlRider.rootGroup);
        break;
      }
    }
  }

  public update(steerInput: number, deltaTime: number): void {
    if (this.isCrashed) {
      return;
    }

    const dt = isNaN(deltaTime) || deltaTime <= 0 ? 0.0166 : Math.min(deltaTime, 0.05);
    const steer = isNaN(steerInput) ? 0 : THREE.MathUtils.clamp(steerInput, -1.0, 1.0);

    // 1. High-speed forward progression & dynamic acceleration
    this.distance += this.speed * dt;
    this.speed = Math.min(30.0, 18.0 + 0.1 * Math.sqrt(Math.max(0, this.distance)));

    // 2. Lateral Left/Right steering with snappy responsive damping
    const targetLateralVel = steer * this.steerMaxSpeed;
    this.lateralVelocity += (targetLateralVel - this.lateralVelocity) * (1.0 - Math.exp(-18.0 * dt));

    this.lateralOffset += this.lateralVelocity * dt;
    this.lateralOffset = THREE.MathUtils.clamp(
      this.lateralOffset,
      -this.maxLateralOffset,
      this.maxLateralOffset
    );

    // 3. Spline position & orientation on curved track
    this.updateTransform();

    // 4. Update Gallop Animation & Energetic 4-Leg Cadence
    const strideFreq = 4.4 * (this.speed / 18.0); // 4.4 Hz energetic racing gallop
    this.gallopPhase += dt * strideFreq * Math.PI * 2;

    if (this.customModel && this.customModel.mixer) {
      // Advance embedded animation mixer at high-speed rate
      this.customModel.mixer.update(dt * (this.speed / 18.0) * 1.6);

      // Enhance front-leg stride excursion and shoulder reach in real-time
      const flPhase = this.gallopPhase;
      const frPhase = this.gallopPhase + 0.45; // Staggered lead leg

      const frontShoulderL = this.horseBones.get('FrontShoulder.L');
      const frontUpperLegL = this.horseBones.get('FrontUpperLeg.L');
      const frontLowerLegL = this.horseBones.get('FrontLowerLeg.L');
      const baseShoulderL = this.horseBaseRotations.get('FrontShoulder.L');
      const baseUpperL = this.horseBaseRotations.get('FrontUpperLeg.L');
      const baseLowerL = this.horseBaseRotations.get('FrontLowerLeg.L');

      if (frontUpperLegL && frontLowerLegL && baseUpperL && baseLowerL) {
        frontUpperLegL.rotation.z = baseUpperL.z + Math.sin(flPhase) * 0.6;
        frontLowerLegL.rotation.z = baseLowerL.z + Math.max(0, -Math.sin(flPhase - 0.4)) * 0.7;
        if (frontShoulderL && baseShoulderL) {
          frontShoulderL.rotation.z = baseShoulderL.z + Math.sin(flPhase) * 0.25;
        }
      }

      const frontShoulderR = this.horseBones.get('FrontShoulder.R');
      const frontUpperLegR = this.horseBones.get('FrontUpperLeg.R');
      const frontLowerLegR = this.horseBones.get('FrontLowerLeg.R');
      const baseShoulderR = this.horseBaseRotations.get('FrontShoulder.R');
      const baseUpperR = this.horseBaseRotations.get('FrontUpperLeg.R');
      const baseLowerR = this.horseBaseRotations.get('FrontLowerLeg.R');

      if (frontUpperLegR && frontLowerLegR && baseUpperR && baseLowerR) {
        frontUpperLegR.rotation.z = baseUpperR.z + Math.sin(frPhase) * 0.6;
        frontLowerLegR.rotation.z = baseLowerR.z + Math.max(0, -Math.sin(frPhase - 0.4)) * 0.7;
        if (frontShoulderR && baseShoulderR) {
          frontShoulderR.rotation.z = baseShoulderR.z + Math.sin(frPhase) * 0.25;
        }
      }

      // Neck & Head cadence
      const neck1 = this.horseBones.get('Neck1');
      const neck2 = this.horseBones.get('Neck2');
      const baseNeck1 = this.horseBaseRotations.get('Neck1');
      const baseNeck2 = this.horseBaseRotations.get('Neck2');
      if (neck1 && baseNeck1) neck1.rotation.y = baseNeck1.y - Math.cos(this.gallopPhase) * 0.09;
      if (neck2 && baseNeck2) neck2.rotation.y = baseNeck2.y - Math.cos(this.gallopPhase) * 0.07;

      // Synchronize rider vertical bobbing with horse stride
      this.girlRider.rootGroup.position.y = this.riderBaseY + Math.sin(this.gallopPhase * 2.0) * 0.03;
      this.girlRider.rootGroup.position.z = this.riderBaseZ;
      this.girlRider.rootGroup.rotation.x = Math.cos(this.gallopPhase) * 0.03;
    } else {
      this.horseMesh.animateGallop(this.gallopPhase);
    }

    this.girlRider.updateKinematics(
      this.gallopPhase,
      this.lateralVelocity,
      this.speed,
      dt
    );
  }

  private updateTransform(): void {
    this.spline.getTransformAt(
      this.distance,
      this.lateralOffset,
      _pos,
      _tangent,
      _normal
    );
    this.rootGroup.position.copy(_pos);

    // Primary alignment: face directly along track forward tangent
    _trackQuat.setFromUnitVectors(_fwdZ, _tangent);

    // Subtle natural bank roll (gentle lean into turns, no aggressive tilt)
    const trackBank = this.spline.getBankingAngleAtDistance(this.distance, this.speed) * 0.4;
    const steerBank = 0.12 * (this.lateralVelocity / this.steerMaxSpeed);

    _bankQuat.setFromAxisAngle(_tangent, trackBank + steerBank);

    this.rootGroup.quaternion.copy(_trackQuat);
    this.rootGroup.quaternion.premultiply(_bankQuat);
  }

  public getTransform(outPos: THREE.Vector3, outTangent: THREE.Vector3): void {
    this.spline.getTransformAt(
      this.distance,
      this.lateralOffset,
      outPos,
      outTangent,
      _normal
    );
  }

  public setCrashed(crashed: boolean): void {
    this.isCrashed = crashed;
    if (crashed) {
      this.horseMesh.rootGroup.rotation.z = 0.5;
      this.horseMesh.rootGroup.position.y = -0.5;
      if (this.customModel) {
        this.customModel.scene.rotation.z = 0.5;
        this.customModel.scene.position.y = -0.5;
      }
      this.girlRider.rootGroup.rotation.z = 0.6;
      this.girlRider.rootGroup.position.y = 0.4;
    }
  }

  public reset(): void {
    this.distance = 0;
    this.speed = 18.0;
    this.lateralOffset = 0;
    this.lateralVelocity = 0;
    this.gallopPhase = 0;
    this.isCrashed = false;
    this.horseMesh.rootGroup.rotation.set(0, 0, 0);
    this.horseMesh.rootGroup.position.set(0, 0, 0);
    if (this.customModel) {
      this.customModel.scene.rotation.set(0, 0, 0);
      this.customModel.scene.position.set(0, 0, 0);
    }
    this.girlRider.rootGroup.position.set(0, this.riderBaseY, this.riderBaseZ);
    this.girlRider.rootGroup.rotation.set(0, 0, 0);
    this.updateTransform();
  }

  public dispose(): void {
    this.horseMesh.dispose();
    this.girlRider.dispose();
  }
}
