precision highp float;

// Diffusion prep pass: a plain copy that downsamples the graded base image into the
// blur-resolution render target. The legacy diffusion bloom blurs the whole image (no
// threshold extraction) — fog / threshold / focus-protection happen in the composite.
uniform sampler2D uInput;

varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(uInput, vUv).rgb, 1.0);
}
