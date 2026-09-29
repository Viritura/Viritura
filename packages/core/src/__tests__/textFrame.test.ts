import { describe, expect, it } from "vitest";
import { plainTextContent, type TextFrame } from "../model";

describe("TextFrame model", () => {
  it("uses shared text content without changing authored newlines", () => {
    const frame: TextFrame = {
      id: "title-block",
      locator: { type: "page", pageIndex: 0 },
      placement: { anchor: "top-left", offset: { x: 2, y: -1 } },
      width: { unit: "textColumnFraction", value: 0.5 },
      content: [{ text: "First line\nSecond line" }],
    };

    expect(plainTextContent(frame.content)).toBe("First line\nSecond line");
  });
});
