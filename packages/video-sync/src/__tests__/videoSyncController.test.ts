/**
 * Controller tests.
 *
 * These cover the seam between what the user does and what the *score* ends up
 * holding — the place where a bug is invisible until someone reopens the file
 * and finds their offset gone (or finds a `videoSync` block in a score that
 * never used video).
 *
 * The media element is stubbed rather than provided by jsdom: the controller
 * only touches a handful of members, and stubbing them keeps the suite in the
 * fast Node environment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoSyncSettings } from "@viritura/core";
import { CAMINANDES_LLAMIGOS } from "../demoSources";
import type { DetectedMediaMetadata } from "../mediaMetadata";
import type { TransportBridge } from "../types";
import { VideoSyncController } from "../videoSyncController";
import { resetVideoSyncState, getVideoSyncState } from "../videoSyncStore";
import { FakeTransport, FakeVideoElement } from "./fakeMedia";

/** A `File`-shaped stub good enough for hashing and attachment. */
function fakeFile(name: string, bytes: number[]): File {
  const data = new Uint8Array(bytes);
  return {
    name,
    size: data.byteLength,
    slice: () => ({ arrayBuffer: async () => data.buffer }),
  } as unknown as File;
}

/** Object URL the stubbed `URL.createObjectURL` hands back for a fetched clip. */
const BLOB_URL = "blob:fake";

/** A `fetch` that resolves to a tiny video blob, standing in for the demo host. */
function stubFetchOk() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "video/webm" }),
    body: null,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("VideoSyncController", () => {
  let transport: TransportBridge;
  let saved: (VideoSyncSettings | undefined)[];
  let controller: VideoSyncController;
  let video: FakeVideoElement;

  beforeEach(() => {
    vi.stubGlobal("URL", { createObjectURL: () => BLOB_URL, revokeObjectURL: () => {} });
    stubFetchOk();
    transport = new FakeTransport();
    saved = [];
    controller = new VideoSyncController({
      transport,
      onSettingsChange: (settings) => saved.push(settings),
    });
    video = new FakeVideoElement();
    controller.setElement(video as unknown as HTMLVideoElement);
  });

  function useDetectedMetadata(metadata: DetectedMediaMetadata): void {
    controller.dispose();
    saved = [];
    controller = new VideoSyncController({
      transport,
      onSettingsChange: (settings) => saved.push(settings),
      analyzeMetadata: async () => metadata,
    });
    controller.setElement(video as unknown as HTMLVideoElement);
  }

  afterEach(() => {
    controller.dispose();
    resetVideoSyncState();
    vi.unstubAllGlobals();
  });

  it("persists an offset change", () => {
    controller.actions().setPictureOffset(120);
    expect(saved.at(-1)?.pictureOffsetSeconds).toBe(120);
  });

  it("ignores a non-finite offset rather than corrupting every sync point", () => {
    controller.actions().setPictureOffset(Number.NaN);
    expect(saved).toHaveLength(0);
  });

  it("does not write an inert videoSync block into scores that never used video", () => {
    // Toggling a setting back to its default must leave the document clean, so
    // MNX diffs stay empty for everyone who never touched the feature.
    controller.actions().setPictureAudioEnabled(true);
    controller.actions().setPictureAudioEnabled(false);
    expect(saved.at(-1)).toBeUndefined();
  });

  it("records media identity when a file is attached", async () => {
    await controller.actions().attachFile(fakeFile("reel-2.mp4", [1, 2, 3, 4]));
    const media = saved.at(-1)?.media;
    expect(media?.displayName).toBe("reel-2.mp4");
    expect(media?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("does not let an older, slower file attachment replace the newest one", async () => {
    let oldReadStarted = false;
    let finishOldRead!: (buffer: ArrayBuffer) => void;
    const oldFile = {
      name: "cut-a.mp4",
      size: 4,
      slice: () => ({
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            oldReadStarted = true;
            finishOldRead = resolve;
          }),
      }),
    } as unknown as File;

    const attachingOld = controller.actions().attachFile(oldFile);
    const attachingNew = controller.actions().attachFile(fakeFile("cut-b.mp4", [5, 6, 7, 8]));
    await attachingNew;
    expect(getVideoSyncState().mediaName).toBe("cut-b.mp4");

    if (!oldReadStarted) throw new Error("The old file never began hashing.");
    finishOldRead(new Uint8Array([1, 2, 3, 4]).buffer);
    await attachingOld;

    expect(getVideoSyncState().mediaName).toBe("cut-b.mp4");
    expect(saved.at(-1)?.media?.displayName).toBe("cut-b.mp4");
  });

  it("invalidates a pending file attachment when the open document changes", async () => {
    let finishRead!: (buffer: ArrayBuffer) => void;
    const oldFile = {
      name: "old-document.mp4",
      size: 4,
      slice: () => ({
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            finishRead = resolve;
          }),
      }),
    } as unknown as File;

    const attaching = controller.actions().attachFile(oldFile);
    controller.setDocumentToken("new-document");
    finishRead(new Uint8Array([1, 2, 3, 4]).buffer);
    await attaching;

    expect(getVideoSyncState().mediaName).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it("releases an attached picture when the open document changes", async () => {
    await controller.actions().attachFile(fakeFile("old-document.mp4", [1, 2, 3, 4]));
    expect(getVideoSyncState().mediaName).toBe("old-document.mp4");

    controller.setDocumentToken("new-document");

    expect(getVideoSyncState()).toMatchObject({
      attachment: "empty",
      mediaName: null,
      mediaObjectUrl: null,
      mediaMetadataStatus: "idle",
      waveformStatus: "idle",
    });
    expect(video.src).toBe("");
  });

  it("uses the new document's defaults after invalidation", () => {
    controller.applySettings({
      version: 1,
      pictureOffsetSeconds: 90,
      pictureAudioEnabled: false,
      frameRate: "25",
      hitPoints: [{ id: "old-hit", pictureSeconds: 12 }],
    });

    controller.setDocumentToken("new-document");
    controller.applySettings(undefined);
    controller.actions().setPictureAudioEnabled(true);

    expect(saved.at(-1)).toMatchObject({
      pictureOffsetSeconds: 0,
      pictureAudioEnabled: true,
    });
    expect(saved.at(-1)?.frameRate).toBeUndefined();
    expect(saved.at(-1)?.hitPoints).toBeUndefined();
  });

  it("adopts an exact detected rate when the score has none", async () => {
    useDetectedMetadata({
      container: "MPEG-4",
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 24000,
        denominator: 1001,
        fps: 24000 / 1001,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: "23.976",
      },
      timecode: { firstFrame: "01:00:00:00", dropFrame: false, source: "QuickTime TC" },
    });

    await controller.actions().attachFile(fakeFile("picture.mp4", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(getVideoSyncState().frameRateId).toBe("23.976");
    expect(getVideoSyncState().frameRateSource).toBe("detected");
    expect(getVideoSyncState().timecodeOriginSource).toBe("detected");
    expect(saved.at(-1)?.frameRate).toBe("23.976");
    // 01:00:00:00 at a 24-counting NTSC rate is 86,400 frames, or 3603.6 s.
    expect(saved.at(-1)?.startTimecodeSeconds).toBeCloseTo(3603.6, 6);

    controller.actions().setFrameRate("25");
    expect(getVideoSyncState().timecodeOriginSource).toBe("saved");
  });

  it("does not override a rate the score already declares", async () => {
    useDetectedMetadata({
      container: "MPEG-4",
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 24,
        denominator: 1,
        fps: 24,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: "24",
      },
      timecode: { firstFrame: null, dropFrame: null, source: null },
    });
    controller.applySettings({
      version: 1,
      pictureOffsetSeconds: 0,
      pictureAudioEnabled: false,
      frameRate: "25",
    });

    await controller.actions().attachFile(fakeFile("picture.mp4", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(getVideoSyncState().frameRateId).toBe("25");
    expect(saved.at(-1)?.frameRate).toBe("25");
  });

  it("marks explicit timebase and origin changes as manual", () => {
    controller.actions().setFrameRate("30");
    controller.actions().setStartTimecode(3600);

    expect(getVideoSyncState()).toMatchObject({
      frameRateId: "30",
      frameRateSource: "manual",
      startTimecodeSeconds: 3600,
      timecodeOriginSource: "manual",
    });
  });

  it("adopts a matching start timecode without overriding the declared rate", async () => {
    useDetectedMetadata({
      container: "QuickTime",
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 25,
        denominator: 1,
        fps: 25,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: "25",
      },
      timecode: { firstFrame: "10:00:00:00", dropFrame: false, source: "QuickTime TC" },
    });
    controller.applySettings({
      version: 1,
      pictureOffsetSeconds: 0,
      pictureAudioEnabled: false,
      frameRate: "25",
    });

    await controller.actions().attachFile(fakeFile("picture.mov", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(saved.at(-1)?.frameRate).toBe("25");
    expect(saved.at(-1)?.startTimecodeSeconds).toBe(36_000);
  });

  it("does not adopt an NTSC start timecode whose DF/NDF convention is unknown", async () => {
    useDetectedMetadata({
      container: "MPEG-4",
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 30000,
        denominator: 1001,
        fps: 30000 / 1001,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: null,
      },
      // Even a plausible-looking value is ambiguous without the numbering
      // convention: 01:00:00:00 is 3603.6 s NDF but 3600 s DF.
      timecode: { firstFrame: "01:00:00:00", dropFrame: null, source: null },
    });
    controller.applySettings({
      version: 1,
      pictureOffsetSeconds: 0,
      pictureAudioEnabled: false,
      frameRate: "29.97",
    });

    await controller.actions().attachFile(fakeFile("picture.mp4", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(saved.at(-1)?.frameRate).toBe("29.97");
    expect(saved.at(-1)?.startTimecodeSeconds).toBeUndefined();
  });

  it("does not guess DF/NDF when NTSC metadata omits it", async () => {
    useDetectedMetadata({
      container: "MPEG-4",
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 30000,
        denominator: 1001,
        fps: 30000 / 1001,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: null,
      },
      timecode: { firstFrame: null, dropFrame: null, source: null },
    });

    await controller.actions().attachFile(fakeFile("picture.mp4", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(saved.at(-1)?.frameRate).toBeUndefined();
    expect(getVideoSyncState().mediaMetadata?.frameRate?.numerator).toBe(30000);
  });

  it("does not adopt an approximate or unconfirmed standard rate", async () => {
    useDetectedMetadata({
      container: "MPEG-4",
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 23999,
        denominator: 1000,
        fps: 23.999,
        mode: "constant",
        source: "container-rational",
        confidence: "medium",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: "24",
      },
      timecode: { firstFrame: null, dropFrame: null, source: null },
    });

    await controller.actions().attachFile(fakeFile("approximate.mp4", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(saved.at(-1)?.frameRate).toBeUndefined();
    expect(getVideoSyncState().mediaMetadata?.frameRate?.confidence).toBe("medium");
  });

  it("surfaces VFR without adopting its average", async () => {
    useDetectedMetadata({
      container: "WebM",
      codec: "VP9",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 1492,
        denominator: 50,
        fps: 29.84,
        mode: "variable",
        source: "container-average",
        confidence: "vfr",
        minimumFps: 12.5,
        maximumFps: 60,
        suggestedFrameRateId: null,
      },
      timecode: { firstFrame: null, dropFrame: null, source: null },
    });

    await controller.actions().attachFile(fakeFile("screen.webm", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadataStatus).toBe("ready"));

    expect(saved.at(-1)?.frameRate).toBeUndefined();
    expect(getVideoSyncState().mediaMetadata?.frameRate?.mode).toBe("variable");
  });

  it("prevents the previous file's metadata from winning while a replacement hashes", async () => {
    interface PendingAnalysis {
      readonly signal: AbortSignal | undefined;
      resolve(metadata: DetectedMediaMetadata): void;
    }
    const pending: PendingAnalysis[] = [];
    controller.dispose();
    saved = [];
    controller = new VideoSyncController({
      transport,
      onSettingsChange: (settings) => saved.push(settings),
      analyzeMetadata: (_blob, signal) =>
        new Promise((resolve) => {
          pending.push({ signal, resolve });
        }),
    });
    controller.setElement(video as unknown as HTMLVideoElement);

    await controller.actions().attachFile(fakeFile("cut-a.mp4", [1, 2, 3, 4]));
    expect(pending).toHaveLength(1);

    const attachingB = controller.actions().attachFile(fakeFile("cut-b.mp4", [5, 6, 7, 8]));
    // `attachFile` invalidates A before its first await (the content hash).
    expect(pending[0]?.signal?.aborted).toBe(true);
    await attachingB;
    expect(pending).toHaveLength(2);

    const exact = (container: string, numerator: number, id: string): DetectedMediaMetadata => ({
      container,
      codec: "AVC",
      codecProfile: null,
      width: 1920,
      height: 1080,
      frameRate: {
        numerator,
        denominator: 1,
        fps: numerator,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        minimumFps: null,
        maximumFps: null,
        suggestedFrameRateId: id,
      },
      timecode: { firstFrame: null, dropFrame: null, source: null },
    });

    // A resolves late, after B has become the current binding.
    pending[0]!.resolve(exact("Old cut", 24, "24"));
    pending[1]!.resolve(exact("New cut", 25, "25"));
    await vi.waitFor(() => expect(getVideoSyncState().mediaMetadata?.container).toBe("New cut"));

    expect(getVideoSyncState().frameRateId).toBe("25");
    expect(saved.at(-1)?.frameRate).toBe("25");
  });

  it("degrades to no waveform rather than failing when audio cannot be decoded", async () => {
    // Node has no Web Audio. A composer handed a silent reference cut, or
    // running somewhere without a decoder, should lose the waveform and nothing
    // else — attaching the picture must still succeed.
    await controller.actions().attachFile(fakeFile("reel-2.mp4", [1, 2, 3, 4]));
    await vi.waitFor(() => expect(getVideoSyncState().waveformStatus).toBe("unavailable"));
    expect(getVideoSyncState().attachment).not.toBe("error");
    expect(getVideoSyncState().waveform).toBeNull();
  });

  it("rejects a file that is not a video", async () => {
    await controller.actions().attachFile(fakeFile("score.pdf", [1]));
    expect(saved).toHaveLength(0);
  });

  it("records a demo clip by catalog id so it can restream on reopen", async () => {
    await controller.actions().attachDemo(CAMINANDES_LLAMIGOS);
    expect(saved.at(-1)?.media).toEqual({
      displayName: CAMINANDES_LLAMIGOS.title,
      demoSourceId: CAMINANDES_LLAMIGOS.id,
      durationSeconds: CAMINANDES_LLAMIGOS.durationSeconds,
    });
  });

  it("keeps the offset when the picture is removed", async () => {
    controller.actions().setPictureOffset(90);
    await controller.actions().attachDemo(CAMINANDES_LLAMIGOS);
    controller.actions().removeMedia();

    const last = saved.at(-1);
    // The offset describes how this cue works, not which file it used, so
    // re-entering it after a relink would be exactly the busywork video sync
    // exists to remove.
    expect(last?.pictureOffsetSeconds).toBe(90);
    expect(last?.media).toBeUndefined();
  });

  it("derives the offset that lands the current frame on the playhead", async () => {
    await controller.actions().attachDemo(CAMINANDES_LLAMIGOS);
    (transport as FakeTransport).scoreTime = 12;
    video.currentTime = 74;

    controller.actions().alignToPlayhead();

    expect(saved.at(-1)?.pictureOffsetSeconds).toBe(62);
  });

  it("mutes the element unless picture audio is explicitly enabled", () => {
    expect(video.muted).toBe(true);
    controller.actions().setPictureAudioEnabled(true);
    expect(video.muted).toBe(false);
  });

  it("restores a demo clip from settings without a relink", async () => {
    controller.applySettings({
      version: 1,
      pictureOffsetSeconds: 5,
      pictureAudioEnabled: false,
      media: { displayName: CAMINANDES_LLAMIGOS.title, demoSourceId: CAMINANDES_LLAMIGOS.id },
    });
    await vi.waitFor(() => expect(video.src).toBe(BLOB_URL));
  });

  it("downloads a demo clip in CORS mode", async () => {
    // The editor is cross-origin isolated for SharedArrayBuffer, and under
    // COEP `require-corp` a no-cors cross-origin request is refused outright.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await controller.actions().attachDemo(CAMINANDES_LLAMIGOS);
    expect(fetchMock).toHaveBeenCalledWith(
      CAMINANDES_LLAMIGOS.url,
      expect.objectContaining({ mode: "cors", credentials: "omit" }),
    );
  });

  it("surfaces a failed demo download instead of leaving a blank picture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, headers: new Headers(), body: null })),
    );
    await controller.actions().attachDemo(CAMINANDES_LLAMIGOS);

    expect(getVideoSyncState().attachment).toBe("error");
    expect(getVideoSyncState().errorMessage).toContain("503");
  });

  it("does not restart the download when settings are re-applied mid-fetch", async () => {
    // The document store hands out a new score object on every edit, so
    // `applySettings` runs constantly. Restarting a 16 MB fetch each time would
    // mean the picture never finishes loading while the user is typing.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const settings: VideoSyncSettings = {
      version: 1,
      pictureOffsetSeconds: 0,
      pictureAudioEnabled: false,
      media: { displayName: CAMINANDES_LLAMIGOS.title, demoSourceId: CAMINANDES_LLAMIGOS.id },
    };
    controller.applySettings(settings);
    controller.applySettings({ ...settings });
    controller.applySettings({ ...settings });

    await vi.waitFor(() => expect(video.src).toBe(BLOB_URL));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a remembered local file as offline until the user relinks it", () => {
    controller.applySettings({
      version: 1,
      pictureOffsetSeconds: 5,
      pictureAudioEnabled: false,
      media: { displayName: "picture-lock.mp4", contentHash: `sha256:${"0".repeat(64)}` },
    });
    // The browser cannot reopen a file picked in a previous session, so the
    // score lands in `offline` with a relink affordance rather than an error.
    expect(getVideoSyncState().attachment).toBe("offline");
    expect(getVideoSyncState().mediaName).toBe("picture-lock.mp4");
    expect(getVideoSyncState().pictureOffsetSeconds).toBe(5);
  });

  it("points a late-bound element at media that was attached before it existed", async () => {
    // A demo restored from settings can land before the provider has committed
    // its <video>; the element must still receive the source when it arrives.
    const detached = new VideoSyncController({ transport, onSettingsChange: () => {} });
    await detached.actions().attachDemo(CAMINANDES_LLAMIGOS);
    const late = new FakeVideoElement();
    detached.setElement(late as unknown as HTMLVideoElement);

    expect(late.src).toBe(BLOB_URL);
    detached.dispose();
  });

  it("does not write settings back when a restored demo re-derives the same value", async () => {
    // Opening a score that references a demo clip must not mark it dirty.
    const settings: VideoSyncSettings = {
      version: 1,
      pictureOffsetSeconds: 5,
      pictureAudioEnabled: false,
      media: {
        displayName: CAMINANDES_LLAMIGOS.title,
        demoSourceId: CAMINANDES_LLAMIGOS.id,
        durationSeconds: CAMINANDES_LLAMIGOS.durationSeconds,
      },
    };
    controller.applySettings(settings);
    await vi.waitFor(() => expect(video.src).toBe(BLOB_URL));

    expect(saved).toHaveLength(0);
  });

  it("reports no attachment for a score that never used video", () => {
    controller.applySettings(undefined);
    expect(getVideoSyncState().attachment).toBe("empty");
  });
});
