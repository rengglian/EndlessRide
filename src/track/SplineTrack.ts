import * as THREE from 'three';
import {
  GEOMETRIC_BANK_SPEED,
  LANE_OFFSETS,
  PATH_HALF_WIDTH
} from '../config';
import {
  sampleSplinePoint,
  sampleSplineTangent,
  sampleArcLengthFactor,
  computeGeometricBankAngle,
  computeVisualBankAngle,
  computeBankedFrame,
  getGroundHeightAtOffset,
  getGroundSlopeAtOffset
} from './trackMath';

const _upTmp = new THREE.Vector3();

export class SplineTrack {
  public static readonly LANE_OFFSETS = LANE_OFFSETS;
  public static readonly HALF_WIDTH = PATH_HALF_WIDTH;

  /**
   * Sample the central spine position at arc-length parameter s.
   */
  public getPointAtDistance(s: number, outPoint: THREE.Vector3): void {
    const pt = sampleSplinePoint(s);
    outPoint.set(pt.x, pt.y, pt.z);
  }

  /**
   * Sample the forward normalized tangent vector at parameter s.
   */
  public getTangentAtDistance(s: number, outTangent: THREE.Vector3): void {
    const tan = sampleSplineTangent(s);
    outTangent.set(tan.x, tan.y, tan.z);
  }

  /**
   * Arc-length scaling factor |dP/ds|. True ground advance ds = (speed * dt) / factor (Sec 3.4).
   */
  public getArcLengthFactor(s: number): number {
    return sampleArcLengthFactor(s);
  }

  /**
   * Sample the unbanked horizontal rightward lateral normal vector at parameter s.
   */
  public getNormalAtDistance(s: number, outNormal: THREE.Vector3): void {
    const tan = sampleSplineTangent(s);
    const hNx = -tan.z;
    const hNz = tan.x;
    const len = Math.hypot(hNx, hNz) || 1.0;
    outNormal.set(hNx / len, 0, hNz / len);
  }

  /**
   * Intrinsic geometric banking angle of the track geometry (speed-independent, Sec 3.3).
   */
  public getGeometricBankAngle(s: number): number {
    return computeGeometricBankAngle(s);
  }

  /**
   * Speed-dependent banking angle in radians for visual lean/HUD (Sec 3.3).
   */
  public getVisualBankAngle(s: number, speed: number): number {
    return computeVisualBankAngle(s, speed);
  }

  /**
   * Compute banking roll angle in radians at parameter s.
   * If forwardSpeed equals GEOMETRIC_BANK_SPEED (12.0), returns geometric track bank;
   * otherwise returns speed-scaled visual bank angle.
   */
  public getBankingAngleAtDistance(s: number, forwardSpeed: number = GEOMETRIC_BANK_SPEED): number {
    if (forwardSpeed === GEOMETRIC_BANK_SPEED) {
      return computeGeometricBankAngle(s);
    }
    return computeVisualBankAngle(s, forwardSpeed);
  }

  /**
   * Computes the complete banked frame (center position, tangent, banked lateral, banked up) at parameter s.
   * Returns banking angle in radians.
   */
  public getBankedFrameAt(
    s: number,
    outPos: THREE.Vector3,
    outTangent: THREE.Vector3,
    outLateral: THREE.Vector3,
    outUp: THREE.Vector3,
    forwardSpeed: number = GEOMETRIC_BANK_SPEED
  ): number {
    const frame = computeBankedFrame(s, forwardSpeed);
    outPos.set(frame.point.x, frame.point.y, frame.point.z);
    outTangent.set(frame.tangent.x, frame.tangent.y, frame.tangent.z);
    outLateral.set(frame.lateral.x, frame.lateral.y, frame.lateral.z);
    outUp.set(frame.up.x, frame.up.y, frame.up.z);
    return frame.bankAngle;
  }

  /**
   * Get terrain ground surface height at lateral offset u.
   */
  public getGroundHeight(u: number): number {
    return getGroundHeightAtOffset(u);
  }

  /**
   * Get terrain cross-section slope dh/du at lateral offset u.
   */
  public getGroundSlope(u: number): number {
    return getGroundSlopeAtOffset(u);
  }

  /**
   * Compute complete transform (position, orientation) given forward distance and lateral offset,
   * accounting for the banked track surface elevation.
   */
  public getTransformAt(
    distance: number,
    lateralOffset: number,
    outPos: THREE.Vector3,
    outTangent: THREE.Vector3,
    outNormal: THREE.Vector3
  ): void {
    const validDist = isNaN(distance) ? 0 : distance;
    const validOffset = isNaN(lateralOffset) ? 0 : lateralOffset;

    this.getBankedFrameAt(validDist, outPos, outTangent, outNormal, _upTmp);
    outPos.addScaledVector(outNormal, validOffset);
  }

  /**
   * Compute complete transform including terrain ground height offset along the banked up normal.
   */
  public getBankedTransformAt(
    distance: number,
    lateralOffset: number,
    groundHeight: number,
    outPos: THREE.Vector3,
    outTangent: THREE.Vector3,
    outNormal: THREE.Vector3,
    outUp: THREE.Vector3
  ): void {
    const validDist = isNaN(distance) ? 0 : distance;
    const validOffset = isNaN(lateralOffset) ? 0 : lateralOffset;
    const validH = isNaN(groundHeight) ? 0 : groundHeight;

    this.getBankedFrameAt(validDist, outPos, outTangent, outNormal, outUp);
    outPos.addScaledVector(outNormal, validOffset);
    outPos.addScaledVector(outUp, validH);
  }
}
