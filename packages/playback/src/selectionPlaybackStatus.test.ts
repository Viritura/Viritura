import { describe, expect, it } from "vitest";
import { selectionPlaybackStatus } from "./selectionPlaybackStatus";

describe("selectionPlaybackStatus", () => {
  it("omits the status when playback is not filtered", () => {
    expect(selectionPlaybackStatus(null)).toBeNull();
  });

  it("uses singular selected-staff wording", () => {
    expect(selectionPlaybackStatus(1)).toEqual({
      badgeText: "1 selected staff",
      accessibleDescription: "Playback limited to 1 selected staff.",
    });
  });

  it("uses plural selected-staves wording", () => {
    expect(selectionPlaybackStatus(3)).toEqual({
      badgeText: "3 selected staves",
      accessibleDescription: "Playback limited to 3 selected staves.",
    });
  });
});
