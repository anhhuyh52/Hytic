import { describe, expect, it } from "vitest";
import { RELAY_ORIGIN, relayHref } from "./domains";

describe("optional relay endpoint", () => {
  it("uses only the deployment-provided relay origin", () => {
    expect(relayHref()).toBe(RELAY_ORIGIN);
  });
});
