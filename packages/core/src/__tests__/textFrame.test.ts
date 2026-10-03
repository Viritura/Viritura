import { describe, expect, expectTypeOf, it } from "vitest";
import { plainTextContent, type TextBlock, type TextFrame, type TextFrameWidth } from "../model";

describe("TextFrame model", () => {
  it("shares optional block presentation without requiring page attachment", () => {
    const plain: TextBlock = { content: [{ text: "dolce" }] };
    const boxed: TextBlock = { ...plain, border: "solid", padding: 1, paragraphJustification: "center" };

    expect(plainTextContent(boxed.content)).toBe(plainTextContent(plain.content));
    expect(plain.width).toBeUndefined();
    expect(boxed.border).toBe("solid");
    expectTypeOf<TextFrame>().toExtend<TextBlock>();
    expectTypeOf<Pick<TextFrame, "width">>().toEqualTypeOf<{ width: TextFrameWidth }>();
    expectTypeOf<Pick<TextBlock, "width">>().toEqualTypeOf<{ width?: TextFrameWidth }>();
  });

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
