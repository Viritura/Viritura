import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeSigGlyph, TimeSignatureStaffPreview } from "./GlyphRenderers";

describe("time signature previews", () => {
  it.each([
    { count: 4, unit: 4 },
    { count: 12, unit: 8 },
    { count: 4, unit: 4, numeralStyle: "noteValue" as const },
  ])("shows larger palette symbols without staff lines for $count/$unit", (props) => {
    const { container } = render(<TimeSigGlyph {...props} />);
    const svg = container.querySelector("svg")!;

    expect(svg.querySelectorAll("line")).toHaveLength(0);
    expect(svg.querySelector("text")?.getAttribute("font-size")).toBe("30");
    expect(Number(svg.getAttribute("width"))).toBeLessThanOrEqual(40);
    expect(Number(svg.getAttribute("height"))).toBeLessThanOrEqual(44);
  });

  it("preserves explicit staff bounds in Setup previews", () => {
    const { container } = render(
      <TimeSignatureStaffPreview count={4} unit={4} width={128} staffStart={10} staffEnd={118} />,
    );

    const lines = container.querySelectorAll("line");
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.getAttribute("x1")).toBe("10");
      expect(line.getAttribute("x2")).toBe("118");
    }
  });
});
