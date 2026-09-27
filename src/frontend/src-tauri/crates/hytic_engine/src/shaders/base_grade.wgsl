// ─── Hytic GPU Base Grade WGSL Shader ──────────────────────────────────────

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    // Generates a fullscreen triangle covering [-1, 1]
    let x = f32(i32(in_vertex_index & 1u) * 4 - 1);
    let y = f32(i32(in_vertex_index & 2u) * 2 - 1);
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

struct BasicGradeUniforms {
    exposure: f32,
    contrast: f32,
    contrast_pivot: f32,
    highlights: f32,

    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,

    temperature: f32,
    tint: f32,
    vibrance: f32,
    dehaze: f32,

    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_feather: f32,
    vignette_roundness: f32,

    lut_intensity: f32,
    has_tone_curve: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> u_grade: BasicGradeUniforms;
@group(0) @binding(1) var u_image_texture: texture_2d<f32>;
@group(0) @binding(2) var u_image_sampler: sampler;
@group(0) @binding(3) var u_lut_texture: texture_3d<f32>;
@group(0) @binding(4) var u_lut_sampler: sampler;
@group(0) @binding(5) var u_curve_texture: texture_2d<f32>;
@group(0) @binding(6) var u_curve_sampler: sampler;

// Rec.709 / sRGB relative luminance coefficients
const LUMA_COEFFS = vec3<f32>(0.2126, 0.7152, 0.0722);

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let cutoff = step(c, vec3<f32>(0.04045));
    let low = c / 12.92;
    let high = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return mix(high, low, cutoff);
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let clamped = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let cutoff = step(clamped, vec3<f32>(0.0031308));
    let low = clamped * 12.92;
    let high = 1.055 * pow(clamped, vec3<f32>(1.0 / 2.4)) - 0.055;
    return mix(high, low, cutoff);
}

fn apply_white_balance(color: vec3<f32>, temp: f32, tint: f32) -> vec3<f32> {
    // Temperature warms (boost R, reduce B) or cools (boost B, reduce R)
    let temp_rgb = vec3<f32>(1.0 + temp * 0.3, 1.0, 1.0 - temp * 0.3);
    // Tint shifts magenta (boost R,B, reduce G) or green (boost G, reduce R,B)
    let tint_rgb = vec3<f32>(1.0 + tint * 0.15, 1.0 - tint * 0.3, 1.0 + tint * 0.15);
    return color * temp_rgb * tint_rgb;
}

fn apply_contrast(color: vec3<f32>, contrast: f32, pivot: f32) -> vec3<f32> {
    if (abs(contrast) < 0.0001) {
        return color;
    }
    // S-curve contrast around pivot point
    let factor = (contrast + 1.0);
    return pow(max(color / pivot, vec3<f32>(0.00001)), vec3<f32>(factor)) * pivot;
}

fn apply_saturation_vibrance(color: vec3<f32>, sat: f32, vib: f32) -> vec3<f32> {
    let luma = dot(color, LUMA_COEFFS);
    let max_val = max(color.r, max(color.g, color.b));
    let min_val = min(color.r, min(color.g, color.b));
    let current_sat = select((max_val - min_val) / max(max_val, 0.0001), 0.0, max_val <= 0.0001);

    // Vibrance boosts less saturated colors more
    let vib_factor = vib * (1.0 - current_sat);
    let total_sat = 1.0 + sat + vib_factor;

    return mix(vec3<f32>(luma), color, max(0.0, total_sat));
}

fn apply_vignette(color: vec3<f32>, uv: vec2<f32>, amount: f32, midpoint: f32, feather: f32) -> vec3<f32> {
    if (abs(amount) < 0.0001) {
        return color;
    }
    let d = distance(uv, vec2<f32>(0.5, 0.5));
    let r_inner = max(0.0, midpoint * (1.0 - feather));
    let r_outer = min(1.0, midpoint * (1.0 + feather));
    let factor = smoothstep(r_inner, r_outer, d);
    return color * (1.0 - factor * amount);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let raw = textureSample(u_image_texture, u_image_sampler, in.uv);
    var color = srgb_to_linear(raw.rgb);

    // 1. Exposure
    color = color * exp2(u_grade.exposure);

    // 2. White Balance
    color = apply_white_balance(color, u_grade.temperature, u_grade.tint);

    // 3. Highlights & Shadows
    let luma = dot(color, LUMA_COEFFS);
    let shadow_mask = 1.0 - smoothstep(0.0, 0.4, luma);
    let highlight_mask = smoothstep(0.6, 1.0, luma);
    color = color + color * (shadow_mask * u_grade.shadows * 0.5 + highlight_mask * u_grade.highlights * 0.5);

    // 4. Contrast
    color = apply_contrast(color, u_grade.contrast, u_grade.contrast_pivot);

    // 5. Saturation & Vibrance
    color = apply_saturation_vibrance(color, u_grade.saturation, u_grade.vibrance);

    // 6. Convert to sRGB
    color = linear_to_srgb(color);

    // 7. Optional Tone Curve (1D LUT)
    if (u_grade.has_tone_curve > 0.5) {
        let cr = textureSample(u_curve_texture, u_curve_sampler, vec2<f32>(color.r, 0.5)).r;
        let cg = textureSample(u_curve_texture, u_curve_sampler, vec2<f32>(color.g, 0.5)).g;
        let cb = textureSample(u_curve_texture, u_curve_sampler, vec2<f32>(color.b, 0.5)).b;
        color = vec3<f32>(cr, cg, cb);
    }

    // 8. Optional 3D LUT sampling
    if (u_grade.lut_intensity > 0.001) {
        let lut_coord = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
        let lut_sample = textureSample(u_lut_texture, u_lut_sampler, lut_coord).rgb;
        color = mix(color, lut_sample, u_grade.lut_intensity);
    }

    // 9. Vignette
    color = apply_vignette(color, in.uv, u_grade.vignette_amount, u_grade.vignette_midpoint, u_grade.vignette_feather);

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), raw.a);
}

