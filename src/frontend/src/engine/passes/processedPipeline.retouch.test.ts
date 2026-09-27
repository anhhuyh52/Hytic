import { Texture } from "three";
import { describe, expect, it } from "vitest";
import { createRetouchSpot } from "../../features/retouch/retouchStore";
import {
  buildProcessedFragmentShader,
  buildRetouchContextFragmentShader,
  createProcessedUniforms,
  setProcessedRetouchState,
} from "./processedPipeline";

describe("processed pipeline retouch ordering", () => {
  it("applies Spot Removal before the global grade LUT", () => {
    const shader = buildProcessedFragmentShader("2d-atlas");
    const main = shader.slice(shader.indexOf("void main()"));
    const retouchIndex = main.indexOf("applySpotRetouch(src.rgb, imageUv)");
    const gradeIndex = main.indexOf("sampleGradedLUT(");

    expect(retouchIndex).toBeGreaterThanOrEqual(0);
    expect(gradeIndex).toBeGreaterThan(retouchIndex);
    expect(main).toContain("vec3 lutSource = uAcesLinearInput ? lin2cct(max(retouchedSource");
  });

  it("uses destination context plus source detail for Heal", () => {
    const shader = buildProcessedFragmentShader("2d-atlas");
    const healBranch = shader.slice(shader.indexOf("if (uSpotModes[index] > 0.5)"));

    expect(shader).toContain("vec3 sourceOriginal = texture2D(uImage, sampleUv).rgb;");
    expect(healBranch).toContain("texture2D(uSmoothTexture, sampleUv)");
    expect(healBranch).toContain("vec4 destinationContext = texture2D(");
    expect(healBranch).toContain("uRetouchContextTexture");
    expect(healBranch).toContain("min(destinationContext.a / 0.05, 1.0)");
    expect(healBranch).toContain(
      "vec3 sourceDetail = (sourceOriginal + (1.0 - sourceSmooth)) * 0.5;",
    );
    expect(healBranch).toContain("replacement = retouchLinearLight(contextBase, sourceDetail)");
  });

  it("builds the destination context map from base RGB and Heal mask alpha", () => {
    const shader = buildRetouchContextFragmentShader();

    expect(shader).toContain("vec3 baseImage = texture2D(uImage, sampleUv).rgb;");
    expect(shader).toContain("if (uSpotModes[index] < 0.5) continue;");
    expect(shader).toContain("retouchDestinationMask(");
    expect(shader).toContain("gl_FragColor = vec4(baseImage, spotMaskAlpha);");
  });

  it("keeps source-detail and destination-context textures independent", () => {
    const uniforms = createProcessedUniforms();
    const sourceSmooth = new Texture();
    const destinationContext = new Texture();

    setProcessedRetouchState(
      uniforms,
      { enabled: true, bypass: false, spots: [createRetouchSpot()] },
      sourceSmooth,
      destinationContext,
    );

    expect(uniforms.uSmoothTexture.value).toBe(sourceSmooth);
    expect(uniforms.uRetouchContextTexture.value).toBe(destinationContext);
  });

  it("does not upload disabled spots to the renderer", () => {
    const disabled = createRetouchSpot();
    disabled.disabled = true;
    const active = createRetouchSpot();
    active.position = [0.1, -0.2];
    const uniforms = createProcessedUniforms();

    setProcessedRetouchState(
      uniforms,
      { enabled: true, bypass: false, spots: [disabled, active] },
      null,
    );

    expect(uniforms.uSpotCount.value).toBe(1);
    expect(uniforms.uSpotPositions.value[0].toArray()).toEqual([0.1, -0.2]);
  });
});
