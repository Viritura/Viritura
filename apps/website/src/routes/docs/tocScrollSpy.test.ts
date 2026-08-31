import { describe, expect, it } from "vitest";
import { findActiveTocHeading } from "./tocScrollSpy";

const headings = [
  { id: "first", top: -240 },
  { id: "second", top: 80 },
  { id: "third", top: 420 },
];

describe("findActiveTocHeading", () => {
  it("selects the last heading above the activation offset", () => {
    expect(findActiveTocHeading(headings, 112)).toBe("second");
  });

  it("selects the first heading before the reader reaches it", () => {
    expect(
      findActiveTocHeading(
        headings.map((heading) => ({ ...heading, top: heading.top + 400 })),
        112,
      ),
    ).toBe("first");
  });

  it("selects the final heading at the bottom of the page", () => {
    expect(
      findActiveTocHeading(
        headings.map((heading) => ({ ...heading, top: heading.top - 500 })),
        112,
      ),
    ).toBe("third");
  });
});
