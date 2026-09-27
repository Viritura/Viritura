import { afterEach, describe, expect, it, vi } from "vitest";
import { configureMnxDiagnostics, getMnxValidationWorker, loadMnxSchema } from "./diagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configureMnxDiagnostics", () => {
  it("configures inline MNX schema validation for the editor model", () => {
    const setDiagnosticsOptions = vi.fn();
    configureMnxDiagnostics({ json: { jsonDefaults: { setDiagnosticsOptions } } } as never, { type: "object" });

    expect(setDiagnosticsOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        validate: true,
        enableSchemaRequest: false,
        schemas: [
          expect.objectContaining({
            fileMatch: ["*.mnx"],
            schema: { type: "object" },
          }),
        ],
      }),
    );
  });
});

describe("getMnxValidationWorker", () => {
  it("waits for Monaco's JSON mode to register on initial load", async () => {
    const worker = { doValidation: vi.fn() };
    const uri = { toString: () => "file:///playground.mnx" };
    const accessor = vi.fn().mockResolvedValue(worker);
    const getWorker = vi.fn().mockRejectedValueOnce("JSON not registered!").mockResolvedValue(accessor);

    await expect(getMnxValidationWorker({ json: { getWorker } } as never, uri as never)).resolves.toBe(worker);
    expect(getWorker).toHaveBeenCalledTimes(2);
    expect(accessor).toHaveBeenCalledWith(uri);
  });

  it("reports other worker failures instead of retrying them", async () => {
    const getWorker = vi.fn().mockRejectedValue(new Error("Worker unavailable"));

    await expect(getMnxValidationWorker({ json: { getWorker } } as never, {} as never)).rejects.toThrow(
      "Worker unavailable",
    );
    expect(getWorker).toHaveBeenCalledTimes(1);
  });

  it("reports a JSON mode that never registers", async () => {
    vi.useFakeTimers();
    try {
      const getWorker = vi.fn().mockRejectedValue("JSON not registered!");
      const result = getMnxValidationWorker({ json: { getWorker } } as never, {} as never);
      const failure = expect(result).rejects.toBe("JSON not registered!");

      await vi.advanceTimersByTimeAsync(10_000);
      await failure;
      expect(getWorker).toHaveBeenCalledTimes(201);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loadMnxSchema", () => {
  it("loads and caches each schema URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: "object" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadMnxSchema("/schema-cached.mnx.json")).resolves.toEqual({ type: "object" });
    await expect(loadMnxSchema("/schema-cached.mnx.json")).resolves.toEqual({ type: "object" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports HTTP failures and allows a later retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Unavailable" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ title: "MNX" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadMnxSchema("/schema-retry.mnx.json")).rejects.toThrow(
      "Unable to load the MNX schema (503 Unavailable)",
    );
    await expect(loadMnxSchema("/schema-retry.mnx.json")).resolves.toEqual({ title: "MNX" });
  });
});
