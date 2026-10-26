shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// --- Surface PBR ---
group_uniforms Surface;
uniform vec4 base_color : source_color = vec4(0.98, 0.82, 0.12, 1.0); // Default gold
uniform float metallic : hint_range(0.0, 1.0) = 0.85;
uniform float roughness : hint_range(0.0, 1.0) = 0.18;

// --- Sweeping Sheen Bar ---
group_uniforms Sheen_Sweep;
uniform bool enable_sheen = true;
uniform vec4 shine_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float shine_speed : hint_range(0.1, 5.0) = 1.4;
uniform float shine_width : hint_range(0.05, 1.0) = 0.22;
uniform float shine_frequency : hint_range(0.5, 6.0) = 2.8;
uniform float shine_intensity : hint_range(0.0, 5.0) = 1.8;

// --- Fresnel Rim Glow ---
group_uniforms Fresnel_Rim;
uniform bool enable_rim = true;
uniform vec4 rim_color : source_color = vec4(1.0, 0.95, 0.6, 1.0);
uniform float rim_power : hint_range(1.0, 10.0) = 3.2;
uniform float rim_intensity : hint_range(0.0, 5.0) = 1.2;

// --- Procedural Sparkles / Glints ---
group_uniforms Sparkles;
uniform bool enable_sparkles = true;
uniform vec4 sparkle_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float sparkle_intensity : hint_range(0.0, 30.0) = 12.0;
uniform float sparkle_size : hint_range(0.05, 0.45) = 0.28;
uniform float sparkle_speed : hint_range(1.0, 20.0) = 6.0;
uniform float sparkle_density : hint_range(2.0, 40.0) = 14.0;
uniform float sparkle_threshold : hint_range(0.2, 0.95) = 0.65;

// --- Idle Animation ---
group_uniforms Hover_Animation;
uniform bool enable_hover = true;
uniform float hover_speed : hint_range(0.5, 6.0) = 2.2;
uniform float hover_height : hint_range(0.0, 0.2) = 0.04;

varying vec3 v_local_pos;
varying vec3 v_local_normal;
varying vec3 v_world_pos;

// Pseudo-random 2D hash
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.xx + p3.yz) * p3.zy);
}

void vertex() {
    v_local_pos = VERTEX;
    v_local_normal = NORMAL;
    v_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;

    if (enable_hover) {
        VERTEX.y += sin(TIME * hover_speed) * hover_height;
    }
}

void fragment() {
    // 1. Base PBR
    ALBEDO = base_color.rgb;
    METALLIC = metallic;
    ROUGHNESS = roughness;

    vec3 total_emission = vec3(0.0);

    // 2. Fresnel Rim Glow
    if (enable_rim) {
        float NdotV = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
        float fresnel = pow(1.0 - NdotV, rim_power);
        total_emission += rim_color.rgb * fresnel * rim_intensity;
    }

    // 3. Sweeping Sheen (diagonal sweep across the object's body)
    if (enable_sheen) {
        float sweep_coord = (v_local_pos.y * 1.5 + v_local_pos.x * 0.8 + v_local_pos.z * 0.4);
        float sweep_pos = sweep_coord - (TIME * shine_speed);
        float sweep_cycle = mod(sweep_pos, shine_frequency);
        float sheen_mask = smoothstep(0.0, shine_width, sweep_cycle) * (1.0 - smoothstep(shine_width, shine_width * 2.0, sweep_cycle));
        sheen_mask = pow(sheen_mask, 1.8);
        total_emission += shine_color.rgb * sheen_mask * shine_intensity;
    }

    // 4. Procedural Glint Sparkles (Tri-planar Surface Twinkle Stars)
    if (enable_sparkles) {
        // Project onto dominant surface axis so sparkles are directly ON the mesh surface
        vec3 abs_n = abs(v_local_normal);
        vec2 surf_uv;
        if (abs_n.x > abs_n.y && abs_n.x > abs_n.z) {
            surf_uv = v_local_pos.yz;
        } else if (abs_n.y > abs_n.z) {
            surf_uv = v_local_pos.xz;
        } else {
            surf_uv = v_local_pos.xy;
        }

        vec2 p2 = surf_uv * sparkle_density;
        vec2 cell_id = floor(p2);
        vec2 cell_fract = fract(p2) - 0.5;

        vec2 rnd = hash22(cell_id);

        if (rnd.x > sparkle_threshold) {
            vec2 center_offset = (rnd - 0.5) * 0.5;
            vec2 diff = cell_fract - center_offset;
            float dist = length(diff);

            // Circular bright core
            float core = smoothstep(sparkle_size * 0.6, 0.0, dist);

            // 4-pointed star cross flare
            float beam_h = max(0.0, 1.0 - abs(diff.x) * (3.5 / sparkle_size)) * max(0.0, 1.0 - abs(diff.y) * (1.2 / sparkle_size));
            float beam_v = max(0.0, 1.0 - abs(diff.y) * (3.5 / sparkle_size)) * max(0.0, 1.0 - abs(diff.x) * (1.2 / sparkle_size));
            float star_shape = max(core, (beam_h + beam_v) * 0.85) * smoothstep(sparkle_size * 1.4, 0.0, dist);

            if (star_shape > 0.001) {
                // Flash timing: distinct, bright twinkle
                float flash = sin(TIME * sparkle_speed + rnd.y * 6.28318) * 0.5 + 0.5;
                flash = pow(flash, 3.5);

                // View factor so it stays visible even from glancing angles
                float NdotV = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
                float view_glint = clamp(NdotV * 1.5, 0.4, 1.0);

                total_emission += sparkle_color.rgb * star_shape * flash * sparkle_intensity * view_glint;
            }
        }
    }

    EMISSION = total_emission;
}
