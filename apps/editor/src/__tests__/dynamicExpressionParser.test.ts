import { describe, it, expect } from "vitest";
import {
  parseDynamicExpression,
  isCompoundExpression,
  isCustomDynamic,
  dynamicToGlyph,
  measureDynamicGlyphs,
  measureExpressionGlyphs,
  tokensToGlyphString,
  tokensToLabel,
  parseMixedExpression,
  isMixedExpression,
  measureMixedExpression,
  mixedTokensToLabel,
} from "../radialMenu/dynamicExpressionParser";

describe("parseDynamicExpression", () => {
  it("parses single dynamic token", () => {
    const tokens = parseDynamicExpression("p");
    expect(tokens).toEqual([{ type: "dynamic", value: "p" }]);
  });

  it("parses compound p<f", () => {
    expect(parseDynamicExpression("p<f")).toEqual([
      { type: "dynamic", value: "p" },
      { type: "crescendo" },
      { type: "dynamic", value: "f" },
    ]);
  });

  it("parses spaced symbolic hairpins identically", () => {
    expect(parseDynamicExpression("p < f")).toEqual([
      { type: "dynamic", value: "p" },
      { type: "crescendo" },
      { type: "dynamic", value: "f" },
    ]);
    expect(parseDynamicExpression("f > p")).toEqual([
      { type: "dynamic", value: "f" },
      { type: "diminuendo" },
      { type: "dynamic", value: "p" },
    ]);
  });

  it("parses compound mf>pp", () => {
    expect(parseDynamicExpression("mf>pp")).toEqual([
      { type: "dynamic", value: "mf" },
      { type: "diminuendo" },
      { type: "dynamic", value: "pp" },
    ]);
  });

  it("parses triple fp<ff>p", () => {
    expect(parseDynamicExpression("fp<ff>p")).toEqual([
      { type: "dynamic", value: "fp" },
      { type: "crescendo" },
      { type: "dynamic", value: "ff" },
      { type: "diminuendo" },
      { type: "dynamic", value: "p" },
    ]);
  });

  it("parses standalone crescendo", () => {
    expect(parseDynamicExpression("<")).toEqual([{ type: "crescendo" }]);
  });

  it("parses standalone diminuendo", () => {
    expect(parseDynamicExpression(">")).toEqual([{ type: "diminuendo" }]);
  });

  it("parses partial p< (while typing)", () => {
    expect(parseDynamicExpression("p<")).toEqual([{ type: "dynamic", value: "p" }, { type: "crescendo" }]);
  });

  it("returns null for empty string", () => {
    expect(parseDynamicExpression("")).toBeNull();
  });

  it("returns null for invalid characters", () => {
    expect(parseDynamicExpression("p<x")).toBeNull();
    expect(parseDynamicExpression("abc")).toBeNull();
    expect(parseDynamicExpression("p+f")).toBeNull();
  });

  it("greedy: parses pp before two p tokens", () => {
    expect(parseDynamicExpression("pp")).toEqual([{ type: "dynamic", value: "pp" }]);
  });

  it("greedy: ppp is one token", () => {
    expect(parseDynamicExpression("ppp")).toEqual([{ type: "dynamic", value: "ppp" }]);
  });

  it("greedy: sfz is one token not sf + z fail", () => {
    expect(parseDynamicExpression("sfz")).toEqual([{ type: "dynamic", value: "sfz" }]);
  });

  it("parses sffz", () => {
    expect(parseDynamicExpression("sffz")).toEqual([{ type: "dynamic", value: "sffz" }]);
  });

  it("parses complex pp<ff>ppp", () => {
    expect(parseDynamicExpression("pp<ff>ppp")).toEqual([
      { type: "dynamic", value: "pp" },
      { type: "crescendo" },
      { type: "dynamic", value: "ff" },
      { type: "diminuendo" },
      { type: "dynamic", value: "ppp" },
    ]);
  });
});

describe("isCompoundExpression", () => {
  it("returns false for simple dynamics", () => {
    expect(isCompoundExpression("p")).toBe(false);
    expect(isCompoundExpression("ff")).toBe(false);
    expect(isCompoundExpression("sfz")).toBe(false);
  });

  it("returns true for expressions with hairpins", () => {
    expect(isCompoundExpression("p<f")).toBe(true);
    expect(isCompoundExpression("mf>pp")).toBe(true);
    expect(isCompoundExpression("<")).toBe(true);
    expect(isCompoundExpression(">")).toBe(true);
  });

  it("returns false for invalid expressions with hairpins", () => {
    expect(isCompoundExpression("p<x")).toBe(false);
  });

  it("returns false for empty", () => {
    expect(isCompoundExpression("")).toBe(false);
  });
});

describe("tokensToLabel", () => {
  it("formats p<f", () => {
    const tokens = parseDynamicExpression("p<f")!;
    expect(tokensToLabel(tokens)).toBe("p < f");
  });

  it("formats mf>pp", () => {
    const tokens = parseDynamicExpression("mf>pp")!;
    expect(tokensToLabel(tokens)).toBe("mf > pp");
  });
});

describe("tokensToGlyphString", () => {
  it("returns non-empty glyph string for p<f", () => {
    const tokens = parseDynamicExpression("p<f")!;
    const glyphs = tokensToGlyphString(tokens);
    expect(glyphs.length).toBeGreaterThan(0);
    // Should be 3 characters: dynamic p, crescendo hairpin, dynamic f
    expect(glyphs.length).toBe(3);
  });
});

describe("isCustomDynamic", () => {
  it("returns false for known precomposed dynamics", () => {
    expect(isCustomDynamic("p")).toBe(false);
    expect(isCustomDynamic("ff")).toBe(false);
    expect(isCustomDynamic("sfz")).toBe(false);
    expect(isCustomDynamic("mp")).toBe(false);
    expect(isCustomDynamic("n")).toBe(false);
  });

  it("returns true for valid letter combos not in precomposed map", () => {
    expect(isCustomDynamic("pmf")).toBe(true);
    expect(isCustomDynamic("fpp")).toBe(true);
    expect(isCustomDynamic("mfp")).toBe(true);
    expect(isCustomDynamic("zp")).toBe(true);
  });

  it("returns false for invalid characters", () => {
    expect(isCustomDynamic("abc")).toBe(false);
    expect(isCustomDynamic("px")).toBe(false);
    expect(isCustomDynamic("")).toBe(false);
  });

  it("returns false for strings with hairpins", () => {
    expect(isCustomDynamic("p<f")).toBe(false);
    expect(isCustomDynamic(">")).toBe(false);
  });
});

describe("dynamicToGlyph", () => {
  it("uses precomposed glyph for known dynamics", () => {
    expect(dynamicToGlyph("pp")).toBe("\uE52B");
    expect(dynamicToGlyph("sfz")).toBe("\uE539");
    expect(dynamicToGlyph("f")).toBe("\uE522");
  });

  it("builds from individual letter glyphs for custom dynamics", () => {
    // "pmf" → p(U+E520) + m(U+E521) + f(U+E522)
    expect(dynamicToGlyph("pmf")).toBe("\uE520\uE521\uE522");
  });

  it("builds single-letter custom from letter map", () => {
    expect(dynamicToGlyph("r")).toBe("\uE523");
    expect(dynamicToGlyph("z")).toBe("\uE525");
  });
});

describe("measureDynamicGlyphs", () => {
  it("returns single glyph for precomposed dynamics", () => {
    const result = measureDynamicGlyphs("ff");
    expect(result.glyphs).toHaveLength(1);
    expect(result.glyphs[0]!.x).toBe(0);
    expect(result.glyphs[0]!.glyph).toBe("\uE52F");
    expect(result.width).toBeCloseTo(2.436, 2);
  });

  it("returns individual glyphs with kerning for custom dynamics", () => {
    const result = measureDynamicGlyphs("sfffz");
    expect(result.glyphs).toHaveLength(5);
    // s starts at 0
    expect(result.glyphs[0]!.x).toBeCloseTo(0, 2);
    // first f starts at s-width (0.916)
    expect(result.glyphs[1]!.x).toBeCloseTo(0.916, 2);
    // second f is kerned with first f
    expect(result.glyphs[2]!.x).toBeCloseTo(0.916 + 1.456 - 0.476, 2);
    // third f kerned with second f
    expect(result.glyphs[3]!.x).toBeCloseTo(0.916 + (1.456 - 0.476) * 2, 2);
    // z kerned with f
    expect(result.glyphs[4]!.x).toBeCloseTo(0.916 + (1.456 - 0.476) * 2 + 1.456 - 0.444, 2);
  });

  it("sffz uses precomposed glyph", () => {
    const result = measureDynamicGlyphs("sffz");
    expect(result.glyphs).toHaveLength(1);
    expect(result.glyphs[0]!.glyph).toBe("\uE53B");
    expect(result.width).toBeCloseTo(3.856, 2);
  });
});

describe("measureExpressionGlyphs", () => {
  it("returns glyphs for compound p<f", () => {
    const tokens = parseDynamicExpression("p<f")!;
    const result = measureExpressionGlyphs(tokens);
    // p glyph + hairpin glyph + f glyph
    expect(result.glyphs).toHaveLength(3);
    expect(result.glyphs[0]!.x).toBe(0);
    expect(result.width).toBeGreaterThan(3);
  });
});

describe("parseMixedExpression", () => {
  it("parses 'p lovingly' into dynamic + text", () => {
    const tokens = parseMixedExpression("p lovingly");
    expect(tokens).toEqual([
      { type: "dynamic", value: "p" },
      { type: "text", value: "lovingly" },
    ]);
  });

  it("parses 'mf dolce' into dynamic + text", () => {
    const tokens = parseMixedExpression("mf dolce");
    expect(tokens).toEqual([
      { type: "dynamic", value: "mf" },
      { type: "text", value: "dolce" },
    ]);
  });

  it("merges consecutive text words", () => {
    const tokens = parseMixedExpression("p con amore");
    expect(tokens).toEqual([
      { type: "dynamic", value: "p" },
      { type: "text", value: "con amore" },
    ]);
  });

  it("handles multiple dynamic tokens with text between", () => {
    const tokens = parseMixedExpression("f molto p");
    expect(tokens).toEqual([
      { type: "dynamic", value: "f" },
      { type: "text", value: "molto" },
      { type: "dynamic", value: "p" },
    ]);
  });

  it("returns null for empty string", () => {
    expect(parseMixedExpression("")).toBeNull();
    expect(parseMixedExpression("   ")).toBeNull();
  });

  it("handles pure dynamic input", () => {
    const tokens = parseMixedExpression("pp");
    expect(tokens).toEqual([{ type: "dynamic", value: "pp" }]);
  });

  it("handles pure text input", () => {
    const tokens = parseMixedExpression("dolce");
    expect(tokens).toEqual([{ type: "text", value: "dolce" }]);
  });
});

describe("isMixedExpression", () => {
  it("returns true for 'p lovingly'", () => {
    expect(isMixedExpression("p lovingly")).toBe(true);
  });

  it("returns true for 'mf dolce'", () => {
    expect(isMixedExpression("mf dolce")).toBe(true);
  });

  it("returns false for pure dynamic 'pp'", () => {
    expect(isMixedExpression("pp")).toBe(false);
  });

  it("returns false for single word", () => {
    expect(isMixedExpression("dolce")).toBe(false);
  });

  it("returns false for 'p f' (two dynamics, no text)", () => {
    expect(isMixedExpression("p f")).toBe(false);
  });

  it("returns false for pure text 'con amore'", () => {
    expect(isMixedExpression("con amore")).toBe(false);
  });
});

describe("measureMixedExpression", () => {
  it("returns elements for 'p lovingly'", () => {
    const tokens = parseMixedExpression("p lovingly")!;
    const result = measureMixedExpression(tokens);
    expect(result.elements.length).toBeGreaterThanOrEqual(2);
    expect(result.elements[0]!.type).toBe("glyph");
    expect(result.elements[1]!.type).toBe("text");
    expect(result.elements[1]!.content).toBe("lovingly");
    expect(result.width).toBeGreaterThan(0);
  });
});

describe("mixedTokensToLabel", () => {
  it("converts mixed tokens to label", () => {
    const tokens = parseMixedExpression("p lovingly")!;
    expect(mixedTokensToLabel(tokens)).toBe("p lovingly");
  });

  it("converts complex mixed tokens to label", () => {
    const tokens = parseMixedExpression("mf con amore")!;
    expect(mixedTokensToLabel(tokens)).toBe("mf con amore");
  });
});
