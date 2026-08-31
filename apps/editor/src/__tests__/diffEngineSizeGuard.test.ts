import { describe, it, expect } from "vitest";
import { contentExceedsCap } from "../hooks/useDiffEngine";

// ─── Diff-engine size guard ──────────────────────────────────────
//
// The Review view pretty-prints MNX (2-space indent) before diffing, which
// inflates the source ~3× with cosmetic whitespace. The "too large to diff"
// guard must measure the *content* size (whitespace stripped), not the raw
// pretty length, so a legitimately-large-but-feasible orchestral score isn't
// refused a diff purely because it was indented. See useDiffEngine.ts.

describe("contentExceedsCap", () => {
  it("short-circuits when the raw length is already under the cap", () => {
    expect(contentExceedsCap("{}", 100)).toBe(false);
    expect(contentExceedsCap("a".repeat(50), 100)).toBe(false);
  });

  it("counts only non-whitespace content, not pretty-print indentation", () => {
    // 10 content chars wrapped in lots of indentation whitespace.
    const content = "1234567890";
    const pretty = content
      .split("")
      .map((c) => "      " + c + "\n") // 6 spaces + char + newline per line
      .join("");
    expect(pretty.length).toBeGreaterThan(50); // raw length is well over the cap
    // Content is only 10 chars, so a cap of 20 is NOT exceeded despite the
    // raw string being much longer than 20.
    expect(contentExceedsCap(pretty, 20)).toBe(false);
  });

  it("reports oversize when real content exceeds the cap", () => {
    const big = "x".repeat(200); // all content, no whitespace
    expect(contentExceedsCap(big, 100)).toBe(true);
  });

  it("treats space, tab, CR and LF as whitespace", () => {
    const whitespaceOnly = " \t\r\n".repeat(1000);
    expect(contentExceedsCap(whitespaceOnly, 10)).toBe(false);
  });

  it("mirrors the real case: a ~3x pretty-printed score under the content cap passes", () => {
    // Simulate the Rhapsody situation in miniature: content ~= cap*0.5,
    // pretty length ~= cap*1.5 (over the raw cap, under the content cap).
    const cap = 1000;
    const content = "n".repeat(500); // 500 content chars (under cap)
    const inflated = content.split("").join("  \n  "); // pad each char with whitespace
    expect(inflated.length).toBeGreaterThan(cap); // raw length exceeds the cap
    expect(contentExceedsCap(inflated, cap)).toBe(false); // but content does not
  });
});
