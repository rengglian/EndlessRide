---
name: horse-controller
description: >-
  Comprehensive guide and production implementation patterns for endless runner horse locomotion along curved splines, Left/Right lateral steering physics, 4-point raycast track suspension, two-bone analytical hoof IK, dynamic girl rider kinematics, and high-speed gallop tuning. Use when developing or tuning runner mechanics.
---

# Horse Controller & Kinematic Runner Skill

This skill documents the complete architectural and mathematical specifications for implementing realistic, responsive horse locomotion in an endless runner, tracking curved path splines, handling Left/Right lateral steering, conforming to track banking, solving equestrian rider posture, and delivering high-speed racing sensations.

---

## 1. High-Speed Runner Locomotion & Progression

In an endless runner, the horse automatically gallops forward along a continuous 3D track curve $\vec{C}(s)$, where $s$ is the arc-length progress along the track.

### Forward Progression & Speed Scaling:
*   **Base Gallop Speed ($v_0$)**: **$18.0\text{ m/s}$ ($65\text{ km/h}$)**.
*   **Top Gallop Speed ($v_{\max}$)**: **$30.0\text{ m/s}$ ($108\text{ km/h}$)**.
*   **Speed Scaling Equation**:
    $$v(s) = \min\left(30.0, 18.0 + 0.12 \cdot \sqrt{s}\right)$$
*   **Stride Frequency & Animation Synchronization**:
    *   Base stride cadence: $4.4\text{ Hz}$.
    *   Dynamic stride frequency: $f_{\text{stride}}(v) = 4.4 \cdot \frac{v}{18.0}\text{ Hz}$.
    *   Three.js AnimationMixer `timeScale`: $1.6 \cdot \frac{v}{18.0}$.

```typescript
export class HorseRunnerController {
  public speed = 18.0;
  public distance = 0;
  public lateralOffset = 0;
  private maxLateralOffset = 3.3; // Track boundary limit
  private lateralVelocity = 0;

  public updateProgression(deltaTime: number): void {
    this.distance += this.speed * deltaTime;
    this.speed = Math.min(30.0, 18.0 + 0.12 * Math.sqrt(this.distance));
  }
}
```

---

## 2. Left / Right Lateral Steering & Centrifugal Banking

The player steers laterally across the track width ($[-3.3\text{m}, +3.3\text{m}]$) to dodge obstacles and navigate curves.

### Lateral Steering Equations of Motion:
Let $u_{\text{in}} \in [-1.0, 1.0]$ be the lateral input from keyboard, touch, or wireless IMU:

1.  **Lateral Steering Agility**:
    $$\dot{u} = \text{lerp}\left(\dot{u}, u_{\text{in}} \cdot v_{\text{steer}}, 1.0 - e^{-k_{\text{steer}} \cdot \Delta t}\right)$$
    Where $v_{\text{steer}} = 12.0\text{ m/s}$ and $k_{\text{steer}} = 16.0\text{ s}^{-1}$.
2.  **Position Integration**:
    $$u = \text{clamp}(u + \dot{u} \cdot \Delta t, -u_{\max}, +u_{\max})$$
3.  **Centrifugal Body Banking (Roll)**:
    When dodging laterally or navigating curves, the horse rolls subtly into the turn:
    $$\theta_{\text{roll}} = \text{clamp}\left(-\frac{\dot{u}}{12.0} \cdot 0.10, -0.09, 0.09\right) \quad (\approx \pm 5.2^\circ)$$
4.  **Front Leg Reach & Procedural Additive Locomotion**:
    Additive pitch oscillations on `FrontShoulder.L/R`, `FrontUpperLeg.L/R`, and `FrontLowerLeg.L/R` synchronized to the stride phase to heighten front-leg drive and ground clearance.

---

## 3. Dynamic Runner Camera Framing

The camera is rigidly locked behind the horse to provide stable, disorient-free third-person tracking with speed-dependent ground rush:

*   **Follow Distance**: $4.6\text{m}$ behind the saddle girth.
*   **Camera Height**: $2.15\text{m}$ above the track surface.
*   **Look-Ahead Target**: $8.5\text{m}$ forward along the spline tangent.
*   **Upright Level Horizon**: `camera.up.set(0, 1, 0)` is strictly maintained (no roll tilt).
*   **Dynamic FOV Speed Warp**:
    $$\text{FOV} = 66^\circ + \text{clamp}\left(\frac{v - 18.0}{30.0 - 18.0}, 0, 1\right) \cdot 12^\circ \implies [66^\circ \to 78^\circ]$$

---

## 4. Girl Rider Kinematic Bone Posing

The modular adventurer rider (`Adventurer.gltf`) sits firmly on the horse saddle:

*   **Pelvis Origin Alignment**: Root group offset by $-0.94 \times \text{scale}$ to position pelvis at $(0, 0, 0)$.
*   **Saddle Mount Point**: $Y = 1.22\text{m}, Z = 0.0\text{m}$ (directly over horse saddle girth).
*   **Equestrian Bone Posture**:
    *   `UpperLeg.L/R`: Flared outward and angled forward into stirrups.
    *   `LowerLeg.L/R`: Bent at knees tucked against the horse flanks.
    *   `UpperArm.L/R` & `LowerArm.L/R`: Elbows bent holding imaginary reins.
    *   `Spine` / `Chest`: Upright forward posture with dynamic centrifugal roll lean into turns:
        $$\text{RiderRoll} = -\frac{\dot{u}}{8.5} \cdot 0.28\text{ rad}$$
