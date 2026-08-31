import { describe, it, expect } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

function withHits(hitPoints: unknown) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ measures: [{ sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }] }] }],
    _x: { viritura: { videoSync: { version: 1, pictureOffsetSeconds: 0, hitPoints } } },
  };
}

describe("hit points", () => {
  it("round-trips a spotting session", () => {
    const hits = [
      { id: "h1", pictureSeconds: 16.25, label: "belly flop" },
      { id: "h2", pictureSeconds: 2, label: "title card" },
    ];
    const score = parseMnx(withHits(hits));
    expect(score.videoSync?.hitPoints).toHaveLength(2);

    // Serializing sorts by picture time, so a second parse is the stable form.
    const settled = parseMnx(serializeMnx(score));
    expect(settled.videoSync?.hitPoints).toEqual([
      { id: "h2", pictureSeconds: 2, label: "title card" },
      { id: "h1", pictureSeconds: 16.25, label: "belly flop" },
    ]);
    expect(parseMnx(serializeMnx(settled)).videoSync?.hitPoints).toEqual(settled.videoSync?.hitPoints);
  });

  it("writes them in picture order regardless of entry order", () => {
    const score = parseMnx(
      withHits([
        { id: "late", pictureSeconds: 90 },
        { id: "early", pictureSeconds: 5 },
      ]),
    );
    const out = serializeMnx(score) as unknown as {
      _x: { viritura: { videoSync: { hitPoints: { id: string }[] } } };
    };
    expect(out._x.viritura.videoSync.hitPoints.map((h) => h.id)).toEqual(["early", "late"]);
  });

  it("rejects a hit that would place the cue at the wrong frame", () => {
    // A hit with no time is worse than no hit: the solver would write the cue
    // against whatever it defaulted to. The schema refuses it outright.
    expect(() => parseMnx(withHits([{ id: "no-time" }]))).toThrow();
    expect(() => parseMnx(withHits([{ pictureSeconds: 20 }]))).toThrow();
    expect(() => parseMnx(withHits([{ id: "negative", pictureSeconds: -5 }]))).toThrow();
    expect(() => parseMnx(withHits([{ id: "text", pictureSeconds: "12" }]))).toThrow();
  });

  it("keeps an unlocked hit unlocked", () => {
    const score = parseMnx(withHits([{ id: "h", pictureSeconds: 3, locked: false }]));
    expect(score.videoSync?.hitPoints?.[0]?.locked).toBe(false);
    expect(parseMnx(serializeMnx(score)).videoSync?.hitPoints?.[0]?.locked).toBe(false);
  });

  it("treats a hit as locked by default", () => {
    const score = parseMnx(withHits([{ id: "h", pictureSeconds: 3 }]));
    expect(score.videoSync?.hitPoints?.[0]?.locked).toBeUndefined();
  });
});
