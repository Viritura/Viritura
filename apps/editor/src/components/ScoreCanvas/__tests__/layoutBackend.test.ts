import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayoutBackend } from "../layoutBackend";
import { EMPTY_LAYOUT_METRICS } from "@viritura/renderer";

const mocks = vi.hoisted(() => ({
  memory: vi.fn<() => Promise<number | null>>(),
  dispose: vi.fn(),
}));

vi.mock("@viritura/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@viritura/renderer")>();
  const displayList = { commands: [], width: 10, height: 20 };
  return {
    ...actual,
    createLayoutService: () => ({
      ready: Promise.resolve(true),
      isReady: () => true,
      getWasmMemoryBytes: mocks.memory,
      dispose: mocks.dispose,
      engine: {
        computeFullScoreLayout: async () => displayList,
        relayoutRetainedScore: async () => displayList,
        cacheStats: async () => [2, 1],
        layoutMetrics: async () => actual.EMPTY_LAYOUT_METRICS,
      },
    }),
  };
});

beforeEach(() => {
  vi.stubGlobal("Worker", class {});
});

afterEach(() => {
  Reflect.deleteProperty(window, "__VIRITURA_LAYOUT_MEMORY__");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("layout worker memory diagnostics", () => {
  it("publishes worker capacity after full and retained layouts and clears it on disposal", async () => {
    mocks.memory.mockResolvedValue(65536);
    const backend = await createLayoutBackend(false);
    await backend.computeFullScoreLayout("{}", 10);
    await vi.waitFor(() => {
      expect(Reflect.get(window, "__VIRITURA_LAYOUT_MEMORY__")).toEqual({
        bytes: 65536,
        sampledAt: expect.any(Number),
      });
    });
    expect(backend.layoutMetrics()).toEqual(EMPTY_LAYOUT_METRICS);
    mocks.memory.mockResolvedValue(131072);
    await backend.relayoutRetainedScore(10);
    await vi.waitFor(() => {
      expect(Reflect.get(window, "__VIRITURA_LAYOUT_MEMORY__")).toHaveProperty("bytes", 131072);
    });
    backend.dispose();
    expect(Reflect.get(window, "__VIRITURA_LAYOUT_MEMORY__")).toBeNull();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it("keeps layout and cache stats working when the memory probe throws", async () => {
    mocks.memory.mockImplementation(() => {
      throw new TypeError("getWasmMemoryBytes is not a function");
    });
    const backend = await createLayoutBackend(false);
    await expect(backend.computeFullScoreLayout("{}", 10)).resolves.toMatchObject({ width: 10 });
    await vi.waitFor(() => {
      expect(backend.cacheStats()).toEqual([2, 1]);
    });
    expect(Reflect.get(window, "__VIRITURA_LAYOUT_MEMORY__")).toEqual({
      bytes: null,
      sampledAt: expect.any(Number),
    });
    backend.dispose();
  });

  it("does not republish a late diagnostic response after disposal", async () => {
    let resolveMemory: (bytes: number) => void = () => {
      throw new Error("Missing memory request");
    };
    mocks.memory.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveMemory = resolve;
        }),
    );
    const backend = await createLayoutBackend(false);
    await backend.computeFullScoreLayout("{}", 10);
    backend.dispose();
    resolveMemory(65536);
    await Promise.resolve();
    await Promise.resolve();
    expect(Reflect.get(window, "__VIRITURA_LAYOUT_MEMORY__")).toBeNull();
  });
});
