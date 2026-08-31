import { beforeEach, describe, expect, it } from "vitest";
import { VideoSynchronizer } from "../videoSynchronizer";
import type { PictureMapping } from "../scorePictureMap";
import type { VideoSyncHealth } from "../types";
import { FakeTransport, FakeVideoElement, ManualScheduler } from "./fakeMedia";

describe("VideoSynchronizer", () => {
  let video: FakeVideoElement;
  let transport: FakeTransport;
  let scheduler: ManualScheduler;
  let mapping: PictureMapping;
  let health: VideoSyncHealth[];
  let sync: VideoSynchronizer;

  beforeEach(() => {
    video = new FakeVideoElement();
    transport = new FakeTransport();
    scheduler = new ManualScheduler();
    mapping = { pictureOffsetSeconds: 100, mediaDurationSeconds: 600 };
    health = [];
    sync = new VideoSynchronizer({
      transport,
      getMapping: () => mapping,
      onHealthChange: (next) => health.push(next),
      scheduler,
    });
    sync.attach(video);
  });

  it("anchors the picture to the playhead on attach", () => {
    expect(video.currentTime).toBe(100);
    expect(scheduler.running).toBe(true);
  });

  // ── Transport drives picture ────────────────────────────────────────────

  it("starts the picture when the transport starts", () => {
    transport.status = "playing";
    transport.scoreTime = 10;
    scheduler.advance();

    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(110);
  });

  it("pauses the picture when the transport pauses", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.status = "paused";
    scheduler.advance();

    expect(video.paused).toBe(true);
  });

  it("parks the picture at the start position when the transport stops", () => {
    transport.status = "playing";
    transport.scoreTime = 40;
    scheduler.advance();

    transport.status = "stopped";
    transport.scoreTime = 0;
    scheduler.advance();

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(100);
  });

  it("scrubs the picture while the transport is parked", () => {
    transport.scoreTime = 25;
    scheduler.advance();
    expect(video.currentTime).toBe(125);
  });

  it("follows every frame-sized transport step while parked", () => {
    for (let frame = 1; frame <= 6; frame++) {
      transport.scoreTime = frame / 24;
      scheduler.advance();
      expect(video.currentTime).toBeCloseTo(100 + frame / 24, 9);
    }
  });

  // ── Feedback-loop guards ────────────────────────────────────────────────

  it("does not echo its own play back into the transport", () => {
    transport.status = "playing";
    scheduler.advance();

    expect(transport.calls.filter((call) => call.type === "play")).toHaveLength(0);
  });

  it("does not echo its own pause back into the transport", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.status = "paused";
    scheduler.advance();

    expect(transport.calls.filter((call) => call.type === "pause")).toHaveLength(0);
  });

  it("does not echo its own seek back into the transport", () => {
    transport.scoreTime = 30;
    scheduler.advance();
    video.completeSeek();

    expect(transport.calls.filter((call) => call.type === "seek")).toHaveLength(0);
  });

  // ── Native PiP controls drive the transport ─────────────────────────────

  it("starts music when the user presses play in the PiP window", () => {
    video.currentTime = 160;
    video.userPressPlay();

    expect(transport.calls).toContainEqual({ type: "play", value: 60 });
    expect(transport.getStatus()).toBe("playing");
  });

  it("pauses music when the user presses pause in the PiP window", () => {
    transport.status = "playing";
    scheduler.advance();

    video.userPressPause();

    expect(transport.calls).toContainEqual({ type: "pause" });
    expect(transport.getStatus()).toBe("paused");
  });

  it("moves the score when the user scrubs the picture", () => {
    video.userScrubTo(250);
    expect(transport.calls).toContainEqual({ type: "seek", value: 150 });
  });

  it("reports user intent so the UI can reflect PiP-driven transport changes", () => {
    const intents: string[] = [];
    const observed = new VideoSynchronizer({
      transport,
      getMapping: () => mapping,
      onUserTransportIntent: (intent) => intents.push(intent),
      scheduler: new ManualScheduler(),
    });
    observed.attach(video);

    video.userPressPlay();
    video.userPressPause();

    expect(intents).toEqual(["play", "pause"]);
    observed.dispose();
  });

  // ── Drift correction ────────────────────────────────────────────────────

  it("holds the rate while the picture tracks within tolerance", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = 10;
    video.currentTime = 110.01;
    scheduler.advance();

    expect(video.playbackRate).toBe(1);
    expect(sync.getHealth()).toBe("locked");
  });

  it("nudges the rate for a sustained moderate drift", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = 10;
    video.currentTime = 109.8; // picture is 0.2s behind

    scheduler.advance(4);

    expect(video.playbackRate).toBeGreaterThan(1);
    expect(sync.getHealth()).toBe("correcting");
  });

  it("hard-seeks when the drift is too large to absorb", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = 10;
    video.currentTime = 60; // 50s adrift, e.g. after a tab suspension

    scheduler.advance();

    expect(video.currentTime).toBe(110);
    expect(video.playbackRate).toBe(1);
  });

  it("does not treat a correction seek as a user scrub", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = 10;
    video.currentTime = 60;
    scheduler.advance();
    video.completeSeek();

    expect(transport.calls.filter((call) => call.type === "seek")).toHaveLength(0);
  });

  it("reports buffering and re-anchors once data recovers", () => {
    transport.status = "playing";
    scheduler.advance();

    video.readyState = 1;
    scheduler.advance();
    expect(sync.getHealth()).toBe("buffering");

    transport.scoreTime = 30;
    video.readyState = 4;
    video.emit("playing");

    expect(video.currentTime).toBe(130);
  });

  // ── Picture boundaries ──────────────────────────────────────────────────

  it("keeps the music playing when the picture runs out before the cue does", () => {
    // A picture shorter than the cue must not stop the score. The element
    // pauses itself at end of media and fires `pause`; reading that as user
    // intent would silently halt playback.
    transport.status = "playing";
    scheduler.advance();

    video.reachEnd();

    expect(transport.calls.filter((call) => call.type === "pause")).toHaveLength(0);
    expect(transport.getStatus()).toBe("playing");
  });

  it("parks the picture rather than letting it roll past the last frame", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = 10_000;
    scheduler.advance();

    expect(video.currentTime).toBe(600);
    expect(video.paused).toBe(true);
    expect(video.playbackRate).toBe(1);
  });

  it("holds the first frame through a count-in that starts before the picture", () => {
    mapping = { pictureOffsetSeconds: 0, mediaDurationSeconds: 600 };
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = -2;
    scheduler.advance();

    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(true);
  });

  it("resumes the picture when the score re-enters it after a count-in", () => {
    mapping = { pictureOffsetSeconds: 0, mediaDurationSeconds: 600 };
    transport.status = "playing";
    transport.scoreTime = -2;
    scheduler.advance(2);
    expect(video.paused).toBe(true);

    transport.scoreTime = 3;
    scheduler.advance();

    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(3);
    // Resuming is the app's own doing and must not echo back as user intent.
    expect(transport.calls.filter((call) => call.type === "play")).toHaveLength(0);
  });

  it("parks again at the same boundary after re-entering the picture", () => {
    transport.status = "playing";
    scheduler.advance();
    transport.scoreTime = 10_000;
    scheduler.advance();
    expect(video.currentTime).toBe(600);

    transport.scoreTime = 3;
    scheduler.advance();
    expect(video.currentTime).toBe(103);

    transport.scoreTime = 10_000;
    scheduler.advance();
    expect(video.currentTime).toBe(600);
  });

  it("keeps a count-in inside the picture when the offset covers it", () => {
    transport.status = "playing";
    transport.scoreTime = -2;
    scheduler.advance();

    expect(video.currentTime).toBe(98);
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────

  it("re-anchors on demand after the score timeline changes", () => {
    transport.scoreTime = 55;
    sync.resync();
    expect(video.currentTime).toBe(155);
  });

  it("picks up a live offset change without reattaching", () => {
    mapping = { pictureOffsetSeconds: 200, mediaDurationSeconds: 600 };
    transport.scoreTime = 10;
    scheduler.advance();
    expect(video.currentTime).toBe(210);
  });

  it("stops following and detaches its listeners on dispose", () => {
    sync.dispose();
    expect(scheduler.running).toBe(false);

    video.userPressPlay();
    expect(transport.calls.filter((call) => call.type === "play")).toHaveLength(0);
  });
});
