import * as THREE from 'three';

export class HorseMesh {
  public rootGroup: THREE.Group;
  public saddleGroup: THREE.Group;
  public bitLeftPos: THREE.Vector3 = new THREE.Vector3();
  public bitRightPos: THREE.Vector3 = new THREE.Vector3();

  // Skeletal leg nodes for articulated quadruped gallop
  private legFL!: THREE.Group;
  private legFR!: THREE.Group;
  private legRL!: THREE.Group;
  private legRR!: THREE.Group;

  private lowerFL!: THREE.Group;
  private lowerFR!: THREE.Group;
  private lowerRL!: THREE.Group;
  private lowerRR!: THREE.Group;

  private tailGroup!: THREE.Group;
  private neckGroup!: THREE.Group;
  private headGroup!: THREE.Group;
  private torsoGroup!: THREE.Group;

  // Materials
  private coatMat: THREE.MeshStandardMaterial;
  private darkMat: THREE.MeshStandardMaterial;
  private whiteMarkingMat: THREE.MeshStandardMaterial;
  private leatherMat: THREE.MeshStandardMaterial;
  private metalMat: THREE.MeshStandardMaterial;
  private hoofMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.saddleGroup = new THREE.Group();

    // Warm Bay / Chestnut horse coat with subtle sheen
    this.coatMat = new THREE.MeshStandardMaterial({
      color: 0x934b1f, // Rich Bay Chestnut
      roughness: 0.55,
      metalness: 0.08,
      flatShading: false
    });

    // Dark brown/black mane, tail, and muzzle
    this.darkMat = new THREE.MeshStandardMaterial({
      color: 0x1f140e,
      roughness: 0.8,
      flatShading: false
    });

    this.whiteMarkingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6
    });

    this.leatherMat = new THREE.MeshStandardMaterial({
      color: 0x2e1a0f, // Dark brown leather tack
      roughness: 0.45,
      metalness: 0.15
    });

    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db, // Brass / Silver stirrups & bit
      roughness: 0.25,
      metalness: 0.85
    });

    this.hoofMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.35,
      metalness: 0.1
    });

    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.1,
      metalness: 0.9
    });

    this.buildAnatomy();
  }

  private buildAnatomy(): void {
    // 1. Torso / Ribcage & Flank
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 1.45, 0);
    this.rootGroup.add(this.torsoGroup);

    // Main barrel body (cylinder with rounded look)
    const barrelGeom = new THREE.CylinderGeometry(0.46, 0.44, 1.6, 12);
    const barrel = new THREE.Mesh(barrelGeom, this.coatMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    this.torsoGroup.add(barrel);

    // Chest / Shoulder Musculature
    const chestGeom = new THREE.SphereGeometry(0.48, 10, 8);
    const chest = new THREE.Mesh(chestGeom, this.coatMat);
    chest.position.set(0, 0.04, 0.7);
    chest.scale.set(0.9, 1.05, 1.0);
    chest.castShadow = true;
    this.torsoGroup.add(chest);

    // Haunches / Rump (Hindquarters)
    const rumpGeom = new THREE.SphereGeometry(0.5, 10, 8);
    const rump = new THREE.Mesh(rumpGeom, this.coatMat);
    rump.position.set(0, 0.06, -0.65);
    rump.scale.set(0.95, 1.08, 1.1);
    rump.castShadow = true;
    this.torsoGroup.add(rump);

    // 2. Saddle, Girth & Stirrups
    const padGeom = new THREE.BoxGeometry(0.85, 0.08, 0.95);
    const pad = new THREE.Mesh(padGeom, this.whiteMarkingMat);
    pad.position.set(0, 0.44, 0.02);
    pad.castShadow = true;
    this.torsoGroup.add(pad);

    const saddleGeom = new THREE.BoxGeometry(0.78, 0.16, 0.72);
    const saddle = new THREE.Mesh(saddleGeom, this.leatherMat);
    saddle.position.set(0, 0.52, 0.02);
    saddle.castShadow = true;
    this.torsoGroup.add(saddle);

    // Cantle (raised back of saddle)
    const cantleGeom = new THREE.BoxGeometry(0.65, 0.22, 0.18);
    const cantle = new THREE.Mesh(cantleGeom, this.leatherMat);
    cantle.position.set(0, 0.6, -0.26);
    cantle.rotation.x = -0.3;
    this.torsoGroup.add(cantle);

    // Stirrup straps and metal irons
    [-0.42, 0.42].forEach((sideX) => {
      const strapGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4);
      const strap = new THREE.Mesh(strapGeom, this.leatherMat);
      strap.position.set(sideX, 0.15, 0.05);
      this.torsoGroup.add(strap);

      const ironGeom = new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI);
      const iron = new THREE.Mesh(ironGeom, this.metalMat);
      iron.position.set(sideX, -0.22, 0.05);
      iron.rotation.z = Math.PI;
      this.torsoGroup.add(iron);
    });

    // Saddle bone for girl rider attachment
    this.saddleGroup.position.set(0, 0.62, 0.04);
    this.torsoGroup.add(this.saddleGroup);

    // 3. Arched Neck & Expressive Head
    this.neckGroup = new THREE.Group();
    this.neckGroup.position.set(0, 0.35, 0.75);
    this.torsoGroup.add(this.neckGroup);

    // Muscular neck
    const neckGeom = new THREE.CylinderGeometry(0.24, 0.38, 0.95, 8);
    const neck = new THREE.Mesh(neckGeom, this.coatMat);
    neck.position.set(0, 0.42, 0.25);
    neck.rotation.x = -0.65;
    neck.castShadow = true;
    this.neckGroup.add(neck);

    // Mane along crest of neck
    const maneGeom = new THREE.BoxGeometry(0.1, 0.95, 0.3);
    const mane = new THREE.Mesh(maneGeom, this.darkMat);
    mane.position.set(0, 0.52, 0.08);
    mane.rotation.x = -0.65;
    this.neckGroup.add(mane);

    // Head
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.8, 0.58);
    this.neckGroup.add(this.headGroup);

    // Forehead / Skull
    const skullGeom = new THREE.BoxGeometry(0.36, 0.35, 0.45);
    const skull = new THREE.Mesh(skullGeom, this.coatMat);
    skull.position.set(0, 0.05, 0.1);
    skull.rotation.x = 0.35;
    skull.castShadow = true;
    this.headGroup.add(skull);

    // White Star marking on forehead
    const starGeom = new THREE.BoxGeometry(0.12, 0.12, 0.02);
    const star = new THREE.Mesh(starGeom, this.whiteMarkingMat);
    star.position.set(0, 0.15, 0.32);
    star.rotation.x = 0.35;
    this.headGroup.add(star);

    // Tapered Muzzle & Nostrils
    const muzzleGeom = new THREE.BoxGeometry(0.26, 0.24, 0.45);
    const muzzle = new THREE.Mesh(muzzleGeom, this.darkMat);
    muzzle.position.set(0, -0.15, 0.42);
    muzzle.rotation.x = 0.45;
    muzzle.castShadow = true;
    this.headGroup.add(muzzle);

    // Eyes
    [-0.19, 0.19].forEach((eyeX) => {
      const eyeGeom = new THREE.SphereGeometry(0.055, 6, 6);
      const eye = new THREE.Mesh(eyeGeom, this.eyeMat);
      eye.position.set(eyeX, 0.1, 0.18);
      this.headGroup.add(eye);
    });

    // Alert Ears
    [-0.12, 0.12].forEach((earX) => {
      const earGeom = new THREE.ConeGeometry(0.07, 0.24, 5);
      const ear = new THREE.Mesh(earGeom, this.coatMat);
      ear.position.set(earX, 0.3, -0.04);
      ear.rotation.x = 0.2;
      ear.rotation.z = earX < 0 ? -0.2 : 0.2;
      this.headGroup.add(ear);
    });

    // Bridle Leather Straps & Bit Rings
    const bitLeft = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 10), this.metalMat);
    bitLeft.position.set(-0.15, -0.14, 0.42);
    this.headGroup.add(bitLeft);

    const bitRight = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 10), this.metalMat);
    bitRight.position.set(0.15, -0.14, 0.42);
    this.headGroup.add(bitRight);

    // 4. Articulated Tail with Tufts
    this.tailGroup = new THREE.Group();
    this.tailGroup.position.set(0, 0.28, -0.92);
    this.torsoGroup.add(this.tailGroup);

    const tailUpperGeom = new THREE.CylinderGeometry(0.08, 0.16, 0.6, 6);
    const tailUpper = new THREE.Mesh(tailUpperGeom, this.darkMat);
    tailUpper.position.set(0, -0.22, -0.1);
    tailUpper.rotation.x = 0.45;
    this.tailGroup.add(tailUpper);

    const tailLowerGeom = new THREE.CylinderGeometry(0.16, 0.08, 0.7, 6);
    const tailLower = new THREE.Mesh(tailLowerGeom, this.darkMat);
    tailLower.position.set(0, -0.68, -0.22);
    tailLower.rotation.x = 0.3;
    this.tailGroup.add(tailLower);

    // 5. Four 2-Segment Articulated Legs
    this.legFL = this.createLeg(-0.35, 0.0, 0.65, false, (lower) => (this.lowerFL = lower));
    this.legFR = this.createLeg(0.35, 0.0, 0.65, false, (lower) => (this.lowerFR = lower));
    this.legRL = this.createLeg(-0.36, 0.0, -0.65, true, (lower) => (this.lowerRL = lower));
    this.legRR = this.createLeg(0.36, 0.0, -0.65, true, (lower) => (this.lowerRR = lower));

    this.torsoGroup.add(this.legFL);
    this.torsoGroup.add(this.legFR);
    this.torsoGroup.add(this.legRL);
    this.torsoGroup.add(this.legRR);
  }

  private createLeg(
    x: number,
    y: number,
    z: number,
    isHind: boolean,
    onLower: (lower: THREE.Group) => void
  ): THREE.Group {
    const hipRoot = new THREE.Group();
    hipRoot.position.set(x, y, z);

    // Upper Thigh / Shoulder
    const upperRadius = isHind ? 0.22 : 0.18;
    const upperGeom = new THREE.CylinderGeometry(upperRadius * 0.8, upperRadius, 0.65, 8);
    const upper = new THREE.Mesh(upperGeom, this.coatMat);
    upper.position.set(0, -0.32, isHind ? -0.06 : 0.04);
    upper.rotation.x = isHind ? -0.25 : 0.2;
    upper.castShadow = true;
    hipRoot.add(upper);

    // Knee / Hock joint (Knee bends forward on front legs, backwards on hind legs)
    const kneeRoot = new THREE.Group();
    kneeRoot.position.set(0, -0.62, isHind ? -0.15 : 0.08);
    hipRoot.add(kneeRoot);
    onLower(kneeRoot);

    // Cannon bone (lower leg)
    const lowerGeom = new THREE.CylinderGeometry(0.09, 0.11, 0.62, 8);
    const lower = new THREE.Mesh(lowerGeom, this.coatMat);
    lower.position.set(0, -0.3, 0);
    lower.castShadow = true;
    kneeRoot.add(lower);

    // White sock markings on lower leg
    const sockGeom = new THREE.CylinderGeometry(0.095, 0.115, 0.22, 8);
    const sock = new THREE.Mesh(sockGeom, this.whiteMarkingMat);
    sock.position.set(0, -0.42, 0);
    kneeRoot.add(sock);

    // Hoof
    const hoofGeom = new THREE.CylinderGeometry(0.11, 0.14, 0.16, 8);
    const hoof = new THREE.Mesh(hoofGeom, this.hoofMat);
    hoof.position.set(0, -0.58, 0.04);
    hoof.rotation.x = 0.15;
    hoof.castShadow = true;
    kneeRoot.add(hoof);

    return hipRoot;
  }

  /**
   * Anatomical gallop stride kinematics with articulated knee joints, neck cadence, and spine flexion.
   */
  public animateGallop(phase: number): void {
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);

    // 1. Spine & Torso Pitch/Roll Flexion during gallop strides
    this.torsoGroup.position.y = 1.45 + Math.sin(phase * 2.0) * 0.08;
    this.torsoGroup.rotation.x = cosP * 0.08;

    // 2. Front Legs (Shoulder + Knee flexion)
    const flPhase = phase;
    const frPhase = phase + 0.5;

    this.legFL.rotation.x = Math.sin(flPhase) * 0.75;
    this.lowerFL.rotation.x = Math.max(0, -Math.sin(flPhase - 0.4) * 0.9);

    this.legFR.rotation.x = Math.sin(frPhase) * 0.75;
    this.lowerFR.rotation.x = Math.max(0, -Math.sin(frPhase - 0.4) * 0.9);

    // 3. Hind Legs (Hip + Hock backward flexion)
    const rlPhase = phase + Math.PI;
    const rrPhase = phase + Math.PI + 0.4;

    this.legRL.rotation.x = Math.sin(rlPhase) * 0.85;
    this.lowerRL.rotation.x = Math.min(0, Math.sin(rlPhase) * 0.95);

    this.legRR.rotation.x = Math.sin(rrPhase) * 0.85;
    this.lowerRR.rotation.x = Math.min(0, Math.sin(rrPhase) * 0.95);

    // 4. Dynamic Tail & Mane Wind Sway
    this.tailGroup.rotation.x = 0.35 + sinP * 0.25;
    this.tailGroup.rotation.z = Math.sin(phase * 2.0) * 0.22;

    // 5. Neck Cadence (bobbing in sync with stride)
    this.neckGroup.rotation.x = -cosP * 0.14;
    this.headGroup.rotation.x = sinP * 0.1;
  }

  public dispose(): void {
    this.coatMat.dispose();
    this.darkMat.dispose();
    this.whiteMarkingMat.dispose();
    this.leatherMat.dispose();
    this.metalMat.dispose();
    this.hoofMat.dispose();
    this.eyeMat.dispose();
  }
}
