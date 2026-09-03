import { afterEach, describe, expect, it, vi } from "vitest";
import { configureMnxDiagnostics, loadMnxSchema } from "./diagnostics";

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
