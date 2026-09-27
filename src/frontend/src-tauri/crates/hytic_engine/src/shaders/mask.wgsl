// ─── Hytic GPU Mask Evaluation WGSL Shader ────────────────────────────────

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

struct MaskUniforms {
    mask_type: u32, // 0 = Radial, 1 = Gradient, 2 = Luminance
    invert: u32,
    reflect: u32,
    _pad0: u32,

    p0: vec2<f32>, // Radial center OR Gradient start
    p1: vec2<f32>, // Radial radius (rx, ry) OR Gradient end

    angle: f32,
    feather: f32,
    opacity: f32,
    luma_target: f32,

    luma_range: f32,
    luma_smoothness: f32,
    aspect_ratio: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> u_mask: MaskUniforms;
@group(0) @binding(1) var u_source_texture: texture_2d<f32>;
@group(0) @binding(2) var u_source_sampler: sampler;

const LUMA_COEFFS = vec3<f32>(0.299, 0.587, 0.114);

fn eval_radial(uv: vec2<f32>) -> f32 {
    var p = uv - u_mask.p0;
    // Aspect ratio correction
    p.x = p.x * u_mask.aspect_ratio;

    // Rotate
    let c = cos(-u_mask.angle);
    let s = sin(-u_mask.angle);
    let rotated = vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);

    var rad = u_mask.p1;
    rad.x = rad.x * u_mask.aspect_ratio;
    rad = max(rad, vec2<f32>(0.0001, 0.0001));

    let dist = length(rotated / rad);
    let feather_limit = clamp(1.0 - u_mask.feather, 0.01, 0.99);
    return 1.0 - smoothstep(feather_limit, 1.0, dist);
}

fn eval_gradient(uv: vec2<f32>) -> f32 {
    let axis = u_mask.p1 - u_mask.p0;
    let len2 = dot(axis, axis);
    let t = select(dot(uv - u_mask.p0, axis) / len2, 0.5, len2 < 1e-8);

    if (u_mask.reflect == 1u) {
        return clamp(abs(2.0 * t - 1.0), 0.0, 1.0);
    } else {
        return clamp(1.0 - t, 0.0, 1.0);
    }
}

fn eval_luminance(uv: vec2<f32>) -> f32 {
    let color = textureSample(u_source_texture, u_source_sampler, uv).rgb;
    let luma = dot(color, LUMA_COEFFS);
    let dist = abs(luma - u_mask.luma_target);

    let hard_width = max(0.0001, u_mask.luma_range);
    let feather_width = max(0.0001, (1.0 - u_mask.luma_range) * u_mask.luma_smoothness);

    return 1.0 - smoothstep(hard_width, min(1.0, hard_width + feather_width), dist);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var mask_val = 0.0f32;

    switch (u_mask.mask_type) {
        case 0u: { // Radial
            mask_val = eval_radial(in.uv);
        }
        case 1u: { // Gradient
            mask_val = eval_gradient(in.uv);
        }
        case 2u: { // Luminance
            mask_val = eval_luminance(in.uv);
        }
        default: {
            mask_val = 1.0;
        }
    }

    if (u_mask.invert == 1u) {
        mask_val = 1.0 - mask_val;
    }

    mask_val = clamp(mask_val * u_mask.opacity, 0.0, 1.0);
    return vec4<f32>(mask_val, mask_val, mask_val, mask_val);
}
