import { describe, expect, it } from "vitest";
import { parseClickGroupingInput } from "./clickGroupingInput";

describe("parseClickGroupingInput", () => {
  it("accepts plus, comma, and whitespace separators with surrounding spaces", () => {
    expect(parseClickGroupingInput("3 + 3, 2 2+2")).toEqual([3, 3, 2, 2, 2]);
  });

  it("rejects malformed or repeated punctuation separators", () => {
    for (const input of ["+3", "3,,2", "3 + ,2", "3x2", "3,"]) {
      expect(parseClickGroupingInput(input)).toBeUndefined();
    }
  });

  it("parses long repeated whitespace groups without regex backtracking", () => {
    const input = `0${"  0".repeat(10_000)}`;
    const groups = parseClickGroupingInput(input);

    expect(groups).toHaveLength(10_001);
    expect(groups?.[10_000]).toBe(0);
  });
});
