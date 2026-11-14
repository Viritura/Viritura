import { describe, expect, it } from "vitest";
import { BARLINE_PALETTE_ITEMS, TIME_SIG_PALETTE_ITEMS } from "../components/palette/paletteItems";
import { BARLINE_ITEMS, resolveBarline } from "../radialMenu/barlineMenu";
import { TIME_SIGNATURE_ITEMS, resolveTimeSignature } from "../radialMenu/timeSignatureMenu";

describe("structural palette and radial menu items", () => {
  it.each([
    ["heavyLight", "Heavy-light"],
    ["heavyHeavy", "Heavy-heavy"],
    ["noBarline", "No barline"],
  ] as const)("exposes %s in both barline surfaces", (id, label) => {
    expect(BARLINE_PALETTE_ITEMS).toContainEqual(expect.objectContaining({ id, label }));
    expect(BARLINE_ITEMS).toContainEqual(expect.objectContaining({ id, label }));
    expect(resolveBarline(id)).toEqual({ type: id });
  });

  it("offers open meter in both time-signature surfaces", () => {
    expect(TIME_SIG_PALETTE_ITEMS).toContainEqual(expect.objectContaining({ id: "senza-misura" }));
    expect(TIME_SIGNATURE_ITEMS).toContainEqual(expect.objectContaining({ id: "senza-misura" }));
    expect(resolveTimeSignature("senza-misura")).toEqual({ count: 4, unit: 4, display: "senzaMisura" });
  });

  it("omits the note-value engraving preference from time-signature choices", () => {
    expect(TIME_SIG_PALETTE_ITEMS).not.toContainEqual(expect.objectContaining({ id: "note-denominator" }));
    expect(TIME_SIGNATURE_ITEMS).not.toContainEqual(expect.objectContaining({ id: "note-denominator" }));
    expect(resolveTimeSignature("note-denominator")).toBeNull();
  });
});
