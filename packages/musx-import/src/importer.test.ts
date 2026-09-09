import { describe, expect, it } from "vitest";
import { createMusxImporter } from "./importer";
import type { DenigmaWorkerRequest, DenigmaWorkerResponse } from "./types";

class FakeWorker {
  request?: DenigmaWorkerRequest;
  terminated = false;
  private messageListener?: (event: MessageEvent<DenigmaWorkerResponse>) => void;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent<DenigmaWorkerResponse>) => void;
    }
  }

  postMessage(message: DenigmaWorkerRequest): void {
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
});
