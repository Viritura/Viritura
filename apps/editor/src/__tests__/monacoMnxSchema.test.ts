import { beforeEach, describe, expect, it, vi } from "vitest";

describe("configureMnxJsonDiagnostics", () => {
  it("configures Monaco diagnostics with inline schema when provided", async () => {
    const { configureMnxJsonDiagnostics } = await import("../lib/monacoMnxSchema");
    const setDiagnosticsOptions = vi.fn();
    const monaco = {
      json: {
        jsonDefaults: { setDiagnosticsOptions },
      },
    };

    configureMnxJsonDiagnostics(monaco as never, { type: "object" });

    expect(setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    const options = setDiagnosticsOptions.mock.calls[0]![0] as {
      validate: boolean;
      schemas: Array<{ schema?: unknown }>;
    };
    expect(options.validate).toBe(true);
    expect(options.schemas[0]!.schema).toEqual({ type: "object" });
  });
});

describe("loadMnxSchema", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("loads schema JSON once and reuses the cached promise", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: "object", title: "MNX" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loadMnxSchema } = await import("../lib/monacoMnxSchema");
    const first = await loadMnxSchema();
    const second = await loadMnxSchema();

    expect(first).toEqual({ type: "object", title: "MNX" });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/mnx-schema.json");
  });

  it("returns null when schema fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { loadMnxSchema } = await import("../lib/monacoMnxSchema");
    await expect(loadMnxSchema()).resolves.toBeNull();
  });

  it("returns null when schema endpoint is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { loadMnxSchema } = await import("../lib/monacoMnxSchema");
    await expect(loadMnxSchema()).resolves.toBeNull();
  });
});
