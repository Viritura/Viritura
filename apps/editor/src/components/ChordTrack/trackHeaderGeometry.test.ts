import { describe, expect, it } from "vitest";
import { trackHeaderGeometry } from "./trackHeaderGeometry";

describe("optional sticky chord header", () => {
  it("pins the header to the available viewport edge", () => {
    const header = trackHeaderGeometry(-300, 0.75, true, 320);
    expect(header.left).toBe(328);
    expect(header.right).toBe(header.left + header.width);
  });

  it("lets the header scroll away when sticky mode is off", () => {
    const header = trackHeaderGeometry(-300, 0.75, false, 320);
    expect(header.right).toBe(-300);
  });

  it("keeps the cog reachable while scaling the label with the score", () => {
    expect(trackHeaderGeometry(500, 0.25, true).buttonSize).toBe(24);
    expect(trackHeaderGeometry(500, 2, true).buttonSize).toBe(36);
  });
});
