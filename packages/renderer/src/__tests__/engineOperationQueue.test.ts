import { describe, expect, it } from "vitest";
import { EngineOperationQueue } from "../worker/engineOperationQueue";

describe("EngineOperationQueue", () => {
  it("runs overlapping requests strictly in FIFO order", async () => {
    const queue = new EngineOperationQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.run(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
      return 1;
    });
    const second = queue.run(() => {
      events.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after a failed operation", async () => {
    const queue = new EngineOperationQueue();
    const failed = queue.run(() => {
      throw new Error("layout failed");
    });
    const recovered = queue.run(() => "recovered");

    await expect(failed).rejects.toThrow("layout failed");
    await expect(recovered).resolves.toBe("recovered");
  });
});
