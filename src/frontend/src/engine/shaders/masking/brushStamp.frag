// brushStamp.frag
// Renders one brush dab into the accumulating brush mask render target.
// Inputs:
//   uPrevMask   — previous mask state (r channel = mask value 0..1)
//   uSource     — source image for edge-aware masking
//   uCenter     — brush dab center in image UV space
//   uRadius     — dab radius in UV units
//   uOpacity    — brush flow/opacity
//   uHardness   — 0 = fully soft, 1 = hard edge
//   uMasking    — edge-aware strength 0..1
//   uPressure   — pointer pressure 0..1
//   uErase      — 1.0 = erase mode, 0.0 = paint mode
//   uCenterColor — sampled image color at brush center (for edge-aware)

precision highp float;

varying vec2 vUv;

uniform sampler2D uPrevMask;
uniform sampler2D uSource;

uniform vec2  uCenter;
uniform float uRadius;
uniform float uOpacity;
uniform float uHardness;
uniform float uMasking;
uniform float uPressure;
uniform float uErase;

uniform vec3 uCenterColor;

vec3 rgbToYuvLike(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    c.r - c.g,
    c.b - c.g
  );
}

void main() {
  float prev = texture2D(uPrevMask, vUv).r;

  float d = distance(vUv, uCenter);
  float radius = max(uRadius, 0.0001);
  float nd = d / radius;

  if (nd > 1.0) {
    gl_FragColor = vec4(prev, prev, prev, prev);
    return;
  }

  float hard = clamp(uHardness, 0.0, 1.0);
  // hard=1 → sharp edge starts near 0.85; hard=0 → smooth from centre
  float softStart = mix(0.0, 0.85, hard);
  float shape = 1.0 - smoothstep(softStart, 1.0, nd);

  vec3 pixelColor = texture2D(uSource, vUv).rgb;

  float edgeAware = 1.0;
  if (uMasking > 0.001) {
    vec3 a = rgbToYuvLike(pixelColor);
    vec3 b = rgbToYuvLike(uCenterColor);
    float colorDist = length(a - b);
    // Higher uMasking = tighter edge-aware selection
    float threshold = mix(1.0, 0.12, clamp(uMasking, 0.0, 1.0));
    edgeAware = 1.0 - smoothstep(0.0, threshold, colorDist);
  }

  float dab = shape * uOpacity * uPressure * edgeAware;
  dab = clamp(dab, 0.0, 1.0);

  float next;
  if (uErase > 0.5) {
    next = prev * (1.0 - dab);
  } else {
    next = max(prev, dab);
  }

  gl_FragColor = vec4(next, next, next, next);
}
