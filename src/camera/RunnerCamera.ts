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

  constructor(camera: THREE.PerspectiveCamera, spline: SplineTrack) {
    this.camera = camera;
    this.spline = spline;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rigidly locked rear-follow camera directly behind the horse's back with dynamic FOV speed warp.
   */
  public update(
    horsePos: THREE.Vector3,
    horseTangent: THREE.Vector3,
    horseSpeed: number,
    deltaTime: number
  ): void {
    const dt = isNaN(deltaTime) || deltaTime <= 0 ? 0.0166 : Math.min(deltaTime, 0.05);
    const speed = isNaN(horseSpeed) ? 18.0 : horseSpeed;

    // 1. Dynamic speed-based Field of View (FOV warp effect for intense sensation of speed)
    const targetFov = this.baseFov + THREE.MathUtils.clamp((speed - 18.0) * 0.9, 0, 14);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1.0 - Math.exp(-5.0 * dt));
      this.camera.updateProjectionMatrix();
    }

    // 2. Position camera closer and lower behind the horse for strong ground rush
    _camPos.copy(horsePos)
      .addScaledVector(horseTangent, -this.followDistance);
    _camPos.y += this.cameraHeight;

    // 3. Look target down the track
    _lookTarget.copy(horsePos)
      .addScaledVector(horseTangent, this.lookAheadDistance);
    _lookTarget.y += 1.15;

    // 4. Stable upright horizon
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(_camPos);
    this.camera.lookAt(_lookTarget);
  }

  public reset(): void {
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }
}
