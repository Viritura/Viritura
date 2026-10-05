import { describe, expect, it } from "vitest";
import { rangeForOffsets, textOffsetsOf } from "./textContentEditorDom";
import { htmlForTextContent } from "./textContentEditorModel";

describe("multiline editor selection", () => {
  it("restores every caret position across blank lines, glyphs, and trailing newlines", () => {
    const editor = document.createElement("div");
    editor.innerHTML = htmlForTextContent([{ text: "first\n\n" }, { glyphs: ["dynamicPP"] }, { text: "\nlast\n\n" }]);
    for (let offset = 0; offset <= 15; offset++) {
      expect(textOffsetsOf(editor, rangeForOffsets(editor, offset, offset))).toEqual([offset, offset]);
    }
    expect(textOffsetsOf(editor, rangeForOffsets(editor, 7, 13))).toEqual([7, 13]);
  });

  it("ignores native trailing placeholders and includes empty paragraph boundaries", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "first<br><br>";
    const range = document.createRange();
    range.selectNodeContents(editor);
    expect(textOffsetsOf(editor, range)).toEqual([0, 6]);
    editor.innerHTML = "<div>first</div><div><br></div><div>last</div>";
    for (let offset = 0; offset <= 11; offset++) {
      expect(textOffsetsOf(editor, rangeForOffsets(editor, offset, offset))).toEqual([offset, offset]);
    }
  });
});
