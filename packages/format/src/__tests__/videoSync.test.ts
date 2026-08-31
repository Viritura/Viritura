/**
 * Persistence tests for `_x.viritura.videoSync`.
 *
 * The contract these lock down is portability: a score records *which* picture
 * it expects and where the picture sits relative to score time, and nothing
 * device-specific. If a local path or blob ever leaked into the serializer,
 * scores would stop being shareable and would leak the author's filesystem
 * layout into a file meant to be committed.
 */

import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx, parseMnxWithDiagnostics } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

const HASH = `sha256:${"a1b2c3d4".repeat(8)}`;

function baseScore(): Record<string, unknown> {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
  };
}

function withVideoSync(videoSync: unknown): Record<string, unknown> {
  return { ...baseScore(), _x: { viritura: { videoSync } } };
}

describe("videoSync vendor extension", () => {
  it("parses a full settings payload", () => {
    const score = parseMnx(
      withVideoSync({
        version: 1,
        media: { displayName: "picture-lock-v12.mp4", contentHash: HASH, durationSeconds: 150.5 },
        pictureOffsetSeconds: 120,
        pictureAudioEnabled: true,
      }),
    );

    expect(score.videoSync).toEqual({
      version: 1,
      media: { displayName: "picture-lock-v12.mp4", contentHash: HASH, durationSeconds: 150.5 },
      pictureOffsetSeconds: 120,
      pictureAudioEnabled: true,
    });
  });

  it("round-trips through serialize → parse", () => {
    const source = withVideoSync({
      version: 1,
      media: { displayName: "reel-2.mov", contentHash: HASH, durationSeconds: 84 },
      pictureOffsetSeconds: -3.5,
      pictureAudioEnabled: false,
    });
    const once = parseMnx(source);
    const twice = parseMnx(serializeMnx(once));
    expect(twice.videoSync).toEqual(once.videoSync);
  });

  it("keeps an offset for a picture that has not been relinked yet", () => {
    const score = parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: 60 }));
    expect(score.videoSync).toEqual({ version: 1, pictureOffsetSeconds: 60, pictureAudioEnabled: false });
    expect(score.videoSync?.media).toBeUndefined();
  });

  it("defaults picture audio to off so attaching never doubles up on score playback", () => {
    const score = parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: 0 }));
    expect(score.videoSync?.pictureAudioEnabled).toBe(false);
  });

  it("rejects a payload whose offset is not a finite number", () => {
    // Defaulting a bad offset to zero would place every cue at the wrong frame
    // while appearing to work. The schema rejects it up front, and the parser's
    // own guard drops it in lenient mode rather than inventing a value.
    expect(() => parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: "later" }))).toThrow(
      /pictureOffsetSeconds/,
    );
    expect(() => parseMnx(withVideoSync({ version: 1 }))).toThrow(/pictureOffsetSeconds/);

    const lenient = parseMnxWithDiagnostics(withVideoSync({ version: 1, pictureOffsetSeconds: "later" }));
    expect(lenient.score.videoSync).toBeUndefined();
  });

  it("drops incomplete media identity but keeps the offset", () => {
    // A demo clip has no hash and a local file has no demo id, so the only
    // universally required field is the display name.
    expect(() => parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: 12, media: {} }))).toThrow(/displayName/);

    const lenient = parseMnxWithDiagnostics(withVideoSync({ version: 1, pictureOffsetSeconds: 12, media: {} }));
    expect(lenient.score.videoSync?.pictureOffsetSeconds).toBe(12);
    expect(lenient.score.videoSync?.media).toBeUndefined();
  });

  it("remembers a demo clip by catalog id so it can restream without a relink", () => {
    const score = parseMnx(
      withVideoSync({
        version: 1,
        pictureOffsetSeconds: 0,
        media: { displayName: "Caminandes 3: Llamigos", demoSourceId: "caminandes-llamigos", durationSeconds: 150 },
      }),
    );
    expect(score.videoSync?.media).toEqual({
      displayName: "Caminandes 3: Llamigos",
      demoSourceId: "caminandes-llamigos",
      durationSeconds: 150,
    });
    expect(parseMnx(serializeMnx(score)).videoSync).toEqual(score.videoSync);
  });

  it("round-trips a display-only start timecode", () => {
    const score = parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: 0, startTimecodeSeconds: 3600 }));
    expect(score.videoSync?.startTimecodeSeconds).toBe(3600);
    expect(parseMnx(serializeMnx(score)).videoSync?.startTimecodeSeconds).toBe(3600);
  });

  it("round-trips a declared frame rate", () => {
    const score = parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: 0, frameRate: "29.97df" }));
    expect(score.videoSync?.frameRate).toBe("29.97df");
    expect(parseMnx(serializeMnx(score)).videoSync?.frameRate).toBe("29.97df");
  });

  it("leaves the frame rate undeclared rather than guessing one", () => {
    // Defaulting on parse would make an assumed 24 fps indistinguishable from a
    // rate the composer actually confirmed.
    const score = parseMnx(withVideoSync({ version: 1, pictureOffsetSeconds: 0 }));
    expect(score.videoSync?.frameRate).toBeUndefined();
  });

  it("omits the extension entirely for scores with no video", () => {
    const serialized = serializeMnx(parseMnx(baseScore())) as Record<string, unknown>;
    const viritura = (serialized["_x"] as Record<string, unknown> | undefined)?.["viritura"] as
      | Record<string, unknown>
      | undefined;
    expect(viritura?.["videoSync"]).toBeUndefined();
  });

  it("never serializes a local path or media bytes", () => {
    const score: Score = {
      ...parseMnx(baseScore()),
      videoSync: {
        version: 1,
        media: { displayName: "cut.mp4", contentHash: HASH, durationSeconds: 10 },
        pictureOffsetSeconds: 0,
        pictureAudioEnabled: false,
      },
    };
    const json = JSON.stringify(serializeMnx(score));
    expect(json).not.toMatch(/blob:/);
    expect(json).not.toMatch(/[A-Za-z]:\\\\/);
    expect(json).not.toMatch(/"(path|filePath|objectUrl|url)"/);
  });
});
