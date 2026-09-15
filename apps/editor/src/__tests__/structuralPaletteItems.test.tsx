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

  it.each([
    ["senza-misura", "senzaMisura"],
    ["note-denominator", "note"],
  ] as const)("authors the %s time-signature display", (id, display) => {
    expect(TIME_SIG_PALETTE_ITEMS).toContainEqual(expect.objectContaining({ id }));
    expect(TIME_SIGNATURE_ITEMS).toContainEqual(expect.objectContaining({ id }));
    expect(resolveTimeSignature(id)).toEqual({ count: 4, unit: 4, display });
  });
});
