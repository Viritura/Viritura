import { describe, expect, it } from "vitest";
import { parseRegistry, serializeRegistry } from "./registryCodec";
import { createInstrumentProfileStore, createUnavailableProfileStore } from "./profileStore";
import type { FileSystemPort } from "./ports";
import type { PluginIdentity, VstInstrumentProfile } from "../types";

function createMemoryFs(): FileSystemPort & { files: Map<string, Uint8Array>; renames: number } {
  const files = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    files,
    renames: 0,
    async readText(path) {
      const b = files.get(path);
      return b === undefined ? null : dec.decode(b);
    },
    async writeText(path, contents) {
      files.set(path, enc.encode(contents));
    },
    async readBinary(path) {
      const b = files.get(path);
      return b === undefined ? null : b;
    },
    async writeBinary(path, bytes) {
      files.set(path, bytes);
    },
    async exists(path) {
      return files.has(path);
    },
    async rename(from, to) {
      const b = files.get(from);
      if (b === undefined) throw new Error(`rename: missing ${from}`);
      files.set(to, b);
      files.delete(from);
      this.renames++;
    },
    async mkdirp() {
      // no-op for the in-memory fs
    },
  };
}

// A deterministic, injectable content hash standing in for SHA-256 in tests.
async function fakeHash(bytes: Uint8Array): Promise<string> {
  let h = 0;
  for (const b of bytes) h = (h * 31 + b) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const sampleProfile: VstInstrumentProfile = {
  id: "user-1",
  version: 2,
  displayName: "My Orchestra",
  slots: [
    {
      slotId: "v1",
      catalogInstrumentId: "violin",
      section: "strings",
      label: "Violin 1",
      binding: { baseChannel: 0, luaScriptPath: "/v.lua", pluginPath: "/v.vst3", stateRef: "abc" },
    },
  ],
};

describe("registry codec", () => {
  it("round-trips a profile set", () => {
    const text = serializeRegistry([sampleProfile]);
    const { profiles, issues } = parseRegistry(text);
    expect(issues).toEqual([]);
    expect(profiles).toEqual([sampleProfile]);
  });

  it("tolerates invalid JSON without throwing", () => {
    const { profiles, issues } = parseRegistry("{not json");
    expect(profiles).toEqual([]);
    expect(issues).toHaveLength(1);
  });

  it("drops malformed profiles and slots but keeps valid ones", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      profiles: [
        { id: "", displayName: "no id", slots: [] },
        {
          id: "good",
          displayName: "Good",
          slots: [
            { slotId: "ok", section: "brass", label: "Trumpet", binding: { baseChannel: 2 } },
            { slotId: "bad", section: "not-a-section" },
            { section: "strings" },
          ],
        },
      ],
    });
    const { profiles, issues } = parseRegistry(text);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe("good");
    expect(profiles[0]!.slots).toHaveLength(1);
    expect(profiles[0]!.slots[0]!.slotId).toBe("ok");
    expect(profiles[0]!.slots[0]!.binding.baseChannel).toBe(2);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("defaults an out-of-range baseChannel to 0", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      profiles: [
        {
          id: "p",
          displayName: "P",
          slots: [{ slotId: "s", section: "keys", label: "Piano", binding: { baseChannel: 99 } }],
        },
      ],
    });
    const { profiles } = parseRegistry(text);
    expect(profiles[0]!.slots[0]!.binding.baseChannel).toBe(0);
  });

  it("drops duplicate profile and slot ids", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      profiles: [
        { id: "dup", displayName: "A", slots: [] },
        { id: "dup", displayName: "B", slots: [] },
      ],
    });
    const { profiles, issues } = parseRegistry(text);
    expect(profiles).toHaveLength(1);
    expect(issues.some((i) => i.includes("duplicate profile"))).toBe(true);
  });
});

describe("instrument profile store", () => {
  const rootDir = "/prefs/instrument-profiles";

  it("returns an empty set when the registry does not exist", async () => {
    const fs = createMemoryFs();
    const store = createInstrumentProfileStore({ rootDir, fs, hashBytes: fakeHash });
    expect(await store.load()).toEqual({ profiles: [], issues: [] });
  });

  it("saves atomically (temp then rename) and reloads", async () => {
    const fs = createMemoryFs();
    const store = createInstrumentProfileStore({ rootDir, fs, hashBytes: fakeHash });
    await store.save([sampleProfile]);
    expect(fs.renames).toBe(1);
    expect(fs.files.has("/prefs/instrument-profiles/registry.json")).toBe(true);
    expect(fs.files.has("/prefs/instrument-profiles/registry.json.tmp")).toBe(false);
    const { profiles } = await store.load();
    expect(profiles).toEqual([sampleProfile]);
  });

  it("content-addresses state and skips rewriting identical bytes", async () => {
    const fs = createMemoryFs();
    const store = createInstrumentProfileStore({ rootDir, fs, hashBytes: fakeHash });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const ref1 = await store.putState(bytes);
    const rewrites = fs.renames;
    const ref2 = await store.putState(new Uint8Array([1, 2, 3, 4]));
    expect(ref1).toBe(ref2);
    expect(fs.files.has(`/prefs/instrument-profiles/state/${ref1}.bin`)).toBe(true);
    // Second put must not rename again (immutable, already present).
    expect(fs.renames).toBe(rewrites);
  });

  it("restores state only when identity matches", async () => {
    const fs = createMemoryFs();
    const store = createInstrumentProfileStore({ rootDir, fs, hashBytes: fakeHash });
    const bytes = new Uint8Array([9, 8, 7]);
    const ref = await store.putState(bytes);
    const identity: PluginIdentity = { format: "vst3", pluginId: "class-1" };
    const binding = { baseChannel: 0, stateRef: ref, pluginIdentity: identity };

    const ok = await store.restoreState(binding, identity);
    expect(ok).toEqual({ ok: true, bytes });

    const mismatch = await store.restoreState(binding, { format: "vst3", pluginId: "other" });
    expect(mismatch).toEqual({ ok: false, reason: "identity-mismatch" });

    const missing = await store.restoreState({ baseChannel: 0 }, identity);
    expect(missing).toEqual({ ok: false, reason: "missing" });
  });
});

describe("unavailable (web) store", () => {
  it("loads empty and refuses writes", async () => {
    const store = createUnavailableProfileStore();
    expect(await store.load()).toEqual({ profiles: [], issues: [] });
    await expect(store.save([sampleProfile])).rejects.toThrow(/desktop|web/i);
    await expect(store.putState(new Uint8Array([1]))).rejects.toThrow(/desktop|web/i);
    expect(await store.restoreState({ baseChannel: 0 }, { format: "vst3", pluginId: "x" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
