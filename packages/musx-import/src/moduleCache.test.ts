import { describe, expect, it } from "vitest";
import { createModuleCache } from "./moduleCache";

interface FakeModule {
  id: number;
}

function countingLoader(): { load: () => Promise<FakeModule>; loads: () => number } {
  let loads = 0;
  return {
    load: async () => {
      loads += 1;
      return { id: loads };
    },
    loads: () => loads,
  };
}

describe("createModuleCache", () => {
  it("reuses one instance across conversions", async () => {
    const loader = countingLoader();
    const cache = createModuleCache(loader.load);

    const first = await cache.get();
    const second = await cache.get();

    expect(second).toBe(first);
    expect(loader.loads()).toBe(1);
  });

  it("loads a fresh instance after the current one is discarded", async () => {
    const loader = countingLoader();
    const cache = createModuleCache(loader.load);

    const failed = await cache.get();
    cache.discard();
    const next = await cache.get();

    expect(next).not.toBe(failed);
    expect(next.id).toBe(2);
  });

  it("shares one pending load between concurrent conversions", async () => {
    const loader = countingLoader();
    const cache = createModuleCache(loader.load);

    const [first, second] = await Promise.all([cache.get(), cache.get()]);

    expect(second).toBe(first);
    expect(loader.loads()).toBe(1);
  });

  it("retries a load that failed instead of caching the failure", async () => {
    let attempts = 0;
    const cache = createModuleCache(async (): Promise<FakeModule> => {
      attempts += 1;
      if (attempts === 1) throw new Error("load failed");
      return { id: attempts };
    });

    await expect(cache.get()).rejects.toThrow("load failed");
    await expect(cache.get()).resolves.toEqual({ id: 2 });
  });
});
