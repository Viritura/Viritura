import { describe, it, expect } from "vitest";
import { PieceText, applyTextEdit, diffText, revertTextEdit } from "../historyTextEdit";

describe("history text edits", () => {
  it("finds the minimal span on large documents across block boundaries", () => {
    const base = Array.from({ length: 5000 }, (_, i) => `{"m":${i}}`).join(",");
    for (const offset of [0, 1023, 1024, 1025, base.length - 1025, base.length - 1]) {
      const after = `${base.slice(0, offset)}XY${base.slice(offset + 1)}`;
      const edit = diffText(base, after);
      expect(edit.removed.length + edit.inserted.length).toBeLessThanOrEqual(3);
      expect(applyTextEdit(base, edit)).toBe(after);
      expect(revertTextEdit(after, edit)).toBe(base);
    }
  });

  it("handles identical, emptied and appended documents", () => {
    expect(diffText("same", "same")).toEqual({ start: 4, removed: "", inserted: "" });
    expect(applyTextEdit("abc", diffText("abc", ""))).toBe("");
    expect(applyTextEdit("", diffText("", "abc"))).toBe("abc");
  });

  it("replays chains of edits through the piece list", () => {
    const texts = ["", "abc", "abXc", "XbXc", "XbXcdef", "Xef"];
    const edits = texts.slice(1).map((text, i) => diffText(texts[i]!, text));
    const forward = new PieceText(texts[0]!);
    for (const edit of edits) forward.apply(edit);
    expect(forward.toString()).toBe(texts.at(-1));

    const backward = new PieceText(texts.at(-1)!);
    for (const edit of [...edits].reverse()) backward.revert(edit);
    expect(backward.toString()).toBe(texts[0]);
  });
});
