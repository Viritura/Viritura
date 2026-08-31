import { describe, expect, it } from "vitest";
import { findPageSizePreset, formatPageSizeLabel, formatStaffSizeLabel } from "../model/layout";

describe("findPageSizePreset", () => {
  it("matches A4 in mm", () => {
    expect(findPageSizePreset(210, 297)).toBe("A4");
  });

  it("matches Letter (in)", () => {
    expect(findPageSizePreset(215.9, 279.4)).toBe("Letter");
  });

  it("matches landscape orientation", () => {
    expect(findPageSizePreset(297, 210)).toBe("A4");
  });

  it("returns null for unknown sizes", () => {
    expect(findPageSizePreset(180, 200)).toBeNull();
  });

  it("respects tolerance", () => {
    expect(findPageSizePreset(210.3, 297.2)).toBe("A4");
    expect(findPageSizePreset(213, 297)).toBeNull();
  });
});

describe("formatPageSizeLabel", () => {
  it("formats A4 in mm", () => {
    expect(formatPageSizeLabel(210, 297)).toBe("A4 (210 × 297 mm)");
  });

  it("formats Letter in inches", () => {
    expect(formatPageSizeLabel(215.9, 279.4)).toBe("Letter (8.5 × 11 in)");
  });

  it("formats Tabloid in inches", () => {
    expect(formatPageSizeLabel(279.4, 431.8)).toBe("Tabloid (11 × 17 in)");
  });

  it("flips orientation for landscape", () => {
    expect(formatPageSizeLabel(297, 210)).toBe("A4 (297 × 210 mm)");
    expect(formatPageSizeLabel(279.4, 215.9)).toBe("Letter (11 × 8.5 in)");
  });

  it("falls back to mm for custom sizes", () => {
    expect(formatPageSizeLabel(180, 240)).toBe("180 × 240 mm");
  });
});

describe("formatStaffSizeLabel", () => {
  it("computes staff height as 4 × spatium", () => {
    // Rastral 2: spatium 1.75 → 7mm staff
    expect(formatStaffSizeLabel(1.75)).toBe("7 mm staff");
    // Rastral 6 (default full score): spatium 1.25 → 5mm staff
    expect(formatStaffSizeLabel(1.25)).toBe("5 mm staff");
  });

  it("renders fractional staff sizes", () => {
    expect(formatStaffSizeLabel(1.875)).toBe("7.5 mm staff");
    expect(formatStaffSizeLabel(1.625)).toBe("6.5 mm staff");
  });
});
