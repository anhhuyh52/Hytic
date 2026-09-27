precision highp float;

// Film Resolution soften — faithful port of the legacy Texture `Qu` pass. A 9-tap tent blur
// whose sample radius is scaled by `amount`, driven by Film Resolution < 0.5. amount = 0 →
// identity.
uniform sampler2D uInput;
uniform float uAmount;
uniform vec2 uTexelSize;

varying vec2 vUv;

void main() {
  vec4 srcColor = texture2D(uInput, vUv);
  if (uAmount > 0.0) {
    vec2 texel = uTexelSize * uAmount;
    vec3 o = texture2D(uInput, vUv + texel * vec2(-1.0, 1.0)).rgb * 0.0625;
    o += texture2D(uInput, vUv + texel * vec2(0.0, 1.0)).rgb * 0.125;
    o += texture2D(uInput, vUv + texel * vec2(1.0, 1.0)).rgb * 0.0625;
    o += texture2D(uInput, vUv + texel * vec2(-1.0, 0.0)).rgb * 0.125;
    o += srcColor.rgb * 0.25;
    o += texture2D(uInput, vUv + texel * vec2(1.0, 0.0)).rgb * 0.125;
    o += texture2D(uInput, vUv + texel * vec2(-1.0, -1.0)).rgb * 0.0625;
    o += texture2D(uInput, vUv + texel * vec2(0.0, -1.0)).rgb * 0.125;
    o += texture2D(uInput, vUv + texel * vec2(1.0, -1.0)).rgb * 0.0625;
    gl_FragColor = vec4(mix(srcColor.rgb, o, uAmount), srcColor.a);
  } else {
    gl_FragColor = srcColor;
  }
}
