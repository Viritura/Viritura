import { afterEach, describe, expect, it, vi } from "vitest";

// The trailing comment absorbs the runtime's appended asset path in the data URL.
const glue = `
export default async function init({ module_or_path }) {
  await WebAssembly.instantiate(module_or_path);
  return { memory: new WebAssembly.Memory({ initial: 1 }) };
}
export function engine_version() { return "test"; }
//`;
const assetBase = `data:text/javascript,${encodeURIComponent(glue)}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("WASM initialization", () => {
  it("initializes the glue asynchronously with the fetched bytes", async () => {
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    const instantiate = vi.spyOn(WebAssembly, "instantiate");
    const { setAssetBasePath } = await import("../basePath");
    setAssetBasePath(assetBase);
    const { initWasm, isWasmReady } = await import("../wasm");

    await Promise.all([initWasm(), initWasm()]);
    expect(instantiate).toHaveBeenCalledOnce();
    expect(isWasmReady()).toBe(true);
  });

  it("allows retry after asynchronous compilation fails", async () => {
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(new Uint8Array([0])))
        .mockResolvedValueOnce(new Response(bytes)),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setAssetBasePath } = await import("../basePath");
    setAssetBasePath(assetBase);
    const { initWasm, isWasmReady, getWasmInitError } = await import("../wasm");

    await initWasm();
    expect(isWasmReady()).toBe(false);
    expect(getWasmInitError()).toBeInstanceOf(WebAssembly.CompileError);
    await initWasm();
    expect(isWasmReady()).toBe(true);
    expect(getWasmInitError()).toBeNull();
  });
});
