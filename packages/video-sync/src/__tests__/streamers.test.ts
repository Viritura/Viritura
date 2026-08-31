import { describe, expect, it } from "vitest";
import { DEFAULT_STREAMER_SECONDS, streamerState, streamerX } from "../streamers";
import type { TimelineHit } from "../timelineTypes";

function hit(id: string, pictureSeconds: number, locked = true): TimelineHit {
  return { id, pictureSeconds, locked };
}

const OPTIONS = { frameRate: 24 };

describe("streamers", () => {
  it("shows nothing when no hit is near", () => {
    expect(streamerState(0, [hit("a", 30)], OPTIONS)).toEqual({
      streamers: [],
      punch: false,
      warning: false,
    });
  });

  it("starts the line one streamer length before the hit", () => {
    const at = 10 - DEFAULT_STREAMER_SECONDS;
    expect(streamerState(at - 0.1, [hit("a", 10)], OPTIONS).streamers).toHaveLength(0);
    expect(streamerState(at + 0.01, [hit("a", 10)], OPTIONS).streamers).toHaveLength(1);
  });

  it("arrives at the right edge exactly on the hit", () => {
    // The direction conductors read: the line reaches the edge as the cue lands.
    expect(streamerState(10, [hit("a", 10)], OPTIONS).streamers[0]?.progress).toBeCloseTo(1, 9);
    expect(streamerState(9, [hit("a", 10)], OPTIONS).streamers[0]?.progress).toBeCloseTo(0.5, 9);
  });

  it("clears the moment the hit passes", () => {
    expect(streamerState(10.01, [hit("a", 10)], OPTIONS).streamers).toHaveLength(0);
  });

  it("carries the hit's label so the podium knows what is coming", () => {
    const labelled: TimelineHit = { id: "a", pictureSeconds: 10, label: "door slams", locked: true };
    expect(streamerState(9, [labelled], OPTIONS).streamers[0]?.label).toBe("door slams");
  });

  it("runs two streamers at once when hits crowd", () => {
    const state = streamerState(9.5, [hit("a", 10), hit("b", 10.8)], OPTIONS);
    expect(state.streamers).toHaveLength(2);
  });

  it("ignores unlocked hits", () => {
    // An unlocked hit is a note about the film, not a commitment. Flashing the
    // podium for one would teach the conductor to distrust the whole system.
    expect(streamerState(9, [hit("a", 10, false)], OPTIONS).streamers).toHaveLength(0);
  });
});

describe("punches", () => {
  it("lights on the hit frame", () => {
    expect(streamerState(10, [hit("a", 10)], OPTIONS).punch).toBe(true);
  });

  it("straddles the hit rather than following it", () => {
    // The conductor is aiming at the frame, so the flash has to be on it.
    expect(streamerState(10 - 1 / 24, [hit("a", 10)], OPTIONS).punch).toBe(true);
    expect(streamerState(10 + 1 / 24, [hit("a", 10)], OPTIONS).punch).toBe(true);
  });

  it("is short enough to read as a flash, not a smear", () => {
    expect(streamerState(10 + 3 / 24, [hit("a", 10)], OPTIONS).punch).toBe(false);
  });

  it("scales its window with the frame rate", () => {
    // Two frames at 48 fps is half as long in seconds as at 24.
    const fast = { frameRate: 48 };
    expect(streamerState(10 + 1.5 / 24, [hit("a", 10)], fast).punch).toBe(false);
    expect(streamerState(10 + 1.5 / 48, [hit("a", 10)], fast).punch).toBe(true);
  });
});

describe("warning punches", () => {
  it("appears at whole seconds ahead of the streamer", () => {
    const streamerStart = 10 - DEFAULT_STREAMER_SECONDS;
    expect(streamerState(streamerStart - 1, [hit("a", 10)], OPTIONS).warning).toBe(true);
    expect(streamerState(streamerStart - 2, [hit("a", 10)], OPTIONS).warning).toBe(true);
    expect(streamerState(streamerStart - 1.5, [hit("a", 10)], OPTIONS).warning).toBe(false);
  });

  it("can be turned off", () => {
    const streamerStart = 10 - DEFAULT_STREAMER_SECONDS;
    const state = streamerState(streamerStart - 1, [hit("a", 10)], { ...OPTIONS, warnings: false });
    expect(state.warning).toBe(false);
  });
});

describe("streamerX", () => {
  it("clamps to the frame", () => {
    expect(streamerX(-1)).toBe(0);
    expect(streamerX(2)).toBe(1);
    expect(streamerX(0.25)).toBe(0.25);
  });
});

describe("degenerate input", () => {
  it("draws nothing rather than dividing by zero", () => {
    expect(streamerState(0, [hit("a", 1)], { frameRate: 0 }).streamers).toHaveLength(0);
    expect(streamerState(NaN, [hit("a", 1)], OPTIONS).streamers).toHaveLength(0);
  });
});
