import * as THREE from 'three';
import { SplineTrack } from '../track/SplineTrack';

const _camPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export class RunnerCamera {
  public camera: THREE.PerspectiveCamera;
  public spline: SplineTrack;

  public followDistance = 4.6;
  public cameraHeight = 2.15;
  public lookAheadDistance = 8.5;

  private baseFov = 66;

  // Spring damping state
  private currentCamPos = new THREE.Vector3();
  private currentLookTarget = new THREE.Vector3();
  private currentRoll = 0;
  private isInitialized = false;

  constructor(camera: THREE.PerspectiveCamera, spline: SplineTrack) {
    this.camera = camera;
    this.spline = spline;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Smoothly spring-damped rear-follow camera behind the horse with dynamic FOV speed warp
   * and subtle horizon counter-roll (±1.2°) into turns to filter out 1-frame input jitter.
   */
  public update(
    horsePos: THREE.Vector3,
    horseTangent: THREE.Vector3,
    horseSpeed: number,
    deltaTime: number,
    steerInput = 0
  ): void {
    const dt = isNaN(deltaTime) || deltaTime <= 0 ? 0.0166 : Math.min(deltaTime, 0.05);
    const speed = isNaN(horseSpeed) ? 18.0 : horseSpeed;
    const steer = isNaN(steerInput) ? 0 : THREE.MathUtils.clamp(steerInput, -1.0, 1.0);

    // 1. Dynamic speed-based Field of View (FOV warp effect for intense sensation of speed)
    const targetFov = this.baseFov + THREE.MathUtils.clamp((speed - 18.0) * 0.9, 0, 14);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1.0 - Math.exp(-5.0 * dt));
      this.camera.updateProjectionMatrix();
    }

    // 2. Position camera closer and lower behind the horse for strong ground rush
    _camPos.copy(horsePos).addScaledVector(horseTangent, -this.followDistance);
    _camPos.y += this.cameraHeight;

    // 3. Look target down the track
    _lookTarget.copy(horsePos).addScaledVector(horseTangent, this.lookAheadDistance);
    _lookTarget.y += 1.15;

    // 4. Smooth exponential spring damping to eliminate rigid snapping and input jitter
    if (!this.isInitialized) {
      this.currentCamPos.copy(_camPos);
      this.currentLookTarget.copy(_lookTarget);
      this.isInitialized = true;
    } else {
      const posAlpha = 1.0 - Math.exp(-14.0 * dt);
      const lookAlpha = 1.0 - Math.exp(-12.0 * dt);
      this.currentCamPos.lerp(_camPos, posAlpha);
      this.currentLookTarget.lerp(_lookTarget, lookAlpha);
    }

    // 5. Subtle camera horizon counter-roll (±1.2° into steering/turns)
    const targetRoll = -steer * (1.2 * (Math.PI / 180));
    const rollAlpha = 1.0 - Math.exp(-8.0 * dt);
    this.currentRoll += (targetRoll - this.currentRoll) * rollAlpha;

    // 6. Upright horizon with counter-roll applied
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentLookTarget);

    if (Math.abs(this.currentRoll) > 0.0001) {
      this.camera.rotateZ(this.currentRoll);
    }
  }

  public reset(): void {
    this.isInitialized = false;
    this.currentRoll = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }
}
