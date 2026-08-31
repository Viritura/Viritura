/**
 * Desktop VST transport — the native side of {@link VstTransport}.
 *
 * Bridges the SF2 conductor in `@viritura/playback` to the in-process VST3 host
 * exposed by the Tauri `vst_playback_*` / `vst_compile_mapper` commands. For each
 * VST-assigned part it looks up the slot's binding, generates the part's
 * notation-level performance events, compiles them through the slot's Lua mapper,
 * and hands the resulting MIDI to the host per instrument slot. Parts whose slot
 * is unconfigured or whose mapper fails to compile are simply not claimed, so the
 * conductor keeps them on the SoundFont fallback (§3.8).
 *
 * Returns `undefined` off the desktop shell (the web build injects no transport),
 * and imports Tauri lazily so the web bundle never eagerly loads it.
 */

import type { Score } from "@viritura/core";
import type { Sf2PartAssignment, VstPartAssignment, VstPreparePlan, VstTransport } from "@viritura/playback";
import { generatePerformanceEvents } from "@viritura/midi";
import type { SlotBinding, ProfileSlot, VstInstrumentProfile } from "@viritura/instrument-profiles";
import { isDesktopHost } from "./profileHostBridge";
import { readInstrumentProfileState, useInstrumentProfileStore } from "./instrumentProfileStore";
import { readFxChains, useFxChainStore, type FxChannelId, type FxPluginEntry } from "./fxChainStore";
import { readFxPluginState } from "./fxChainState";
import { beginBackgroundTask, updateBackgroundTask, endBackgroundTask } from "../store/backgroundTaskStore";
import { toast } from "sonner";

/** One scheduled MIDI message as compiled by the native mapper (opaque wire shape). */
interface ScheduledMidiWire {
  readonly atSeconds: number;
  readonly type: string;
  readonly [field: string]: unknown;
}

/** A scheduled message tagged with its source part, matching the Rust `PartScheduledMidi`. */
interface PartScheduledMidiWire extends ScheduledMidiWire {
  readonly part: number;
}

/** A slot the open score references, matching the Rust `SlotSpec` wire type. */
interface SlotSpec {
  readonly slotKey: string;
  /** `"vst"` (plugin-voiced) or `"sf2"` (native SoundFont-voiced). */
  readonly kind: "vst" | "sf2";
  readonly pluginPath: string;
  /** SF2 slots: absolute path to the SoundFont file. */
  soundfontPath?: string;
  /** SF2 slots: GM program the voice loads. */
  program?: number;
  /** SF2 slots: whether the voice is a percussion kit (GM drum channel). */
  isDrum?: boolean;
  state?: readonly number[];
  events: PartScheduledMidiWire[];
  /** Post-fader amount of this slot's signal sent to the shared reverb bus. */
  reverbSend?: number;
}

/** Plugin-load progress tick from the host worker, matching Rust `LoadProgress`. */
interface LoadProgress {
  readonly phase: "loading" | "done";
  readonly loaded: number;
  readonly total: number;
  /** Slot being loaded, so the frontend can show its instrument label. */
  readonly slotKey: string;
  /** Plugin file name, a fallback when the slot has no friendlier label. */
  readonly name: string;
}

async function tauriInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function tauriListen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

/**
 * Load the given slots, surfacing progress as a background task. Instantiating
 * plugins is the slow part of a cold play (seconds each); the host worker emits
 * `vst-load-progress` as each instrument loads, which we fold into a single task
 * label ("Loading Violin 1… (3/11)") using each slot's instrument label. The task
 * is tied to the invocation's lifetime, so it always clears — even if the load
 * fails. A load short enough never to pass the toaster's delay threshold shows no
 * toast at all.
 */
async function loadWithProgress(specs: SlotSpec[], labels: ReadonlyMap<string, string>): Promise<void> {
  // Seed the label with the first slot's instrument name. A cold load spends
  // almost all its time in the very first plugin instantiation (loading the
  // shared plugin binary + its samples), so the first progress event can lag
  // seconds behind; showing that instrument's name up front beats a generic
  // "Loading instruments…" placeholder for nearly the whole load.
  const firstLabel = specs.length > 0 ? (labels.get(specs[0]!.slotKey) ?? "") : "";
  const initial = firstLabel ? `Loading ${firstLabel}… (1/${specs.length})` : "Loading instruments…";
  const taskId = beginBackgroundTask(initial);
  const unlisten = await tauriListen<LoadProgress>("vst-load-progress", (p) => {
    if (p.phase === "loading") {
      const label = labels.get(p.slotKey) ?? p.name;
      updateBackgroundTask(taskId, `Loading ${label}… (${p.loaded + 1}/${p.total})`);
    }
  });
  try {
    await tauriInvoke("vst_playback_load", { slots: specs });
  } finally {
    unlisten();
    endBackgroundTask(taskId);
  }
}

function findSlot(
  profiles: readonly VstInstrumentProfile[],
  hostProfileId: string,
  instrumentSlot: string,
): ProfileSlot | undefined {
  const profile = profiles.find((entry) => entry.id === hostProfileId);
  return profile?.slots.find((slot) => slot.slotId === instrumentSlot);
}

type PerformanceEvents = ReturnType<typeof generatePerformanceEvents>;
type FxChainsConfig = ReturnType<typeof readFxChains>;

/** One plugin as the native `set_reverb_chain`/`set_master_chain` commands expect. */
interface HostPluginSpec {
  readonly pluginPath: string;
  readonly state?: readonly number[] | null;
}

/**
 * Prepare-time caches. Every key is derived from content — a hash of the
 * generated events, the content-addressed `stateRef`, or a per-slot signature —
 * so a stale entry can never be served: when the music, plugin state, or routing
 * changes, its derived key changes and the entry misses. This is what makes a
 * *repeat* play cheap. `partCompileCache`/`stateCache` are pure memoization and
 * safe to keep indefinitely; `lastSentSlotSigs`/`lastReverbChainKey`/
 * `lastMasterChainKey` mirror what the host currently holds and so must be reset
 * whenever the host is released.
 */
interface PartCompile {
  readonly scriptPath: string;
  readonly eventsSig: string;
  readonly tagged: readonly PartScheduledMidiWire[];
}
const partCompileCache = new Map<number, PartCompile>();
const stateCache = new Map<string, readonly number[]>();
let lastSentSlotSigs = new Map<string, string>();
let lastReverbChainKey: string | null = null;
let lastMasterChainKey: string | null = null;
/** Which native slot voices each owned part, so the mixer can push per-part gain. */
let ownedSlotByPart = new Map<number, string>();

/** All host-mirroring caches back to "nothing loaded" (call when the host is released). */
function resetHostMirror(): void {
  lastSentSlotSigs = new Map();
  lastReverbChainKey = null;
  lastMasterChainKey = null;
  ownedSlotByPart = new Map();
}

/**
 * Forget everything we believe the native host holds, forcing the next play to
 * fully reload. Call after anything that releases the host outside the transport
 * — notably opening a plugin editor (`captureState` → `release_if_running` tears
 * down every slot and the audio device), after which a stale mirror would make
 * the next play a no-op reconcile and play silence.
 */
export function invalidateVstHostMirror(): void {
  resetHostMirror();
}

/** Fast, allocation-light content signature (32-bit FNV-1a, length-salted). */
function signature(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${input.length}:${(hash >>> 0).toString(36)}`;
}

function sameKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a.keys()) if (!b.has(key)) return false;
  return true;
}

/**
 * Compile one part's performance events into part-tagged MIDI, reusing the cached
 * result when neither the mapper script nor the generated events changed (the
 * common case on a replay). Returns `undefined` if the mapper fails, so the
 * caller leaves the part on the SF2 fallback (§3.8).
 */
async function compilePart(
  partIndex: number,
  scriptPath: string,
  events: PerformanceEvents,
): Promise<{ tagged: readonly PartScheduledMidiWire[]; eventsSig: string } | undefined> {
  const eventsSig = signature(JSON.stringify(events));
  const cached = partCompileCache.get(partIndex);
  if (cached && cached.scriptPath === scriptPath && cached.eventsSig === eventsSig) {
    return { tagged: cached.tagged, eventsSig };
  }
  let scheduled: ScheduledMidiWire[];
  try {
    scheduled = await tauriInvoke<ScheduledMidiWire[]>("vst_compile_mapper", { scriptPath, events });
  } catch (error) {
    console.warn(`VST mapper for part ${partIndex} failed to compile; falling back to SF2:`, error);
    return undefined;
  }
  const tagged = scheduled.map((event) => ({ ...event, part: partIndex }));
  partCompileCache.set(partIndex, { scriptPath, eventsSig, tagged });
  return { tagged, eventsSig };
}

/** Opaque plugin state for a binding, cached by its content-addressed `stateRef`. */
async function loadSlotState(binding: SlotBinding): Promise<readonly number[] | undefined> {
  const ref = binding.stateRef;
  if (!ref) return undefined;
  const cached = stateCache.get(ref);
  if (cached) return cached;
  const bytes = await readInstrumentProfileState(binding);
  if (!bytes) return undefined;
  const arr = Array.from(bytes);
  stateCache.set(ref, arr);
  return arr;
}

/** How a slot is voiced: a VST plugin or a native SoundFont program. */
type SlotSource =
  | { readonly kind: "vst"; readonly pluginPath: string; readonly binding: SlotBinding }
  | { readonly kind: "sf2"; readonly soundfontPath: string; readonly program: number; readonly isDrum: boolean };

/** A slot assembled from one or more parts, pending signature + host reconcile. */
interface SlotBuild {
  readonly slotKey: string;
  /** Human instrument label (e.g. "Violin 1"), shown while the slot loads. */
  readonly label: string;
  readonly reverbSend: number;
  readonly source: SlotSource;
  events: PartScheduledMidiWire[];
  /** Per-part event signatures in merge order, folded into the slot signature. */
  partSigs: string[];
}

async function slotToSpec(build: SlotBuild): Promise<SlotSpec> {
  const base = { slotKey: build.slotKey, events: build.events, reverbSend: build.reverbSend };
  if (build.source.kind === "sf2") {
    return {
      ...base,
      kind: "sf2",
      pluginPath: "",
      soundfontPath: build.source.soundfontPath,
      program: build.source.program,
      isDrum: build.source.isDrum,
    };
  }
  const state = await loadSlotState(build.source.binding);
  return {
    ...base,
    kind: "vst",
    pluginPath: build.source.pluginPath,
    ...(state ? { state } : {}),
  };
}

/** Signature material for a slot's source + schedule, so the reconcile can skip an unchanged host load. */
function slotSignatureMaterial(build: SlotBuild): string {
  const parts = build.partSigs.join(",");
  if (build.source.kind === "sf2") {
    return `sf2|${build.source.soundfontPath}|${build.source.program}|${build.source.isDrum}|${build.reverbSend}|${parts}`;
  }
  return `vst|${build.source.pluginPath}|${build.source.binding.stateRef ?? ""}|${build.reverbSend}|${parts}`;
}

/** Clamp a value to a MIDI data byte (`0..=127`). */
function clampByte(value: number): number {
  return Math.min(127, Math.max(0, Math.round(value)));
}

/**
 * Lower one non-VST part's notation performance events to raw SoundFont MIDI:
 * a `note_on`/`note_off` pair per note (paired by the note's stable id, as the
 * host requires) plus CC11 expression from the dynamics ramp. Percussion kits are
 * excluded upstream, so every event is a pitched note on channel 0.
 */
function sf2Schedule(score: Score, partIndex: number): PartScheduledMidiWire[] {
  const out: PartScheduledMidiWire[] = [];
  for (const ev of generatePerformanceEvents(score, partIndex)) {
    const atSeconds = Math.max(0, ev.time);
    if (ev.kind === "noteOn") {
      out.push({
        atSeconds,
        part: partIndex,
        type: "note_on",
        note_id: ev.note.id,
        channel: 0,
        note: ev.note.pitch,
        velocity: Math.max(1, clampByte(ev.note.dynamics * 127)),
      });
    } else if (ev.kind === "noteOff") {
      out.push({ atSeconds, part: partIndex, type: "note_off", note_id: ev.note.id });
    } else if (ev.kind === "dynamics") {
      out.push({
        atSeconds,
        part: partIndex,
        type: "control_change",
        channel: 0,
        controller: 11,
        value: clampByte(ev.value * 127),
      });
    }
  }
  return out;
}

/** Absolute path to the bundled SoundFont, resolved once per session. */
let cachedSoundfontPath: string | null = null;
async function soundfontPath(): Promise<string> {
  if (cachedSoundfontPath === null) {
    cachedSoundfontPath = await tauriInvoke<string>("vst_soundfont_path", {});
  }
  return cachedSoundfontPath;
}

/**
 * Send the host only what actually changed. When the slot set and every slot
 * signature match the last play we skip `vst_playback_load` entirely; when the
 * set is unchanged but some slots differ we load just those; only a changed slot
 * set (an instrument added/removed) triggers a full reconcile. The reverb and
 * master FX chains are pushed only when their composition changed.
 * `lastSentSlotSigs`/`lastReverbChainKey`/`lastMasterChainKey` are updated to
 * reflect exactly what the host now holds.
 */
async function reconcileHost(
  builds: ReadonlyMap<string, SlotBuild>,
  sigs: ReadonlyMap<string, string>,
  fx: FxChainsConfig,
): Promise<{ mode: string; sent: number; fxChanged: boolean }> {
  const changedKeys = [...builds.keys()].filter((key) => sigs.get(key) !== lastSentSlotSigs.get(key));
  const keysUnchanged = sameKeys(sigs, lastSentSlotSigs);

  let mode: "skip" | "partial" | "full";
  let toSend: SlotBuild[];
  if (keysUnchanged && changedKeys.length === 0) {
    mode = "skip";
    toSend = [];
  } else if (keysUnchanged) {
    mode = "partial";
    toSend = changedKeys.map((key) => builds.get(key)!);
  } else {
    mode = "full";
    toSend = [...builds.values()];
  }

  if (mode !== "skip") {
    const specs = await Promise.all(toSend.map(slotToSpec));
    const labels = new Map([...builds.values()].map((b) => [b.slotKey, b.label]));
    await loadWithProgress(specs, labels);
    // `load` only adds/refreshes slots, so prune the host to exactly the slots
    // this play references. Without this, a part that switched voicing (e.g. from
    // the native SoundFont strip to a VST) would leave its old strip loaded and
    // replaying in perfect sync with the new one — heard as a doubled voice.
    await tauriInvoke("vst_playback_retain", { keys: [...builds.keys()] });
  }
  lastSentSlotSigs = new Map(sigs);

  const fxChanged = await reconcileFxChains(fx);
  return { mode, sent: toSend.length, fxChanged };
}

/** A chain's reload key: composition (paths + captured-state versions) + reverb wet. */
function chainKey(plugins: readonly FxPluginEntry[], suffix = ""): string {
  return plugins.map((p) => `${p.pluginPath}:${p.stateVersion}`).join("|") + suffix;
}

/** Read each entry's captured patch (if any) into the host's plugin-spec shape. */
async function chainSpecs(channel: FxChannelId, plugins: readonly FxPluginEntry[]): Promise<HostPluginSpec[]> {
  return Promise.all(
    plugins.map(async (entry) => {
      const bytes = entry.stateVersion > 0 ? await readFxPluginState(channel, entry.id) : null;
      return { pluginPath: entry.pluginPath, state: bytes ? Array.from(bytes) : null };
    }),
  );
}

/**
 * Push one FX channel's chain to the host, but only when its composition changed
 * since the last push (tracked by `lastReverbChainKey`/`lastMasterChainKey`).
 * Returns whether a push happened. FX setup is isolated from instrument loading:
 * a chain plugin that fails to load/activate must NOT abort the whole native
 * prepare — the instruments already loaded, so we keep native playback going
 * (dry) rather than collapsing every part back to the browser SF2 path. The
 * failure is surfaced once and the chain key left stale so the next play retries.
 */
async function pushFxChain(channel: FxChannelId, fx: FxChainsConfig): Promise<boolean> {
  const key = channel === "reverb" ? chainKey(fx.reverb.plugins, `|wet=${fx.reverb.wet}`) : chainKey(fx.master.plugins);
  const last = channel === "reverb" ? lastReverbChainKey : lastMasterChainKey;
  if (key === last) return false;

  try {
    if (channel === "reverb") {
      const plugins = await chainSpecs("reverb", fx.reverb.plugins);
      await tauriInvoke("vst_playback_set_reverb_chain", { plugins, wet: fx.reverb.wet });
      lastReverbChainKey = key;
    } else {
      const plugins = await chainSpecs("master", fx.master.plugins);
      await tauriInvoke("vst_playback_set_master_chain", { plugins });
      lastMasterChainKey = key;
    }
    return true;
  } catch (error) {
    const label = channel === "reverb" ? "Reverb" : "Master FX";
    console.error(`VST ${label} chain setup failed; continuing without it:`, error);
    toast.error(`${label} chain failed to load — playing without it.`, {
      description: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Push both FX chains, each only when its composition changed. */
async function reconcileFxChains(fx: FxChainsConfig): Promise<boolean> {
  const reverbChanged = await pushFxChain("reverb", fx);
  const masterChanged = await pushFxChain("master", fx);
  return reverbChanged || masterChanged;
}

/**
 * Ensure a channel's current FX chain is loaded on the host, then resolve. Called
 * before opening an FX plugin's editor (which attaches to the already-loaded
 * instance), so the editor can be opened without first pressing play. Spawns the
 * host thread on demand; a no-op when the chain is already current on the host.
 */
export async function ensureFxChainLoaded(channel: FxChannelId): Promise<void> {
  if (!isDesktopHost()) return;
  await pushFxChain(channel, readFxChains());
}

/** Build the VST-voiced slots from the plan's VST assignments, merging shared slots. */
async function buildVstSlots(
  score: Score,
  parts: readonly VstPartAssignment[],
  reverbSend: number,
  builds: Map<string, SlotBuild>,
  owned: Set<number>,
): Promise<void> {
  const profiles = useInstrumentProfileStore.getState().profiles;
  for (const { partIndex, vst } of parts) {
    const slot = findSlot(profiles, vst.hostProfileId, vst.instrumentSlot);
    const binding = slot?.binding;
    // A partially-configured slot can't be hosted: leave the part on SF2 (§3.8).
    if (!binding?.luaScriptPath || !binding.pluginPath) continue;

    const events = generatePerformanceEvents(score, partIndex);
    const compiled = await compilePart(partIndex, binding.luaScriptPath, events);
    if (!compiled) continue;

    const slotKey = `${vst.hostProfileId}:${vst.instrumentSlot}`;
    const existing = builds.get(slotKey);
    if (existing) {
      // Several parts can share one instrument slot (one plugin instance driven
      // on multiple channels): merge their scheduled MIDI into that slot.
      existing.events = existing.events.concat(compiled.tagged);
      existing.partSigs.push(compiled.eventsSig);
    } else {
      builds.set(slotKey, {
        slotKey,
        label: slot?.label || vst.instrumentSlot,
        reverbSend,
        source: { kind: "vst", pluginPath: binding.pluginPath, binding },
        events: [...compiled.tagged],
        partSigs: [compiled.eventsSig],
      });
    }
    owned.add(partIndex);
    ownedSlotByPart.set(partIndex, slotKey);
  }
}

/** Build one native SoundFont slot per pitched non-VST part (native render mode). */
async function buildSf2Slots(
  score: Score,
  parts: readonly Sf2PartAssignment[],
  reverbSend: number,
  builds: Map<string, SlotBuild>,
  owned: Set<number>,
): Promise<void> {
  if (parts.length === 0) return;
  const fontPath = await soundfontPath();
  for (const { partIndex, program, isDrum } of parts) {
    const events = sf2Schedule(score, partIndex);
    const slotKey = `sf2:${partIndex}`;
    builds.set(slotKey, {
      slotKey,
      label: score.parts[partIndex]?.name || `Part ${partIndex + 1}`,
      reverbSend,
      source: { kind: "sf2", soundfontPath: fontPath, program, isDrum },
      events,
      partSigs: [signature(JSON.stringify(events))],
    });
    owned.add(partIndex);
    ownedSlotByPart.set(partIndex, slotKey);
  }
}

async function prepareSlots(score: Score, plan: VstPreparePlan): Promise<ReadonlySet<number>> {
  const t0 = performance.now();
  const owned = new Set<number>();
  const builds = new Map<string, SlotBuild>();
  ownedSlotByPart = new Map();

  // One shared reverb aux bus for every hosted part: each slot sends this global
  // amount into the reverb chain, whose wet return the host folds into the
  // master. Seed the chain from the configured default reverb if it's empty, then
  // read once so every slot uses the same send.
  useFxChainStore.getState().ensureReverbSeeded();
  const fx = readFxChains();
  const reverbSend = fx.reverb.plugins.length > 0 ? fx.reverb.send : 0;

  await buildVstSlots(score, plan.vstParts, reverbSend, builds, owned);
  await buildSf2Slots(score, plan.sf2Parts, reverbSend, builds, owned);

  // Signature each slot's schedule so the host reconcile can send only the deltas.
  const sigs = new Map<string, string>();
  for (const build of builds.values()) {
    sigs.set(build.slotKey, signature(slotSignatureMaterial(build)));
  }

  const result = await reconcileHost(builds, sigs, fx);
  console.info(
    `[vst-prepare] total=${Math.round(performance.now() - t0)}ms load=${result.mode} ` +
      `slots=${sigs.size} sent=${result.sent} fx=${result.fxChanged ? "pushed" : "skip"}`,
  );
  return owned;
}

/**
 * Create the desktop VST transport, or `undefined` when not running under the
 * Tauri shell (the web build plays every part through SoundFont).
 */
export function createVstTransport(): VstTransport | undefined {
  if (!isDesktopHost()) return undefined;

  return {
    prepare(score, plan) {
      return prepareSlots(score, plan);
    },
    async start(originSeconds) {
      await tauriInvoke("vst_playback_start", { originSeconds });
    },
    async stop() {
      await tauriInvoke("vst_playback_stop", {});
    },
    async seek(seconds) {
      await tauriInvoke("vst_playback_seek", { seconds });
    },
    async setPartGain(partIndex, gain) {
      const slotKey = ownedSlotByPart.get(partIndex);
      if (!slotKey) return;
      await tauriInvoke("vst_playback_set_gain", { slotKey, gain });
    },
    async previewNote(partIndex, note, velocity, durationMs) {
      const slotKey = ownedSlotByPart.get(partIndex);
      if (!slotKey) return false;
      await tauriInvoke("vst_playback_preview", {
        slotKey,
        note,
        velocity,
        durationMs,
      });
      return true;
    },
    async setMutedParts(parts) {
      await tauriInvoke("vst_playback_set_muted", { parts: [...parts] });
    },
    async release() {
      // The host is being torn down: forget what we thought it held so the next
      // prepare does a full (re)load rather than skipping on a stale signature.
      resetHostMirror();
      await tauriInvoke("vst_playback_release", {});
    },
  };
}
