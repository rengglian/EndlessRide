# Subagent: Godot Gameplay & Kinematics Engineer (`godot-gameplay-animator`)

## Role & Description
Specialized Gameplay Physics, Kinematics, and Object Pooling Engineer responsible for porting horse runner controls, analytical ground suspension, rider procedural animations, obstacle/collectible pools, and swept collision detection to Godot 4.

---

## Directives & Responsibilities

1. **Horse Locomotion Controller (`HorseRunnerController.cs`)**:
   - Continuous forward track gallop along 3D track splines ($14\text{ m/s}$ to $35\text{ m/s}$).
   - Speed-scaled animation playback cadence matching stride frequency.
   - Left/Right responsive lateral steering with acceleration, damping, and track width clamping ($u \in [-3.5, 3.5]\text{m}$).
   - Centrifugal banking body roll ($\theta_{\text{roll}} \propto -\dot{u}$) and curve banking alignment.
   - 4-point terrain suspension (FL, FR, RL, RR) sampling track elevation and normal.

2. **Procedural Rider Kinematics (`GirlRiderEntity.cs`)**:
   - Vertical pelvic bounce ($4.0\text{ Hz}$) synchronized with horse stride cadence.
   - Wind-tuck forward lean scaling with forward speed.
   - Reactive lateral dodge lean into sharp steering maneuvers.
   - Procedural bridle reins rendered via `ImmediateMesh` or Bezier curve ribbons.

3. **Obstacle & Collectible Systems (`ObstacleManager.cs`, `CollectibleManager.cs`)**:
   - Zero-allocation pre-allocated object pools (`ObstaclePool.cs`, `CollectiblePool.cs`).
   - Deterministic procedural wave spawning along lane offsets ($u = -2.3, 0.0, 2.3\text{m}$).
   - Apples (`+25` pts, `+0.2x` multiplier) and Horseshoes (`+75` pts, `+0.5x` multiplier).
   - Analytical swept longitudinal interval AABB collision in $(s, u)$ space to prevent tunneling at high speeds.
