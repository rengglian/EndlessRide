import * as THREE from 'three';

const _tangent = new THREE.Vector3();
const _upTmp = new THREE.Vector3();

export class SplineTrack {
  public static readonly LANE_OFFSETS = {
    left: -2.3,
    center: 0.0,
    right: 2.3
  };

  public static readonly HALF_WIDTH = 3.8;

  /**
   * Sample the central spine position at arc-length distance s.
   */
  public getPointAtDistance(s: number, outPoint: THREE.Vector3): void {
    const validS = isNaN(s) ? 0 : s;
    const x = 14.0 * Math.sin(0.012 * validS) + 6.0 * Math.sin(0.028 * validS + 1.2);
    const y = 3.5 * Math.sin(0.018 * validS);
    const z = validS;
    outPoint.set(x, y, z);
  }

  /**
   * Sample the forward normalized tangent vector at distance s.
   */
  public getTangentAtDistance(s: number, outTangent: THREE.Vector3): void {
    const validS = isNaN(s) ? 0 : s;
    const dx = 14.0 * 0.012 * Math.cos(0.012 * validS) + 6.0 * 0.028 * Math.cos(0.028 * validS + 1.2);
    const dy = 3.5 * 0.018 * Math.cos(0.018 * validS);
    const dz = 1.0;
    outTangent.set(dx, dy, dz).normalize();
  }

  /**
   * Sample the horizontal rightward lateral normal vector at distance s.
   * Tangent(dx,dy,dz) x UP(0,1,0) = (-dz, 0, dx) pointing toward -X (screen-right).
   */
  public getNormalAtDistance(s: number, outNormal: THREE.Vector3): void {
    this.getTangentAtDistance(s, _tangent);
    const hNx = -_tangent.z;
    const hNz = _tangent.x;
    const len = Math.hypot(hNx, hNz) || 1.0;
    outNormal.set(hNx / len, 0, hNz / len);
  }

  /**
   * Compute banking roll angle in radians at distance s.
   * Curve bending toward +X (screen-left, d2x > 0) produces negative roll angle to lean left.
   * Curve bending toward -X (screen-right, d2x < 0) produces positive roll angle to lean right.
   */
  public getBankingAngleAtDistance(s: number, forwardSpeed = 12.0): number {
    const validS = isNaN(s) ? 0 : s;
    const validSpeed = isNaN(forwardSpeed) ? 12.0 : forwardSpeed;

    const d2x = -14.0 * 0.012 * 0.012 * Math.sin(0.012 * validS) - 6.0 * 0.028 * 0.028 * Math.sin(0.028 * validS + 1.2);
    const curvature = Math.abs(d2x);
    const sign = d2x > 0 ? -1 : 1;
    const g = 9.81;
    const rawBank = (validSpeed * validSpeed * curvature) / g;
    return THREE.MathUtils.clamp(sign * rawBank * 2.0, -0.22, 0.22);
  }

  /**
   * Computes the complete banked frame (center position, tangent, banked lateral, banked up) at distance s.
   * Returns banking angle in radians.
   */
  public getBankedFrameAt(
    s: number,
    outPos: THREE.Vector3,
    outTangent: THREE.Vector3,
    outLateral: THREE.Vector3,
    outUp: THREE.Vector3,
    forwardSpeed = 12.0
  ): number {
    const validS = isNaN(s) ? 0 : s;
    this.getPointAtDistance(validS, outPos);
    this.getTangentAtDistance(validS, outTangent);
    this.getNormalAtDistance(validS, outLateral); // Unbanked rightward normal

    const normX = outLateral.x;
    const normZ = outLateral.z;

    // Orthonormal Up = (Tangent x Lateral) / |Tangent x Lateral|:
    // Using horizontal normal length hLen = sqrt((tx*normZ - tz*normX)^2) = sqrt(tx^2 + tz^2)
    const upY = normZ * outTangent.x - normX * outTangent.z;
    const upX = -outTangent.y * normZ;
    const upZ = outTangent.y * normX;

    const bank = this.getBankingAngleAtDistance(validS, forwardSpeed);
    const cosB = Math.cos(bank);
    const sinB = Math.sin(bank);

    // Right-hand rule rotation around Tangent (+Z) by angle bank:
    // Positive bank (d2x < 0, turn right toward -X) lowers the right edge (+u) and raises the left edge (-u).
    outLateral.set(
      normX * cosB + upX * sinB,
      upY * sinB,
      normZ * cosB + upZ * sinB
    );

    outUp.set(
      -normX * sinB + upX * cosB,
      upY * cosB,
      -normZ * sinB + upZ * cosB
    );

    return bank;
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

    // Apply lateral offset along banked rightward normal
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
