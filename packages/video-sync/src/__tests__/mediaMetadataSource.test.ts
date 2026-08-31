import { afterEach, describe, expect, it, vi } from "vitest";
import type { DetectedMediaMetadata, MediaMetadataWorkerResponse } from "../mediaMetadata";
import { analyzeMediaMetadata } from "../mediaMetadataSource";

const metadata: DetectedMediaMetadata = {
  container: "MPEG-4",
  codec: "AVC",
  codecProfile: null,
  width: 1920,
  height: 1080,
  frameRate: null,
  timecode: { firstFrame: null, dropFrame: null, source: null },
};

class FakeWorker {
  static latest: FakeWorker | null = null;

  onmessage: ((event: MessageEvent<MediaMetadataWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.latest = this;
  }

  respond(response: MediaMetadataWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<MediaMetadataWorkerResponse>);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.latest = null;
});

describe("analyzeMediaMetadata", () => {
  it("sends the Blob to a worker and returns its normalized result", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const blob = new Blob(["fixture"]);
    const pending = analyzeMediaMetadata(blob);

    expect(FakeWorker.latest?.postMessage).toHaveBeenCalledWith({ blob });
    FakeWorker.latest?.respond({ kind: "success", metadata });

    await expect(pending).resolves.toEqual(metadata);
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledOnce();
  });

  it("surfaces a worker parse failure", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const pending = analyzeMediaMetadata(new Blob(["bad"]));
    FakeWorker.latest?.respond({ kind: "error", message: "not a media file" });

    await expect(pending).rejects.toThrow("not a media file");
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledOnce();
  });

  it("terminates immediately when a relink aborts analysis", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const abort = new AbortController();
    const pending = analyzeMediaMetadata(new Blob(["old cut"]), abort.signal);

    abort.abort(new DOMException("Superseded", "AbortError"));

    await expect(pending).rejects.toThrow("Superseded");
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledOnce();
  });

  it("rejects before constructing a worker when already aborted", async () => {
    const Worker = vi.fn();
    vi.stubGlobal("Worker", Worker);
    const abort = new AbortController();
    abort.abort(new DOMException("Already stale", "AbortError"));

    await expect(analyzeMediaMetadata(new Blob(), abort.signal)).rejects.toThrow("Already stale");
    expect(Worker).not.toHaveBeenCalled();
  });
});
