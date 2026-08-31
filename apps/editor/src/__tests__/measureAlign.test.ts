import { describe, it, expect } from "vitest";
import { alignMeasures, stableStringify } from "../diff/measureAlign";

describe("stableStringify", () => {
  it("produces identical output regardless of key order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("handles nested objects with different key orders", () => {
    const a = { outer: { b: 2, a: 1 } };
    const b = { outer: { a: 1, b: 2 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe("alignMeasures", () => {
  it("aligns identical arrays", () => {
    const measures = [{ notes: "C" }, { notes: "D" }, { notes: "E" }];
    const result = alignMeasures(measures, measures);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.status === "matched")).toBe(true);
    expect(result[0].originalIndex).toBe(0);
    expect(result[0].modifiedIndex).toBe(0);
    expect(result[2].originalIndex).toBe(2);
    expect(result[2].modifiedIndex).toBe(2);
  });

  it("detects a single insertion in the middle", () => {
    const original = [{ n: "A" }, { n: "B" }, { n: "C" }];
    const modified = [{ n: "A" }, { n: "X" }, { n: "B" }, { n: "C" }];
    const result = alignMeasures(original, modified);

    // Should be: matched(A), inserted(X), matched(B), matched(C)
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ status: "matched", originalIndex: 0, modifiedIndex: 0 });
    expect(result[1]).toEqual({ status: "inserted", modifiedIndex: 1 });
    expect(result[2]).toEqual({ status: "matched", originalIndex: 1, modifiedIndex: 2 });
    expect(result[3]).toEqual({ status: "matched", originalIndex: 2, modifiedIndex: 3 });
  });

  it("detects a single deletion in the middle", () => {
    const original = [{ n: "A" }, { n: "B" }, { n: "C" }];
    const modified = [{ n: "A" }, { n: "C" }];
    const result = alignMeasures(original, modified);

    // Should be: matched(A), deleted(B), matched(C)
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: "matched", originalIndex: 0, modifiedIndex: 0 });
    expect(result[1]).toEqual({ status: "deleted", originalIndex: 1 });
    expect(result[2]).toEqual({ status: "matched", originalIndex: 2, modifiedIndex: 1 });
  });

  it("detects insertion at the beginning", () => {
    const original = [{ n: "B" }, { n: "C" }];
    const modified = [{ n: "A" }, { n: "B" }, { n: "C" }];
    const result = alignMeasures(original, modified);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: "inserted", modifiedIndex: 0 });
    expect(result[1]).toEqual({ status: "matched", originalIndex: 0, modifiedIndex: 1 });
    expect(result[2]).toEqual({ status: "matched", originalIndex: 1, modifiedIndex: 2 });
  });

  it("detects insertion at the end", () => {
    const original = [{ n: "A" }, { n: "B" }];
    const modified = [{ n: "A" }, { n: "B" }, { n: "C" }];
    const result = alignMeasures(original, modified);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: "matched", originalIndex: 0, modifiedIndex: 0 });
    expect(result[1]).toEqual({ status: "matched", originalIndex: 1, modifiedIndex: 1 });
    expect(result[2]).toEqual({ status: "inserted", modifiedIndex: 2 });
  });

  it("detects deletion at the beginning", () => {
    const original = [{ n: "A" }, { n: "B" }, { n: "C" }];
    const modified = [{ n: "B" }, { n: "C" }];
    const result = alignMeasures(original, modified);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: "deleted", originalIndex: 0 });
    expect(result[1]).toEqual({ status: "matched", originalIndex: 1, modifiedIndex: 0 });
    expect(result[2]).toEqual({ status: "matched", originalIndex: 2, modifiedIndex: 1 });
  });

  it("handles completely different arrays", () => {
    const original = [{ n: "A" }, { n: "B" }];
    const modified = [{ n: "X" }, { n: "Y" }];
    const result = alignMeasures(original, modified);

    // All paired as modified (adjacent deleted+inserted merged)
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.status === "modified")).toBe(true);
  });

  it("handles empty original", () => {
    const modified = [{ n: "A" }, { n: "B" }];
    const result = alignMeasures([], modified);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.status === "inserted")).toBe(true);
  });

  it("handles empty modified", () => {
    const original = [{ n: "A" }, { n: "B" }];
    const result = alignMeasures(original, []);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.status === "deleted")).toBe(true);
  });

  it("handles both empty", () => {
    const result = alignMeasures([], []);
    expect(result).toHaveLength(0);
  });

  it("handles multiple insertions and deletions", () => {
    const original = [{ n: "A" }, { n: "B" }, { n: "C" }, { n: "D" }];
    const modified = [{ n: "A" }, { n: "X" }, { n: "C" }, { n: "Y" }];
    const result = alignMeasures(original, modified);

    // LCS is [A, C], so: matched(A), modified(B→X), matched(C), modified(D→Y)
    const matched = result.filter((e) => e.status === "matched");
    expect(matched).toHaveLength(2);
    expect(matched[0].originalIndex).toBe(0);
    expect(matched[1].originalIndex).toBe(2);
  });

  it("merges adjacent deleted+inserted into modified", () => {
    const original = [{ n: "A" }];
    const modified = [{ n: "B" }];
    const result = alignMeasures(original, modified);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("modified");
    expect(result[0].originalIndex).toBe(0);
    expect(result[0].modifiedIndex).toBe(0);
  });

  it("handles duplicate measures correctly", () => {
    const original = [{ n: "A" }, { n: "A" }, { n: "B" }];
    const modified = [{ n: "A" }, { n: "B" }];
    const result = alignMeasures(original, modified);

    // One A is deleted, the other matches, B matches
    const matched = result.filter((e) => e.status === "matched");
    const deleted = result.filter((e) => e.status === "deleted");
    expect(matched).toHaveLength(2);
    expect(deleted).toHaveLength(1);
  });

  it("is insensitive to object key order in measures", () => {
    const original = [{ a: 1, b: 2 }];
    const modified = [{ b: 2, a: 1 }];
    const result = alignMeasures(original, modified);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("matched");
  });
});
