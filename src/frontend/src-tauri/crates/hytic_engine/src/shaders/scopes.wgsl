// ─── GPU Scopes Histogram Compute Shader ────────────────────────────────────

struct HistogramBuffer {
    r: array<atomic<u32>, 256>,
    g: array<atomic<u32>, 256>,
    b: array<atomic<u32>, 256>,
    luma: array<atomic<u32>, 256>,
};

@group(0) @binding(0) var u_image: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> u_histogram: HistogramBuffer;

const LUMA_COEFFS = vec3<f32>(0.2126, 0.7152, 0.0722);

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dims = textureDimensions(u_image);
    if (global_id.x >= dims.x || global_id.y >= dims.y) {
        return;
    }

    let color = textureLoad(u_image, vec2<i32>(global_id.xy), 0).rgb;
    let clamped = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

    let r_bin = u32(clamp(clamped.r * 255.0, 0.0, 255.0));
    let g_bin = u32(clamp(clamped.g * 255.0, 0.0, 255.0));
    let b_bin = u32(clamp(clamped.b * 255.0, 0.0, 255.0));
    let l_bin = u32(clamp(dot(clamped, LUMA_COEFFS) * 255.0, 0.0, 255.0));

    atomicAdd(&u_histogram.r[r_bin], 1u);
    atomicAdd(&u_histogram.g[g_bin], 1u);
    atomicAdd(&u_histogram.b[b_bin], 1u);
    atomicAdd(&u_histogram.luma[l_bin], 1u);
}
