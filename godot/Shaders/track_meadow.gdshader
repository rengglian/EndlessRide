shader_type spatial;
render_mode cull_disabled, diffuse_lambert, specular_schlick_ggx;

// Mobile-safe Dave Hoskins hash12 (avoids precision artifacts on mobile GPUs)
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
    float u = UV.x;      // Lateral offset in metres [-36.0, +36.0]
    float s = UV.y;      // Longitudinal distance in metres [0.0, 1200.0]
    float absU = abs(u);

    // 1. Procedural Staggered Cobblestone Pavers & Gravel in Metres
    // Paver dimensions: 0.40m wide x 0.50m long
    vec2 stoneUv = vec2(u * 2.5, s * 2.0);
    vec2 tileId = floor(stoneUv);
    if (mod(abs(tileId.y), 2.0) > 0.5) {
        stoneUv.x += 0.5;
        tileId = floor(stoneUv);
    }
    vec2 tileFract = fract(stoneUv);

    // Mortar groove lines between stones
    float edgeDist = min(min(tileFract.x, 1.0 - tileFract.x), min(tileFract.y, 1.0 - tileFract.y));
    float mortarMask = 1.0 - smoothstep(0.04, 0.09, edgeDist);

    // Distance / derivative attenuation to reduce high-frequency moiré and shimmering
    float fw = clamp(fwidth(stoneUv.x) * 3.5, 0.0, 1.0);
    float detailAtten = 1.0 - fw;

    // Per-stone random luminance variation using mobile-safe hash12
    float stoneHash = hash12(tileId);
    float stoneVar = (stoneHash - 0.5) * 0.12 * detailAtten;

    // High-frequency gravel texture speckles
    float gravelNoise = hash12(stoneUv * 8.0);
    float gravelVar = (gravelNoise - 0.5) * 0.08 * detailAtten;
    mortarMask *= detailAtten;

    // 1. Natural warm European cobblestone pavers & gravel
    vec3 lightPaverBase = vec3(0.82, 0.78, 0.70);   // Warm bright limestone cobblestone
    vec3 mortarColor    = vec3(0.46, 0.42, 0.36);   // Crisp dark recessed mortar grooves
    vec3 gravelColor    = vec3(0.78, 0.74, 0.66);   // Natural crushed gravel speckles

    vec3 paverColor = mix(lightPaverBase + stoneVar + gravelVar, gravelColor, 0.25);
    paverColor = mix(paverColor, mortarColor, mortarMask * 0.80);

    // 2. Sandstone Curb / Border Trim (35cm wide between 3.8m and 4.15m)
    vec3 curbColor = vec3(0.66, 0.60, 0.52);

    // 3. Lush Rolling Meadow & Wildflowers in Metres
    vec2 meadowUv = vec2(u * 0.25, s * 0.25);
    float meadowNoise = sin(meadowUv.x * 2.4 + meadowUv.y * 3.6) * cos(meadowUv.x * 3.2 - meadowUv.y * 2.0);
    vec3 grassBase   = vec3(0.24, 0.54, 0.22); // Vibrant rich emerald meadow
    vec3 grassSunlit = vec3(0.36, 0.68, 0.28); // Sunlit warm meadow green
    vec3 meadowColor = mix(grassBase, grassSunlit, meadowNoise * 0.5 + 0.5);

    // Wildflower spots on meadows
    vec2 flowerTile = floor(meadowUv * 1.5);
    float flowerHash = hash12(flowerTile);
    if (flowerHash > 0.93) {
        vec3 flowerColor = flowerHash > 0.965 ? vec3(0.98, 0.88, 0.25) : vec3(0.92, 0.32, 0.32);
        float flowerDist = length(fract(meadowUv * 1.5) - 0.5);
        if (flowerDist < 0.28) {
            meadowColor = mix(meadowColor, flowerColor, 0.85);
        }
    }

    // 4. Metre-Based Multi-Layer Splat Blending
    // Path: |u| <= 3.8m
    float pathMask = 1.0 - smoothstep(3.72, 3.85, absU);
    // Curb: 3.8m <= |u| <= 4.15m (35cm wide curb)
    float curbMask = smoothstep(3.70, 3.85, absU) * (1.0 - smoothstep(4.05, 4.25, absU));

    vec3 col = mix(meadowColor, curbColor, curbMask);
    col = mix(col, paverColor, pathMask);

    ALBEDO = col;
    ROUGHNESS = 0.75;
    METALLIC = 0.02;
}
