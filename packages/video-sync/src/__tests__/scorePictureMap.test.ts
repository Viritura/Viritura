import { describe, expect, it } from "vitest";
import {
  hasPictureAt,
  mediaTimeForScoreTime,
  offsetAligning,
  placeScoreTime,
  scoreTimeForMediaTime,
} from "../scorePictureMap";

describe("scorePictureMap", () => {
  const mapping = { pictureOffsetSeconds: 120, mediaDurationSeconds: 600 };

  it("maps score time onto the picture through the offset", () => {
    expect(mediaTimeForScoreTime(0, mapping)).toBe(120);
    expect(mediaTimeForScoreTime(30, mapping)).toBe(150);
  });

  it("inverts exactly", () => {
    for (const scoreTime of [0, 1.5, 42.125, 300]) {
      expect(scoreTimeForMediaTime(mediaTimeForScoreTime(scoreTime, mapping), mapping)).toBeCloseTo(scoreTime, 10);
    }
  });

  it("clamps before the first frame and flags it as outside the picture", () => {
    const placement = placeScoreTime(-200, mapping);
    expect(placement.mediaTime).toBe(0);
    expect(placement.outsidePicture).toBe(true);
  });

  it("clamps past the last frame and flags it as outside the picture", () => {
    const placement = placeScoreTime(1000, mapping);
    expect(placement.mediaTime).toBe(600);
    expect(placement.outsidePicture).toBe(true);
  });

  it("keeps a count-in inside the picture when the offset covers it", () => {
    // -2s of count-in with a 120s offset still lands at 118s of picture.
    const placement = placeScoreTime(-2, mapping);
    expect(placement.mediaTime).toBe(118);
    expect(placement.outsidePicture).toBe(false);
    expect(hasPictureAt(-2, mapping)).toBe(true);
  });

  it("does not clamp when the media duration is unknown", () => {
    const openEnded = { pictureOffsetSeconds: 0 };
    expect(placeScoreTime(9999, openEnded)).toEqual({ mediaTime: 9999, outsidePicture: false });
  });

  it("still clamps below zero when the media duration is unknown", () => {
    expect(placeScoreTime(-5, { pictureOffsetSeconds: 0 })).toEqual({ mediaTime: 0, outsidePicture: true });
  });

  it("derives the offset that aligns a musical moment with a frame", () => {
    // Park the score at 12s, want the frame at 74s: offset must be 62.
    const offset = offsetAligning(12, 74);
    expect(offset).toBe(62);
    expect(mediaTimeForScoreTime(12, { pictureOffsetSeconds: offset })).toBe(74);
  });

  it("supports a negative offset for a score that starts before the picture", () => {
    const negative = { pictureOffsetSeconds: -10, mediaDurationSeconds: 100 };
    expect(placeScoreTime(5, negative)).toEqual({ mediaTime: 0, outsidePicture: true });
    expect(placeScoreTime(15, negative)).toEqual({ mediaTime: 5, outsidePicture: false });
  });
});
