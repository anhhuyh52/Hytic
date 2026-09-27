precision highp float;

uniform sampler2D uInput;
uniform vec2 uTexelSize;
uniform float uRadius;

varying vec2 vUv;

void main() {
  vec2 dir = vec2(uTexelSize.x, 0.0) * max(uRadius, 0.0);
  vec4 color = texture2D(uInput, vUv) * 0.19648255;
  color += texture2D(uInput, vUv + dir * -6.0) * 0.01799699;
  color += texture2D(uInput, vUv + dir * -5.0) * 0.03247038;
  color += texture2D(uInput, vUv + dir * -4.0) * 0.05467002;
  color += texture2D(uInput, vUv + dir * -3.0) * 0.08627947;
  color += texture2D(uInput, vUv + dir * -2.0) * 0.12098536;
  color += texture2D(uInput, vUv + dir * -1.0) * 0.15057262;
  color += texture2D(uInput, vUv + dir * 1.0) * 0.15057262;
  color += texture2D(uInput, vUv + dir * 2.0) * 0.12098536;
  color += texture2D(uInput, vUv + dir * 3.0) * 0.08627947;
  color += texture2D(uInput, vUv + dir * 4.0) * 0.05467002;
  color += texture2D(uInput, vUv + dir * 5.0) * 0.03247038;
  color += texture2D(uInput, vUv + dir * 6.0) * 0.01799699;
  gl_FragColor = color;
}
