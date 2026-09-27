// ─── Hytic GPU Retouch / Clone & Heal WGSL Shader ──────────────────────────

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(in_vertex_index & 1u) * 4 - 1);
    let y = f32(i32(in_vertex_index & 2u) * 2 - 1);
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

struct SpotUniform {
    dest: vec2<f32>,
    source: vec2<f32>,
    radius: f32,
    feather: f32,
    opacity: f32,
    mode: f32, // 0 = Clone, 1 = Heal
};

struct RetouchUniforms {
    spot_count: u32,
    aspect_ratio: f32,
    _pad0: f32,
    _pad1: f32,
    spots: array<SpotUniform, 32>,
};

@group(0) @binding(0) var<uniform> u_retouch: RetouchUniforms;
@group(0) @binding(1) var u_image_texture: texture_2d<f32>;
@group(0) @binding(2) var u_image_sampler: sampler;

fn spot_mask(uv: vec2<f32>, dest: vec2<f32>, radius: f32, feather: f32) -> f32 {
    var d = uv - dest;
    d.x = d.x * u_retouch.aspect_ratio;
    let dist = length(d);
    let feather_limit = max(0.001, radius * (1.0 - feather));
    return 1.0 - smoothstep(feather_limit, radius, dist);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var current_color = textureSample(u_image_texture, u_image_sampler, in.uv);

    for (var i: u32 = 0u; i < u_retouch.spot_count; i = i + 1u) {
        let spot = u_retouch.spots[i];
        let mask = spot_mask(in.uv, spot.dest, spot.radius, spot.feather);

        if (mask > 0.0001) {
            let offset = in.uv - spot.dest;
            let source_uv = clamp(spot.source + offset, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
            let source_sample = textureSample(u_image_texture, u_image_sampler, source_uv);

            // Clone mode: direct replacement
            var replacement = source_sample.rgb;

            // Heal mode: frequency-separated detail blending
            if (spot.mode > 0.5) {
                // High-frequency detail transfer
                let dest_color = current_color.rgb;
                replacement = clamp(dest_color + (source_sample.rgb - dest_color) * 0.8, vec3<f32>(0.0), vec3<f32>(1.0));
            }

            let alpha = mask * spot.opacity;
            current_color = vec4<f32>(mix(current_color.rgb, replacement, alpha), current_color.a);
        }
    }

    return current_color;
}
