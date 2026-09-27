precision highp float;

// Final composite for the Halation (uMode 0) and Diffusion (uMode 1) FX. Faithful port of
// the legacy "lastPass" shaders: uBase is the graded image, uEffect is the blurred glow.
// All shader-side parameter mappings (3x amount, spill curve, hue remap, etc.) are applied
// by CompositePass before being handed in here as the uniforms below.
uniform sampler2D uBase;
uniform sampler2D uEffect;
uniform int uMode;

uniform float uAmount;

// Halation
uniform float uSpill;
uniform float uHue;
uniform float uSat;

// Diffusion
uniform float uFog;
uniform float uThreshold;
uniform float uFadeLevel;
uniform float uCenterAlpha;
uniform vec2 uCenter;
uniform float uAspect;

varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 base = texture2D(uBase, vUv);
  vec3 t = base.rgb;
  vec3 o = texture2D(uEffect, vUv).rgb;
  vec3 color = t;

  if (uMode == 0) {
    // --- Halation ---
    float oL = luma(o);
    float ol = min(1.0, oL);
    o *= mix(ol, 1.0, uSpill);
    vec3 outerColor = vec3(0.8, uHue * (0.8 + oL * oL), 0.0);
    vec3 innerColor = vec3(oL, oL * (uHue + 0.1), oL * 0.05);
    vec3 cl = mix(outerColor, innerColor, ol * ol);
    cl = mix(vec3(min(1.0, luma(cl))), cl, uSat);
    vec3 hl = t + (o * cl);
    cl = max(cl + 1.0, vec3(0.0001));
    hl = vec3(max(t.r, hl.r / cl.r), max(t.g, hl.g / cl.g), max(t.b, hl.b / cl.b));
    color = mix(t, hl, uAmount);
  } else {
    // --- Diffusion ---
    vec2 size = uAspect < 1.0 ? vec2(1.2, 1.2 / uAspect) : vec2(1.2 * uAspect, 1.2);
    vec2 vgn = (vUv - uCenter) * size;
    float vig = mix(uCenterAlpha, 1.0, smoothstep(0.0, 1.0, dot(vgn, vgn)));
    float ol = min(1.0, luma(o));
    float tl = min(1.0, luma(t));
    float nol = 1.0 - ol;
    float tr = mix(1.0, 1.0 - nol * nol * nol, uThreshold);
    float vt = vig * tr;
    vec3 d = mix(t, o, uAmount * vt);
    d = mix(d, d + uFadeLevel, uFog * vt * nol);
    d *= mix(1.0, mix(0.67, 1.0, uThreshold), uAmount * smoothstep(1.0, 0.0, tl));
    color = d;
  }

  gl_FragColor = vec4(max(color, 0.0), base.a);
}
