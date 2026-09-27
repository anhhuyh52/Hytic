// Spotlight — faithful port of the legacy relight FX (package.min.js
// `Lu` matte + `Au` composite). Render-only (not in the LUT). The legacy matte
// pass is purely per-pixel (no neighbour sampling), so it is computed inline here
// and the whole effect is a single full-screen pass. amount = 0.667 * panel
// amount (set on the CPU); at amount 0 the pass is an identity.

varying vec2 vUv;

uniform sampler2D uInput;
uniform float uAmount;   // 0.667 * spotlightAmount
uniform float uContrast;
uniform float uBias;
uniform float uFocus;
uniform vec2 uCenter;    // image-space [0,1]
uniform float uAspect;   // image width / height
uniform vec4 uExportViewport;

float spotLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Legacy matte pass (`Lu`): per-pixel luma -> a "darkness" matte (grayscale).
float spotMatte(vec3 color) {
  vec3 c = clamp(color, 0.0, 1.0);
  float lum = min(1.0, spotLuma(c));
  vec3 flux = mix(1.0 - 2.0 * (1.0 - c) * lum, 2.0 * c * (1.0 - lum), step(c, vec3(0.5)));
  lum = min(1.0, spotLuma(flux));
  lum = 1.0 - (lum >= 0.0078125 ? (log2(lum) + 9.72) / 17.52 : lum * 10.5402377416545 + 0.0729055341958355);
  return pow(smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, lum)), 2.0);
}

vec3 pos_srp(vec3 c, vec3 m, float l, float t) {
  return mix(c, c * pow(c / max(m, 0.001), vec3(t)), l);
}

vec3 pos_ctr(vec3 c, vec3 m, float lum, float lim, float t) {
  vec3 ctr = mix(1.0 - 2.0 * (1.0 - c) * lim, 2.0 * c * lum, step(c, vec3(0.8)));
  ctr = pos_srp(ctr, m, lum, t);
  return max(mix(c, ctr, t * 8.0), 0.0);
}

void main() {
  vec4 t = texture2D(uInput, vUv);
  vec3 fragColor = t.xyz;

  float matteVal = spotMatte(fragColor);
  vec3 m = vec3(matteVal);

  // Aspect-corrected radial offset from the center (legacy vgn).
  vec2 size = vec2(1.0);
  if (uAspect < 1.0) {
    size.y = mix(1.0, 1.0 / uAspect, uFocus * 1.75);
  } else {
    size.x = mix(1.0, uAspect, uFocus * 1.75);
  }
  vec2 imageUv = uExportViewport.xy + vUv * uExportViewport.zw;
  vec2 vgn = (imageUv - uCenter) * size;

  float lum = min(1.0, spotLuma(vec3(t.x, matteVal, t.z)));
  float lim = 1.0 - lum;
  float inside_mix = min(1.0, uBias * 2.0);
  float outside_mix = min(1.0, 2.0 * (1.0 - uBias));
  float dist = length(vgn);
  float maxDist = mix(1.0, 0.5, uFocus);
  float falloffStrength = 0.8 + (uFocus * 0.8);
  float mask_inside = 1.0 - log(1.0 + dist * falloffStrength) / log(1.0 + maxDist * falloffStrength);
  float mask_outside = (1.0 - mask_inside) * outside_mix;
  float matte_inside = clamp((((matteVal * mask_inside * inside_mix) - 0.5) * (uFocus + 1.0)) + 0.5, 0.0, 1.0);

  fragColor = pos_ctr(fragColor, m, lum, lim, min(1.0, uContrast * uAmount) * matte_inside);
  fragColor = fragColor * (1.0 + uAmount * matte_inside * 4.0);
  fragColor = fragColor * (1.0 - uAmount * mask_outside * 0.8);

  gl_FragColor = vec4(fragColor, t.a);
}
