import { describe, expect, it } from "vitest";
import { MAX_MUSX_BYTES } from "./archiveLimits";
import { createMusxImporter } from "./importer";
import type { DenigmaWorkerRequest, DenigmaWorkerResponse } from "./types";

class FakeWorker {
  request?: DenigmaWorkerRequest;
  terminated = false;
  postError?: Error;
  private messageListener?: (event: MessageEvent<DenigmaWorkerResponse>) => void;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent<DenigmaWorkerResponse>) => void;
    }
  }

  postMessage(message: DenigmaWorkerRequest): void {
    if (this.postError) throw this.postError;
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: DenigmaWorkerResponse): void {
    this.messageListener?.({ data: response } as MessageEvent<DenigmaWorkerResponse>);
  }
}

describe("createMusxImporter", () => {
  it("sends a copied MUSX buffer to the worker and resolves its MNX result", async () => {
    const worker = new FakeWorker();
    const importer = createMusxImporter(() => worker as unknown as Worker);
    const source = new Uint8Array([1, 2, 3]);
    const conversion = importer.convert(source, "score.musx", { includeTempoTool: true });

    expect(worker.request).toMatchObject({
      type: "convert",
      sourceName: "score.musx",
      options: { includeTempoTool: true },
    });
    expect(Array.from(new Uint8Array(worker.request!.buffer))).toEqual([1, 2, 3]);
    expect(source.byteLength).toBe(3);

    worker.respond({
      type: "converted",
      requestId: worker.request!.requestId,
      result: {
        mnxJson: '{"global":{"measures":[]},"parts":[]}',
        diagnostics: [],
        denigmaVersion: "4.0.0",
        denigmaCommit: "abc123",
      },
    });

    await expect(conversion).resolves.toMatchObject({ denigmaVersion: "4.0.0" });
  });

  it("rejects conversion errors returned by the worker", async () => {
    const worker = new FakeWorker();
    const importer = createMusxImporter(() => worker as unknown as Worker);
    const conversion = importer.convert(new Uint8Array([1]), "broken.musx");

    worker.respond({
      type: "conversion-error",
      requestId: worker.request!.requestId,
      message: "Conversion failed",
      diagnostics: [{ severity: "error", message: "Invalid MUSX archive" }],
    });

    await expect(conversion).rejects.toThrow("Invalid MUSX archive");
  });

  it("rejects pending work when terminated", async () => {
    const worker = new FakeWorker();
    const importer = createMusxImporter(() => worker as unknown as Worker);
    const conversion = importer.convert(new Uint8Array([1]), "score.musx");

    importer.terminate();

    await expect(conversion).rejects.toThrow("terminated");
    expect(worker.terminated).toBe(true);
  });

  it("terminates a conversion that exceeds its time limit", async () => {
    const worker = new FakeWorker();
    const importer = createMusxImporter(() => worker as unknown as Worker);
    const conversion = importer.convert(new Uint8Array([1]), "score.musx", { timeoutMs: 1 });

    await expect(conversion).rejects.toThrow("safety limit");
    expect(worker.terminated).toBe(true);
  });

  it("rejects oversized input before creating a worker or copying bytes", async () => {
    let workerCreated = false;
    const importer = createMusxImporter(() => {
      workerCreated = true;
      return new FakeWorker() as unknown as Worker;
    });
    const oversized = { byteLength: MAX_MUSX_BYTES + 1 } as ArrayBuffer;

    await expect(importer.convert(oversized, "oversized.musx")).rejects.toThrow("64 MiB");
    expect(workerCreated).toBe(false);
  });

  it("discards a worker that fails to accept a request", async () => {
    const failedWorker = new FakeWorker();
    failedWorker.postError = new Error("post failed");
    const replacement = new FakeWorker();
    const workers = [failedWorker, replacement];
    const importer = createMusxImporter(() => workers.shift()! as unknown as Worker);

    await expect(importer.convert(new Uint8Array([1]), "broken.musx")).rejects.toThrow("post failed");
    expect(failedWorker.terminated).toBe(true);

    const conversion = importer.convert(new Uint8Array([2]), "score.musx");
    replacement.respond({
      type: "converted",
      requestId: replacement.request!.requestId,
      result: {
        mnxJson: '{"global":{"measures":[]},"parts":[]}',
        diagnostics: [],
        denigmaVersion: "4.0.0",
        denigmaCommit: "abc123",
      },
    });
    await expect(conversion).resolves.toMatchObject({ denigmaCommit: "abc123" });
  });

  it("fails every request on a timed-out worker without affecting its replacement", async () => {
    const workers: FakeWorker[] = [];
    const importer = createMusxImporter(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const first = importer.convert(new Uint8Array([1]), "first.musx", { timeoutMs: 1 });
    const second = importer.convert(new Uint8Array([2]), "second.musx", { timeoutMs: 100 });

    const failed = await Promise.allSettled([first, second]);
    expect(failed.every((result) => result.status === "rejected")).toBe(true);
    expect(workers[0]!.terminated).toBe(true);

    const third = importer.convert(new Uint8Array([3]), "third.musx");
    const replacement = workers[1]!;
    replacement.respond({
      type: "converted",
      requestId: replacement.request!.requestId,
      result: {
        mnxJson: '{"global":{"measures":[]},"parts":[]}',
        diagnostics: [],
        denigmaVersion: "4.0.0",
        denigmaCommit: "abc123",
      },
    });
    await expect(third).resolves.toMatchObject({ denigmaCommit: "abc123" });
  });
});
