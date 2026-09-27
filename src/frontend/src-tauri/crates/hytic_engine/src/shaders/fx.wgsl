// ─── Hytic GPU Creative FX (Film Grain, Halation, Bloom, CAS Sharpen) ─────

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

struct FXUniforms {
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,
    grain_color: f32,

    grain_seed: f32,
    sharpen_amount: f32,
    bloom_amount: f32,
    bloom_threshold: f32,

    halation_amount: f32,
    halation_hue: f32,
    image_width: f32,
    image_height: f32,
};

@group(0) @binding(0) var<uniform> u_fx: FXUniforms;
@group(0) @binding(1) var u_base_texture: texture_2d<f32>;
@group(0) @binding(2) var u_base_sampler: sampler;

const PI = 3.14159265359;
const GRAIN_GAMMA = 1.8;

// YIQ color space transformation matrices
const RGB_TO_YIQ = mat3x3<f32>(
    vec3<f32>(0.29889531, 0.59597799, 0.21147017),
    vec3<f32>(0.58662247, -0.27417610, -0.52261711),
    vec3<f32>(0.11448223, -0.32180189, 0.31114694)
);

const YIQ_TO_RGB = mat3x3<f32>(
    vec3<f32>(1.0, 1.0, 1.0),
    vec3<f32>(0.95608445, -0.27137664, -1.10561724),
    vec3<f32>(0.62088850, -0.64860590, 1.70250126)
);

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn grain_normal_sample(p: vec2<f32>) -> f32 {
    let x = max(hash12(p), 1e-4);
    let y = hash12(p + vec2<f32>(19.19, 19.19));
    return sqrt(max(-2.0 * log(x), 1e-4)) * cos(2.0 * PI * y);
}

fn grain_psr(m: f32, p: vec2<f32>) -> f32 {
    let s = sqrt(max(m, 1e-4)) + 0.1;
    return m + s * grain_normal_sample(p);
}

fn grain_luma_comp(x: f32) -> f32 {
    let x2 = x * x;
    let t1 = 1.0 + x;
    let t2 = 1.0 - x2;
    let t3 = t1 * t1;
    let t4 = t3 * t3;
    let t5 = t4 * t1;
    let t6 = t2 * t2 * t2;
    return 1.0 - (t5 * t6 * 0.153);
}

// Physically-modeled YIQ film grain
fn apply_film_grain(color: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (u_fx.grain_amount <= 0.0001) {
        return color;
    }

    let img_size = vec2<f32>(u_fx.image_width, u_fx.image_height);
    let pixel = uv * max(img_size, vec2<f32>(1.0, 1.0));
    let grain_coord = floor(pixel / max(u_fx.grain_size, 0.001));
    let grain_seed = grain_coord + vec2<f32>(u_fx.grain_seed, u_fx.grain_seed * 1.618);

    let working = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / GRAIN_GAMMA));
    let yiq = RGB_TO_YIQ * working;
    let l = min(1.0, yiq.x);
    let fff = mix(3.333, 33.333, l);

    var grained_rgb = vec3<f32>(
        max(grain_psr(working.r * fff, grain_seed + vec2<f32>(11.0, 11.0)) / fff, max(0.01, working.r - mix(0.1, 0.333, working.r))),
        max(grain_psr(working.g * fff, grain_seed + vec2<f32>(37.0, 37.0)) / fff, max(0.01, working.g - mix(0.1, 0.333, working.g))),
        max(grain_psr(working.b * fff, grain_seed + vec2<f32>(73.0, 73.0)) / fff, max(0.01, working.b - mix(0.1, 0.333, working.b)))
    );

    var grained_yiq = RGB_TO_YIQ * grained_rgb;
    grained_yiq.x = grained_yiq.x * mix(1.0, 0.94231, l * l * l);
    grained_yiq.y = mix(yiq.y, grained_yiq.y, u_fx.grain_color);
    grained_yiq.z = mix(yiq.z, grained_yiq.z, u_fx.grain_color);

    let back_rgb = clamp(YIQ_TO_RGB * grained_yiq, vec3<f32>(0.0), vec3<f32>(1.0));
    let mixed = mix(working, back_rgb, u_fx.grain_amount * grain_luma_comp(l));
    return pow(clamp(mixed, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(GRAIN_GAMMA));
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Contrast-Adaptive Sharpening (CAS 5-tap kernel)
fn apply_cas_sharpen(color: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (u_fx.sharpen_amount <= 0.0001) {
        return color;
    }

    let texel = vec2<f32>(1.0 / u_fx.image_width, 1.0 / u_fx.image_height);
    let a = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(0.0, -texel.y)).rgb;
    let b = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(-texel.x, 0.0)).rgb;
    let d = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(texel.x, 0.0)).rgb;
    let e = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(0.0, texel.y)).rgb;

    let la = luma(a);
    let lb = luma(b);
    let lc = luma(color);
    let ld = luma(d);
    let le = luma(e);

    let min_g = min(1.0, min(la, min(lb, min(lc, min(ld, le)))));
    let max_g = min(1.0, max(la, max(lb, max(lc, max(ld, le)))));

    let w_mix_factor = -0.125 - 0.075 * u_fx.sharpen_amount;
    let w = sqrt(min(1.0 - max_g, min_g) / max(max_g, 1e-5)) * w_mix_factor;

    let sharp = (w * (a + b + d + e) + color) / (4.0 * w + 1.0);
    let clc = min(1.0, lc);
    let m = u_fx.sharpen_amount * (1.0 - clc * clc * clc); // Suppress highlights

    return mix(color, clamp(sharp, vec3<f32>(0.0), vec3<f32>(1.0)), m);
}

// Halation simulation
fn apply_halation(color: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (u_fx.halation_amount <= 0.0001) {
        return color;
    }
    let texel = vec2<f32>(2.0 / u_fx.image_width, 2.0 / u_fx.image_height);
    // Simple 4-tap box sample representing red-halo optical dispersion
    let s0 = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(-texel.x, -texel.y)).rgb;
    let s1 = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(texel.x, -texel.y)).rgb;
    let s2 = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(-texel.x, texel.y)).rgb;
    let s3 = textureSample(u_base_texture, u_base_sampler, uv + vec2<f32>(texel.x, texel.y)).rgb;
    let blurred = (s0 + s1 + s2 + s3) * 0.25;

    let o_luma = luma(blurred);
    let warm_red = vec3<f32>(0.9, 0.2 * u_fx.halation_hue, 0.05);
    let halo_glow = blurred * warm_red * smoothstep(0.5, 1.0, o_luma);

    return color + halo_glow * u_fx.halation_amount;
}

// Bloom / Diffusion simulation
fn apply_bloom(color: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
    if (u_fx.bloom_amount <= 0.0001) {
        return color;
    }
    let texel = vec2<f32>(3.0 / u_fx.image_width, 3.0 / u_fx.image_height);
    var bloom_sum = vec3<f32>(0.0);
    var total_weight = 0.0f32;

    for (var dy: f32 = -1.0; dy <= 1.0; dy += 1.0) {
        for (var dx: f32 = -1.0; dx <= 1.0; dx += 1.0) {
            let offset = vec2<f32>(dx, dy) * texel;
            let sample_c = textureSample(u_base_texture, u_base_sampler, uv + offset).rgb;
            let weight = select(1.0, 2.0, dx == 0.0 && dy == 0.0);
            let highlight = max(sample_c - vec3<f32>(u_fx.bloom_threshold), vec3<f32>(0.0));
            bloom_sum += highlight * weight;
            total_weight += weight;
        }
    }

    let bloom_glow = bloom_sum / total_weight;
    return color + bloom_glow * u_fx.bloom_amount * 2.0;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let raw = textureSample(u_base_texture, u_base_sampler, in.uv);
    var color = raw.rgb;

    // 1. CAS Sharpening
    color = apply_cas_sharpen(color, in.uv);

    // 2. Halation
    color = apply_halation(color, in.uv);

    // 3. Bloom / Diffusion
    color = apply_bloom(color, in.uv);

    // 4. Film Grain
    color = apply_film_grain(color, in.uv);

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), raw.a);
}

