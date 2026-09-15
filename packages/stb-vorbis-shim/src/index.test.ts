import { describe, expect, it } from "vitest";
import { StbVorbis } from "./index";

describe("StbVorbis SF2-only shim", () => {
  it("is immediately ready", async () => {
    await expect(StbVorbis.ready).resolves.toBeUndefined();
  });

  it("rejects SF3 decoding explicitly", () => {
    expect(() => StbVorbis.decode(new Uint8Array())).toThrow(
      "SF3 decoding is unavailable in this Viritura build; only SF2 SoundFonts are supported.",
    );
  });
});
