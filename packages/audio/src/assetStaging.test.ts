import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncSoundAssets } from "./assetStaging";
import { buildSchedulingWorklet } from "./sf2Scheduling";

vi.mock("node:fs", () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const audioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = dirname(fileURLToPath(import.meta.resolve("spessasynth_lib/package.json")));
const destination = resolve(audioRoot, "dist", "sounds");
const workletPath = resolve(destination, "viritura-sf2-processor.js");
const vendorPath = resolve(packageRoot, "dist", "spessasynth_processor.min.js");
const vendorSource =
  'registerProcessor("vendor", class extends AudioWorkletProcessor { process() { return true; } });\n';
const assets = [
  "Shan-SGM-Pro-15.sf2",
  "ir/french-salon.wav",
  "ir/masonic-lodge.wav",
  "ir/musikvereinsaal.wav",
  "ir/scala-milan-opera.wav",
  "ir/st-nicolaes-church.wav",
];
const files = new Map<string, Buffer>();

describe("sound asset staging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    files.clear();
    for (const asset of assets) files.set(resolve(audioRoot, "assets", "sounds", asset), Buffer.from(asset));
    files.set(vendorPath, Buffer.from(vendorSource));
    files.set(`${vendorPath}.map`, Buffer.from('{"version":3}'));
    vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(readFileSync).mockImplementation((path, options) => {
      const content = files.get(String(path));
      if (!content) throw new Error(`Missing mocked asset: ${String(path)}`);
      return options === "utf8" ? content.toString("utf8") : content;
    });
    vi.mocked(copyFileSync).mockImplementation((source, target) => {
      const content = files.get(String(source));
      if (!content) throw new Error(`Missing mocked asset: ${String(source)}`);
      files.set(String(target), Buffer.from(content));
    });
    vi.mocked(writeFileSync).mockImplementation((path, content) => {
      files.set(String(path), Buffer.from(String(content)));
    });
  });

  it("stages the exact vendor fixture with its scheduling wrapper and preserves canonical and vendor artifacts", () => {
    syncSoundAssets(destination);

    expect(files.get(workletPath)?.toString("utf8")).toBe(buildSchedulingWorklet(vendorSource));
    expect(files.get(workletPath)?.toString("utf8")).toContain(vendorSource);
    expect(files.get(workletPath)?.toString("utf8")).toContain("viritura:cancelScheduledNotes");
    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(workletPath, buildSchedulingWorklet(vendorSource), "utf8");
    for (const asset of assets) {
      expect(files.get(resolve(destination, asset))).toEqual(files.get(resolve(audioRoot, "assets", "sounds", asset)));
    }
    for (const asset of ["spessasynth_processor.min.js", "spessasynth_processor.min.js.map"]) {
      expect(files.get(resolve(destination, asset))).toEqual(files.get(resolve(packageRoot, "dist", asset)));
    }
    expect(copyFileSync).toHaveBeenCalledTimes(8);
    const lockCall = vi.mocked(mkdirSync).mock.calls.findIndex((call) => call.length === 1);
    const lockPath = vi.mocked(mkdirSync).mock.calls[lockCall]![0];
    expect(vi.mocked(mkdirSync).mock.invocationCallOrder[lockCall]).toBeLessThan(
      vi.mocked(writeFileSync).mock.invocationCallOrder[0]!,
    );
    expect(rmSync).toHaveBeenCalledExactlyOnceWith(lockPath, { force: true, recursive: true });
    expect(vi.mocked(rmSync).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(writeFileSync).mock.invocationCallOrder[0]!,
    );
  });

  it("does not overwrite unchanged generated or copied assets on repeated staging", () => {
    syncSoundAssets(destination);
    vi.mocked(copyFileSync).mockClear();
    vi.mocked(writeFileSync).mockClear();

    syncSoundAssets(destination);

    expect(copyFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("regenerates stale output and follows changes to the vendor source", () => {
    syncSoundAssets(destination);
    files.set(workletPath, Buffer.from("stale wrapper"));
    vi.mocked(writeFileSync).mockClear();

    syncSoundAssets(destination);
    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(workletPath, buildSchedulingWorklet(vendorSource), "utf8");

    const updatedSource = `${vendorSource}// Updated vendor\n`;
    files.set(vendorPath, Buffer.from(updatedSource));
    vi.mocked(writeFileSync).mockClear();
    syncSoundAssets(destination);
    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(workletPath, buildSchedulingWorklet(updatedSource), "utf8");
    expect(files.get(resolve(destination, "spessasynth_processor.min.js"))?.toString("utf8")).toBe(updatedSource);
  });

  it("releases the staging lock after a generated asset write fails and allows retry", () => {
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error("write failed");
    });

    expect(() => syncSoundAssets(destination)).toThrow("write failed");
    expect(rmSync).toHaveBeenCalledOnce();
    syncSoundAssets(destination);
    expect(files.get(workletPath)?.toString("utf8")).toBe(buildSchedulingWorklet(vendorSource));
    expect(rmSync).toHaveBeenCalledTimes(2);
  });
});
