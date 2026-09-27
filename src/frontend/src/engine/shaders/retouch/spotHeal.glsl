#define MAX_RETOUCH_SPOTS 32

uniform sampler2D uSmoothTexture;
uniform sampler2D uRetouchContextTexture;
uniform int uSpotCount;
uniform vec2 uSpotPositions[MAX_RETOUCH_SPOTS];
uniform vec2 uSpotSourcePositions[MAX_RETOUCH_SPOTS];
uniform vec2 uSpotSizes[MAX_RETOUCH_SPOTS];
uniform float uSpotAngles[MAX_RETOUCH_SPOTS];
uniform float uSpotFeathers[MAX_RETOUCH_SPOTS];
uniform float uSpotOpacities[MAX_RETOUCH_SPOTS];
uniform float uSpotModes[MAX_RETOUCH_SPOTS];

vec3 retouchLinearLight(vec3 base, vec3 detail) {
  return clamp(base + detail * 2.0 - 1.0, 0.0, 1.0);
}

vec3 applySpotRetouch(vec3 destination, vec2 displayUv) {
  vec3 current = destination;

  for (int index = 0; index < MAX_RETOUCH_SPOTS; index++) {
    if (index >= uSpotCount) break;

    float mask = retouchDestinationMask(
      displayUv,
      uSpotPositions[index],
      uSpotSizes[index],
      uSpotAngles[index],
      uSpotFeathers[index],
      uSpotOpacities[index]
    );
    if (mask <= 0.00001) continue;

    vec2 destinationCenter = uSpotPositions[index] + 0.5;
    vec2 sourceCenter = uSpotSourcePositions[index] + 0.5;
    vec2 local = rotateRetouchVector(
      displayUv - destinationCenter,
      uSpotAngles[index],
      uOutputSize
    );
    vec2 sourceDisplayUv = sourceCenter + local;
    vec3 sourceDistortion = uDistortionEnabled
      ? applyDistortionInverse(sourceDisplayUv)
      : vec3(sourceDisplayUv, 1.0);
    if (sourceDistortion.z < 0.5) continue;

    vec2 sourceUv = uApplyTransform
      ? applyImageTransform(sourceDistortion.xy)
      : sourceDistortion.xy;
    if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
      continue;
    }

    vec2 sampleUv = vec2(sourceUv.x, uFlipSourceY ? 1.0 - sourceUv.y : sourceUv.y);
    vec3 sourceOriginal = texture2D(uImage, sampleUv).rgb;
    vec3 replacement = sourceOriginal;
    if (uSpotModes[index] > 0.5) {
      vec4 destinationContext = texture2D(
        uRetouchContextTexture,
        clamp(
          (displayUv - uExportViewport.xy) / max(uExportViewport.zw, vec2(0.0001)),
          0.0,
          1.0
        )
      );
      vec3 sourceSmooth = texture2D(uSmoothTexture, sampleUv).rgb;
      vec3 contextBase = mix(
        current,
        destinationContext.rgb,
        min(destinationContext.a / 0.05, 1.0)
      );
      vec3 sourceDetail = (sourceOriginal + (1.0 - sourceSmooth)) * 0.5;
      replacement = retouchLinearLight(contextBase, sourceDetail);
    }
    current = mix(current, replacement, mask);
  }

  return current;
}
