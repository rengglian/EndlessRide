import * as THREE from 'three';
import { SplineTrack } from '../../track/SplineTrack';
import {
  BASE_SPEED,
  MAX_SPEED,
  STEER_MAX_SPEED,
  MAX_LATERAL_OFFSET,
  DIFFICULTY_PRESETS,
  type DifficultyPreset
} from '../../config';
import { HorseMesh } from './HorseMesh';
import { GirlRiderEntity } from '../rider/GirlRiderEntity';
import { AssetLoader, type LoadedModel } from '../../loaders/AssetLoader';

// Module-scope reusable objects for zero per-frame runtime allocations
const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _fwdZ = new THREE.Vector3(0, 0, 1);
const _trackQuat = new THREE.Quaternion();
const _bankQuat = new THREE.Quaternion();

const _saddleWorld = new THREE.Vector3();
const _saddleLocal = new THREE.Vector3();
const _backWorld = new THREE.Vector3();
const _backLocal = new THREE.Vector3();

const _bitLWorld = new THREE.Vector3();
const _bitRWorld = new THREE.Vector3();
const _handLWorld = new THREE.Vector3();
const _handRWorld = new THREE.Vector3();
const _r1 = new THREE.Vector3();
const _r2 = new THREE.Vector3();
const _r3 = new THREE.Vector3();
const _r4 = new THREE.Vector3();

export class HorseRunnerController {
  public rootGroup: THREE.Group;
  public horseMesh: HorseMesh;
  public girlRider: GirlRiderEntity;
  private customModel: LoadedModel | null = null;
  private spline: SplineTrack;

  // Custom horse bone references
  private horseBones: Map<string, THREE.Bone> = new Map();
  private horseBaseRotations: Map<string, THREE.Euler> = new Map();

  // Cached direct bone references for zero per-frame lookups
  private saddleBoneRef: THREE.Object3D | null = null;
  private backBoneRef: THREE.Bone | null = null;
  private neck1BoneRef: THREE.Bone | null = null;
  private neck2BoneRef: THREE.Bone | null = null;
  private headBoneRef: THREE.Bone | null = null;
  private neck1BaseRot: THREE.Euler | null = null;
  private neck2BaseRot: THREE.Euler | null = null;

  // Dynamic physical reins
  private reinsMesh: THREE.LineSegments;
  private reinGeom: THREE.BufferGeometry;
  private reinPositions: Float32Array;

  // Kinematic parameters
  public prevDistance = 0;
  public distance = 0;
  public baseSpeed = BASE_SPEED;
  public maxSpeed = MAX_SPEED;
  public accelRate = 0.2;
  public speed = BASE_SPEED;
  public lateralOffset = 0; // u across track width [-3.5, 3.5]
  public lateralVelocity = 0;
  public difficulty: DifficultyPreset = 'standard';

  private gallopPhase = 0;
  private isCrashed = false;

  public readonly maxLateralOffset = MAX_LATERAL_OFFSET;
  public readonly steerMaxSpeed = STEER_MAX_SPEED; // Responsive high-speed lateral agility
  private readonly riderBaseY = 1.22;
  private readonly riderBaseZ = 0.0;

  public setDifficulty(preset: DifficultyPreset): void {
    this.difficulty = preset;
    const config = DIFFICULTY_PRESETS[preset] || DIFFICULTY_PRESETS.standard;
    this.baseSpeed = config.baseSpeed;
    this.maxSpeed = config.maxSpeed;
    this.accelRate = config.accelRate;
    if (this.distance === 0) {
      this.speed = this.baseSpeed;
    }
  }

  constructor(scene: THREE.Scene, spline: SplineTrack) {
    this.spline = spline;
    this.rootGroup = new THREE.Group();

    this.horseMesh = new HorseMesh();
    this.girlRider = new GirlRiderEntity();

    // Attach girl rider to horse saddle
    this.horseMesh.saddleGroup.add(this.girlRider.rootGroup);
    this.rootGroup.add(this.horseMesh.rootGroup);

    // Dynamic reins connecting horse bit to rider hands
    this.reinGeom = new THREE.BufferGeometry();
    this.reinPositions = new Float32Array(4 * 3); // 2 lines: bitL -> handL, bitR -> handR
    this.reinGeom.setAttribute('position', new THREE.BufferAttribute(this.reinPositions, 3));
    const reinMat = new THREE.LineBasicMaterial({
      color: 0x2e1a0f, // rich bridle leather
      linewidth: 2,
      depthWrite: true
    });
    this.reinsMesh = new THREE.LineSegments(this.reinGeom, reinMat);
    this.rootGroup.add(this.reinsMesh);

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

        // Collect horse bone references and store base rest rotations with alias support
        loaded.scene.traverse((child) => {
          if ((child as THREE.Bone).isBone) {
            const bone = child as THREE.Bone;
            this.horseBones.set(bone.name, bone);
            this.horseBaseRotations.set(bone.name, bone.rotation.clone());

            // Support both dotted and undotted names (e.g. FrontShoulder.L <-> FrontShoulderL)
            if (bone.name.endsWith('L') || bone.name.endsWith('R')) {
              const dotted = bone.name.replace(/([LR])$/, '.$1');
              this.horseBones.set(dotted, bone);
              this.horseBaseRotations.set(dotted, bone.rotation.clone());
            }
            if (bone.name.includes('.')) {
              const undotted = bone.name.replace(/\./g, '');
              this.horseBones.set(undotted, bone);
              this.horseBaseRotations.set(undotted, bone.rotation.clone());
            }
          }
        });

        // Cache direct bone references once to eliminate Map lookups in the render loop
        this.saddleBoneRef =
          this.customModel.saddleBone ||
          this.horseBones.get('Torso2') ||
          this.horseBones.get('Torso') ||
          null;
        this.backBoneRef = this.horseBones.get('Back') || this.horseBones.get('Torso') || null;
        this.neck1BoneRef = this.horseBones.get('Neck1') || null;
        this.neck2BoneRef = this.horseBones.get('Neck2') || null;
        this.headBoneRef = this.horseBones.get('Head') || null;

        if (this.neck1BoneRef) this.neck1BaseRot = this.neck1BoneRef.rotation.clone();
        if (this.neck2BoneRef) this.neck2BaseRot = this.neck2BoneRef.rotation.clone();

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

    // 1. Arc-length compensated forward progression: uniform ground speed along curves
    this.prevDistance = this.distance;
    const dPds = this.spline.getArcLengthFactor(this.distance);
    const ds = (this.speed * dt) / dPds;
    this.distance += ds;

    this.speed = Math.min(this.maxSpeed, this.baseSpeed + this.accelRate * Math.sqrt(Math.max(0, this.distance)));

    // 2. Lateral Left/Right steering with snappy responsive damping
    const targetLateralVel = steer * this.steerMaxSpeed;
    this.lateralVelocity += (targetLateralVel - this.lateralVelocity) * (1.0 - Math.exp(-18.0 * dt));

    this.lateralOffset += this.lateralVelocity * dt;

    // Boundary clamp & velocity zeroing so horse doesn't lean into boundary wall
    if (this.lateralOffset >= this.maxLateralOffset) {
      this.lateralOffset = this.maxLateralOffset;
      if (this.lateralVelocity > 0) {
        this.lateralVelocity = 0;
      }
    } else if (this.lateralOffset <= -this.maxLateralOffset) {
      this.lateralOffset = -this.maxLateralOffset;
      if (this.lateralVelocity < 0) {
        this.lateralVelocity = 0;
      }
    }

    // 3. Spline position & orientation on curved track
    this.updateTransform();

    // 4. Update Gallop Animation & Spine Synchronization
    const strideFreq = 4.4 * (this.speed / 18.0); // 4.4 Hz energetic racing gallop
    let saddleElevation = this.riderBaseY;
    let saddleZ = this.riderBaseZ;
    let saddlePitchDelta = 0;

    if (this.customModel && this.customModel.mixer) {
      // Advance embedded animation mixer at high-speed rate
      const mixerSpeed = (this.speed / 18.0) * 1.6;
      this.customModel.mixer.update(dt * mixerSpeed);

      // Synchronize gallop phase precisely with the glTF gallop clip
      if (this.customModel.gallopAction && this.customModel.gallopDuration) {
        const clipTime = this.customModel.gallopAction.time % this.customModel.gallopDuration;
        this.gallopPhase = (clipTime / this.customModel.gallopDuration) * Math.PI * 2;
      } else {
        this.gallopPhase += dt * strideFreq * Math.PI * 2;
      }

      // Update world matrices of horse bones
      this.customModel.scene.updateMatrixWorld(true);

      // Sample horse's actual spine/back motion using cached bone references
      const saddleBone = this.saddleBoneRef;
      const backBone = this.backBoneRef;

      if (saddleBone) {
        saddleBone.getWorldPosition(_saddleWorld);
        this.rootGroup.worldToLocal(_saddleLocal.copy(_saddleWorld));
        // Elevation above Torso2 to seat the pelvis firmly on the horse saddle
        saddleElevation = _saddleLocal.y + 0.17;
        saddleZ = _saddleLocal.z + 0.22;
      }

      if (saddleBone && backBone) {
        backBone.getWorldPosition(_backWorld);
        this.rootGroup.worldToLocal(_backLocal.copy(_backWorld));
        const spineDy = _saddleLocal.y - _backLocal.y;
        const spineDz = _saddleLocal.z - _backLocal.z;
        const currentPitch = Math.atan2(spineDy, spineDz);
        // Rest pitch is ~ -0.12 rad (-7 deg)
        saddlePitchDelta = currentPitch - -0.12;
      }

      // Neck & Head cadence using cached bone references
      if (this.neck1BoneRef && this.neck1BaseRot) {
        this.neck1BoneRef.rotation.y = this.neck1BaseRot.y - Math.cos(this.gallopPhase) * 0.09;
      }
      if (this.neck2BoneRef && this.neck2BaseRot) {
        this.neck2BoneRef.rotation.y = this.neck2BaseRot.y - Math.cos(this.gallopPhase) * 0.07;
      }

      // Unified single-source vertical and pitch mount suspension on custom glTF horse
      this.girlRider.rootGroup.position.set(0, saddleElevation, saddleZ);
      this.girlRider.rootGroup.rotation.x = saddlePitchDelta * 0.35;
    } else {
      this.horseMesh.animateGallop(this.gallopPhase);
      this.gallopPhase += dt * strideFreq * Math.PI * 2;
      saddleElevation = 1.45 + Math.sin(this.gallopPhase * 2.0) * 0.08 + 0.15;
      saddlePitchDelta = Math.cos(this.gallopPhase) * 0.08;
      // In procedural mode, girlRider.rootGroup is a child of horseMesh.saddleGroup
      this.girlRider.rootGroup.position.set(0, 0, 0);
      this.girlRider.rootGroup.rotation.x = -saddlePitchDelta * 0.65;
    }

    // Multi-joint equestrian kinematics
    this.girlRider.updateKinematics(
      this.gallopPhase,
      this.lateralVelocity,
      this.speed,
      dt,
      saddleElevation - this.riderBaseY,
      saddlePitchDelta
    );

    // Update world matrices before computing rein endpoints so reins never lag by 1 frame
    this.rootGroup.updateMatrixWorld(true);
    this.updateReins();
  }

  private updateReins(): void {
    if (!this.reinsMesh.visible) {
      return;
    }

    // 1. Bit positions on horse head
    if (this.customModel && this.headBoneRef) {
      this.headBoneRef.localToWorld(_bitLWorld.set(-0.15, 0.7, 0.0));
      this.headBoneRef.localToWorld(_bitRWorld.set(0.15, 0.7, 0.0));
    } else {
      this.horseMesh.getBitPositions(_bitLWorld, _bitRWorld);
    }

    // 2. Hand positions on rider
    this.girlRider.getHandPositions(_handLWorld, _handRWorld);

    // 3. Transform to rootGroup space
    this.rootGroup.worldToLocal(_r1.copy(_bitLWorld));
    this.rootGroup.worldToLocal(_r2.copy(_handLWorld));
    this.rootGroup.worldToLocal(_r3.copy(_bitRWorld));
    this.rootGroup.worldToLocal(_r4.copy(_handRWorld));

    // 4. Update vertex buffer for line segments
    this.reinPositions[0] = _r1.x;
    this.reinPositions[1] = _r1.y;
    this.reinPositions[2] = _r1.z;

    this.reinPositions[3] = _r2.x;
    this.reinPositions[4] = _r2.y;
    this.reinPositions[5] = _r2.z;

    this.reinPositions[6] = _r3.x;
    this.reinPositions[7] = _r3.y;
    this.reinPositions[8] = _r3.z;

    this.reinPositions[9] = _r4.x;
    this.reinPositions[10] = _r4.y;
    this.reinPositions[11] = _r4.z;

    this.reinGeom.attributes.position.needsUpdate = true;
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
      this.reinsMesh.visible = false;
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
    this.prevDistance = 0;
    this.distance = 0;
    this.speed = this.baseSpeed;
    this.lateralOffset = 0;
    this.lateralVelocity = 0;
    this.gallopPhase = 0;
    this.isCrashed = false;
    this.horseMesh.rootGroup.rotation.set(0, 0, 0);
    this.horseMesh.rootGroup.position.set(0, 0, 0);
    if (this.customModel) {
      this.customModel.scene.rotation.set(0, 0, 0);
      this.customModel.scene.position.set(0, 0, 0);
      this.girlRider.rootGroup.position.set(0, this.riderBaseY, this.riderBaseZ);
    } else {
      this.girlRider.rootGroup.position.set(0, 0, 0);
    }
    this.girlRider.rootGroup.rotation.set(0, 0, 0);
    this.girlRider.reset();
    this.reinsMesh.visible = true;
    this.updateTransform();
  }

  public dispose(): void {
    if (this.customModel) {
      this.customModel.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        }
      });
    }
    this.horseMesh.dispose();
    this.girlRider.dispose();
    this.reinGeom.dispose();
    (this.reinsMesh.material as THREE.Material).dispose();
  }
}
