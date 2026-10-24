---
name: procedural-terrain
description: >-
  Provides end-to-end procedures for procedural curved track generation, 72m wide rolling meadow terrain, light cobblestone paving & fine gravel procedural shader, Web Worker generation, obstacle lane distribution, and grounded roadside scenery streaming. Use when implementing or optimizing track and environment systems.
---

# Procedural Curved Track & Scenery Generation Skill

This skill provides step-by-step guidance, mathematical specifications, and production-ready code patterns for building an infinite procedural curved track and rolling countryside terrain system for an endless runner optimized for 60 FPS performance.

---

## 1. Spline-Based Track Curve Math

The runner path is modeled as a continuous 3D space curve $\vec{C}(s)$, where $s \in [0, \infty)$ is the arc length along the path:

*   **Horizontal Curvature ($X$)**:
    $$X(s) = 14.0 \sin(0.012 s) + 6.0 \sin(0.028 s + 1.2)$$
*   **Vertical Elevation ($Y$)**:
    $$Y(s) = 3.5 \sin(0.018 s)$$
*   **Forward Progression ($Z$)**:
    $$Z(s) = s$$
*   **Rightward Lateral Normal $\vec{N}_{\text{right}}$**:
    $$\vec{N}_{\text{right}} = \text{normalize}\left(\begin{bmatrix} \vec{T}_z \\ 0 \\ -\vec{T}_x \end{bmatrix}\right)$$

---

## 2. 72m Broad Countryside Cross-Section & Elevation Profile

To prevent narrow floating ribbons and blue void drop-offs, the terrain extends across a **$72\text{m}$ broad cross-section** ($11$ vertices per slice):

| Offset $u$ ($m$) | Height $h(u)$ ($m$) | Terrain Region |
| :--- | :--- | :--- |
| **$-36.0$ to $-18.0$** | **$-0.8 \to +0.6$** | Outer Left Meadow Hills |
| **$-18.0$ to $-6.5$** | **$+0.6 \to +0.25$** | Mid Left Rolling Meadow |
| **$-6.5$ to $-4.0$** | **$+0.25 \to +0.12$** | Inner Left Meadow Skirt |
| **$-4.0$ to $-3.8$** | **$+0.12 \to 0.0$** | Left Stone Curb Trim |
| **$-3.8$ to $+3.8$** | **$0.0$** | **Playable Cobblestone & Gravel Path ($7.6\text{m}$ wide)** |
| **$+3.8$ to $+4.0$** | **$0.0 \to +0.12$** | Right Stone Curb Trim |
| **$+4.0$ to $+6.5$** | **$+0.12 \to +0.25$** | Inner Right Meadow Skirt |
| **$+6.5$ to $+18.0$** | **$+0.25 \to +0.6$** | Mid Right Rolling Meadow |
| **$+18.0$ to $+36.0$** | **$+0.6 \to -0.8$** | Outer Right Meadow Hills |

---

## 3. Light Cobblestone & Gravel Multi-Texture Shader

The track material features a procedural GLSL shader modifying Three.js `MeshStandardMaterial`:

1.  **Light Limestone Cobblestone Pavers**:
    *   Staggered running-bond rectangular pavers with mortar groove detection.
    *   Base color: Warm bright sandstone (`#f5ede0`).
    *   Per-paver luminance hash variation ($\pm 12\%$).
2.  **Fine Gravel Micro-Texture**:
    *   High-frequency speckle noise hash across the path surface.
3.  **Lush Meadow & Wildflowers**:
    *   Two-tone emerald-to-sunlit grass blending.
    *   Procedural poppy and daisy flower blooms scattered across the outer meadow slopes.
4.  **Stone Curbs**:
    *   Distinct curbs separating the runnable path ($|u| \le 3.8\text{m}$) from the meadows.

---

## 4. Roadside Scenery (Grounded Trees & Bushes)

*   Low-poly pine trees, oak trees, and meadow bushes are instantiated along the meadow flanks ($|u| \in [7.0\text{m}, 16.0\text{m}]$).
*   **Surface Elevation Sampling**: Each tree dynamically samples the local ground surface elevation $h(u)$, with trunk bases embedded $0.5\text{m}$ below the surface to ensure zero floating trees on slopes.

---

## 5. Procedural Obstacle Anchor Generation

*   **Wave Spacing**: Every $26\text{m} \pm 7\text{m}$ along the track.
*   **Discrete Lanes**: `left` ($-2.3\text{m}$), `center` ($0.0\text{m}$), `right` ($+2.3\text{m}$).
*   **Obstacle Pool**: Reusable rock boulders, logs, hurdles, and fences spawned upon chunk entry and recycled upon chunk disposal.
