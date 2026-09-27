precision highp float;

uniform sampler2D uImage;
uniform sampler2D uProcessed;
uniform vec2 uImageSize;
uniform int uDebugMode;
uniform float uSplitX;
uniform vec2 uCanvasSize;

uniform bool uCropEnabled;
uniform vec4 uCropRect;
uniform vec2 uSourceSize;
uniform vec2 uDisplaySize;
uniform float uOrientationAngle;
uniform float uStraighten;
uniform bool uFlipX;
uniform bool uFlipY;

// Presentation border (GPU compositing).
uniform bool uBorderEnabled;
uniform vec4 uPictureRect; // x,y,w,h of the picture inset, in frame UV (bottom-up)
uniform vec4 uCoverRect;   // cover mapping of the picture over the frame (blurred bg)
uniform vec3 uBorderColor;
uniform sampler2D uBorderImage;
uniform int uBorderImageRotation;
uniform float uBorderOpacity;
uniform int uBorderBgMode; // 0 = solid, 1 = blurred-image, 2 = frame image
uniform vec2 uBorderBlur;  // blur radius in frame-UV (x,y)
uniform float uPictureRadius; // inner picture corner radius (frame-height UV units)
uniform float uFrameRadius;   // outer frame corner radius (frame-height UV units)
uniform float uPictureShadowOpacity;
uniform float uPictureShadowBlur;
uniform vec2 uPictureShadowOffset;
uniform float uPictureInnerShadowOpacity;
uniform float uPictureInnerShadowBlur;
uniform float uFrameAspect;   // frame width / height
uniform vec3 uBorderClearColor; // shown outside a rounded frame

varying vec2 vUv;

#include <transform>

vec3 checkerPattern(vec2 uv) {
  vec2 checkerUv = floor(uv * uImageSize / 24.0);
  float checker = mod(checkerUv.x + checkerUv.y, 2.0);
  return mix(vec3(0.18), vec3(0.82), checker);
}

float splitScreenX() {
  return clamp(gl_FragCoord.x / max(uCanvasSize.x, 1.0), 0.0, 1.0);
}

float splitLineWidth() {
  return 1.0 / max(uCanvasSize.x, 1.0);
}

// Soft background for blurred-image borders: the graded picture scaled to cover the
// frame, sampled as a Gaussian defocus blur. uBorderBlur is expressed in frame UV,
// but coverUv is in source-image UV, so compensate for the cover mapping first.
vec3 presentationBlurBackground(vec2 frameUv) {
  vec2 coverUv = (frameUv - uCoverRect.xy) / uCoverRect.zw;
  if (uBorderBlur.x <= 0.0001 && uBorderBlur.y <= 0.0001) {
    return texture2D(uProcessed, clamp(coverUv, 0.0, 1.0)).rgb;
  }

  vec2 blurRadius = uBorderBlur / max(uCoverRect.zw, vec2(0.0001));
  vec3 acc = vec3(0.0);
  float totalWeight = 0.0;
  const float GA = 2.39996323; // golden angle
  const float SAMPLE_COUNT = 25.0;
  for (int i = 0; i < 25; i++) {
    float fi = float(i);
    // Inverse-transform sampling puts more samples near the centre, matching the
    // smooth falloff of a photographic defocus blur without visible ring artefacts.
    float radius = sqrt(-2.0 * log(1.0 - (fi + 0.5) / SAMPLE_COUNT)) * 0.5;
    float angle = fi * GA;
    vec2 offset = vec2(cos(angle), sin(angle)) * radius * blurRadius;
    acc += texture2D(uProcessed, clamp(coverUv + offset, 0.0, 1.0)).rgb;
    totalWeight += 1.0;
  }
  return acc / totalWeight;
}

vec2 presentationBorderImageUv(vec2 coverUv) {
  vec2 uv = vec2(coverUv.x, 1.0 - coverUv.y);
  if (uBorderImageRotation == 90) {
    return vec2(uv.y, 1.0 - uv.x);
  }
  if (uBorderImageRotation == 180) {
    return vec2(1.0 - uv.x, 1.0 - uv.y);
  }
  if (uBorderImageRotation == 270) {
    return vec2(1.0 - uv.y, uv.x);
  }
  return uv;
}

float roundedRectDistance(vec2 uv, vec4 rect, float r) {
  vec2 p = vec2(uv.x * uFrameAspect, uv.y);
  vec2 mn = vec2(rect.x * uFrameAspect, rect.y);
  vec2 mx = vec2((rect.x + rect.z) * uFrameAspect, rect.y + rect.w);
  vec2 c = (mn + mx) * 0.5;
  vec2 b = (mx - mn) * 0.5;
  float rr = min(r, min(b.x, b.y));
  vec2 q = abs(p - c) - b + rr;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr;
}

// Anti-aliased coverage of a rounded rectangle. The frame UV is mapped into an
// aspect-corrected space (x scaled by uFrameAspect) so corner radii stay circular
// despite the non-square frame. `rect` is x,y,w,h in frame UV; `r` is in the same
// height-UV units. Returns 1 inside, 0 outside, smoothly blended at the edge.
float roundedRectCoverage(vec2 uv, vec4 rect, float r) {
  if (r <= 0.00001) {
    return (uv.x >= rect.x && uv.x <= rect.x + rect.z &&
            uv.y >= rect.y && uv.y <= rect.y + rect.w) ? 1.0 : 0.0;
  }
  float d = roundedRectDistance(uv, rect, r);
  float w = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(-w, w, d);
}


void main() {
  if (uBorderEnabled) {
    // Border/background region color, painted across the whole frame.
    vec2 coverUv = (vUv - uCoverRect.xy) / uCoverRect.zw;
    vec3 bg = uBorderBgMode == 2
      ? mix(texture2D(uBorderImage, presentationBorderImageUv(clamp(coverUv, 0.0, 1.0))).rgb, uBorderColor, uBorderOpacity)
      : uBorderBgMode == 1
        ? mix(presentationBlurBackground(vUv), uBorderColor, uBorderOpacity)
        : uBorderColor * uBorderOpacity;
    vec3 color = bg;
    if (uPictureShadowOpacity > 0.0001) {
      vec2 shadowUv = vUv - uPictureShadowOffset;
      float shadowD = max(0.0, roundedRectDistance(shadowUv, uPictureRect, uPictureRadius));
      float shadow = 1.0 - smoothstep(0.0, max(uPictureShadowBlur, 0.0001), shadowD);
      color = mix(color, vec3(0.0), shadow * uPictureShadowOpacity);
    }

    // Remap the frame UV into the picture inset and composite the graded picture
    // over the background, with rounded inner corners revealing the background.
    vec2 picUv = (vUv - uPictureRect.xy) / uPictureRect.zw;
    if (picUv.x >= 0.0 && picUv.x <= 1.0 && picUv.y >= 0.0 && picUv.y <= 1.0) {
      // The processed texture is already graded + transformed, so sample it
      // directly at the inset-local UV (no re-transform).
      vec3 picColor = texture2D(uProcessed, picUv).rgb;
      if (uSplitX > 0.001) {
        float screenX = splitScreenX();
        if (screenX < uSplitX) {
          picColor = texture2D(uImage, vec2(picUv.x, 1.0 - picUv.y)).rgb;
        }
        if (abs(screenX - uSplitX) < splitLineWidth()) {
          picColor = vec3(1.0);
        }
      }
      float picCov = roundedRectCoverage(vUv, uPictureRect, uPictureRadius);
      color = mix(color, picColor, picCov);
      if (uPictureInnerShadowOpacity > 0.0001) {
        float insetDistance = max(0.0, -roundedRectDistance(vUv, uPictureRect, uPictureRadius));
        float innerShadow = 1.0 - smoothstep(0.0, max(uPictureInnerShadowBlur, 0.0001), insetDistance);
        color = mix(color, vec3(0.0), innerShadow * picCov * uPictureInnerShadowOpacity);
      }
    }

    // Round the outer frame corners by fading to the viewer clear color.
    float frameCov = roundedRectCoverage(vUv, vec4(0.0, 0.0, 1.0, 1.0), uFrameRadius);
    color = mix(uBorderClearColor, color, frameCov);

    vec4 outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    gl_FragColor = outColor;
    return;
  }

  vec2 sourceUv = applyImageTransform(vUv);
  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 src = texture2D(uImage, vec2(sourceUv.x, 1.0 - sourceUv.y));
  vec3 processed = texture2D(uProcessed, vUv).rgb;

  if (uDebugMode == 1) {
    processed = vec3(vUv.x, vUv.y, 0.0);
  }

  if (uDebugMode == 2) {
    processed = vec3(src.a);
  }

  if (uDebugMode == 3) {
    processed = checkerPattern(vUv);
  }

  vec3 color = processed;
  if (uSplitX > 0.001) {
    float screenX = splitScreenX();
    if (screenX < uSplitX) {
      color = src.rgb;
    }
    if (abs(screenX - uSplitX) < splitLineWidth()) {
      color = vec3(1.0);
    }
  }

  vec4 outColor = vec4(clamp(color, 0.0, 1.0), src.a);

  gl_FragColor = outColor;
}
