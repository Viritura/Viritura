/**
 * PlaybackContext — state management for audio playback.
 *
 * Holds playback status, playhead position, tempo, volume, metronome,
 * loop region, and sound library status. Provides actions for transport
 * controls, tempo/volume adjustment, and library management.
 *
 * Follows the DocumentContext pattern: separate state/actions contexts
 * with useMemo for minimal re-renders. Uses useReducer for complex state.
 *
 * Integration with DocumentContext: when the score changes, MidiTimeline
 * regeneration is debounced (100ms) to avoid thrashing during rapid edits.
 * The playhead position is preserved across score updates when possible.
 */

/* eslint-disable max-lines -- transport-provider shell after extracting the VST
   sub-concepts to sibling files (vstTransport interface, vstCoordination helpers:
   computeViewPartFilter / collectVstAssignments / prepareVstOwnedParts). The
   remainder is cohesive in-component React wiring — ~30 refs/state, the sampler
   build, and the play/pause/stop/seek transport callbacks — that can't move to
   siblings without breaking react-hooks/exhaustive-deps (a hook-returned ref is
   not recognized as stable) or duplicating the filter call across sites. */

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Score } from "@viritura/core";
import { toast } from "sonner";
import { dispatchPlayback, setPlaybackActions } from "./usePlayback";
import {
  computePartSignature,
  SCORE_CHANGE_DEBOUNCE_MS,
  type PartPatchInfo,
  type PlaybackActions,
  type PlaybackState,
} from "./playbackReducer";
import { applyPartLevel, applySectionLevels, recomputeSectionGain, type PartLevelRefs } from "./partLevels";
import {
  applyDetuneSpread,
  buildEqColorBuses,
  buildSectionSynths,
  createPartSampler,
  groupPartsBySection,
  selectDrumKitProgram,
  warmUpSectionSynths,
  type SectionEntry,
} from "./playbackSamplerHelpers";
import { requireSf2Sound, resolvePartSounds } from "./soundProfileRuntime";
import type { VstTransport, VstPartAssignment, Sf2PartAssignment, VstPreparePlan } from "./vstTransport";
import {
  collectSf2Assignments,
  collectVstAssignments,
  computeViewPartFilter,
  prepareVstOwnedParts,
} from "./vstCoordination";
import type { SoundProfileRegistry } from "@viritura/sound-profiles";
import {
  PlaybackEngine,
  SpatialNode,
  setListenerPosition as setSpatialListener,
  DEFAULT_LISTENER_POSITION,
  ReverbEngine,
  REVERB_PRESETS,
  Metronome,
} from "@viritura/audio";
import type {
  ISampler,
  MidiTimeline as EngineMidiTimeline,
  PlayheadResolver,
  ClickEvent,
  SpatialPosition,
  ReverbPreset,
  OrchestraSection,
} from "@viritura/audio";
import { usePercussionPreview } from "./usePercussionPreview";
import { generateTimeline, type MidiTimeline as ScoreMidiTimeline } from "@viritura/midi";
import { buildClickTrack, countInLeadSeconds } from "./clickTrack";
import { createPlayheadResolver, sourceMeasureBeatToSeconds } from "./playheadResolver";

// ═══════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════

interface PlaybackProviderProps {
  /** Optional score for timeline regeneration. */
  score?: Score | null;
  /** When set and non-empty, only these part IDs produce audio. Empty or undefined = play all. */
  visiblePartIds?: string[];
  /**
   * Available sound profiles for part→source resolution. Compose the user's VST
   * instrument profiles with VirituraSounds so VST assignments resolve; defaults
   * to the built-in VirituraSounds-only registry.
   */
  soundProfileRegistry?: SoundProfileRegistry;
  /**
   * Optional native VST transport (desktop only). When present, parts assigned
   * to a configured VST slot play through the in-process VST3 host in lockstep
   * with the SF2 engine, and their SF2 fallback voices are silenced. Omitted on
   * the web, where every part plays through SoundFont (§3.8).
   */
  vstTransport?: VstTransport;
  /**
   * Desktop audio render mode. In `"native"` mode every part plays through the
   * native mixer (VST parts through their plugin, the rest through the built-in
   * SoundFont) sharing one clock and the VST reverb bus; the browser engine still
   * runs to drive the playhead/metronome but its audio is silenced. In `"web"`
   * (default) the native host is unused and everything plays in the browser.
   */
  audioRenderMode?: "web" | "native";
  children: ReactNode;
}

function laneIdsByPart(timeline: EngineMidiTimeline | null, partCount: number): Map<number, string[]> {
  const lanes = new Map<number, Set<string>>();
  for (const event of timeline?.events ?? []) {
    if (!event.playbackLaneId) continue;
    const set = lanes.get(event.partIndex) ?? new Set<string>();
    set.add(event.playbackLaneId);
    lanes.set(event.partIndex, set);
  }
  return new Map(
    Array.from({ length: partCount }, (_, partIndex) => [
      partIndex,
      [...(lanes.get(partIndex) ?? new Set([`part:${partIndex}`]))].sort(),
    ]),
  );
}

function samplerSignature(score: Score, timeline: EngineMidiTimeline | null): string {
  const lanes = [...laneIdsByPart(timeline, score.parts.length).entries()]
    .map(([partIndex, ids]) => `${partIndex}:${ids.join(",")}`)
    .join("|");
  return `${computePartSignature(score)}#${JSON.stringify(score.soundProfile ?? null)}#${lanes}`;
}

// eslint-disable-next-line max-lines-per-function, max-statements -- audio-engine provider shell: declares ~30 refs/state for transport, scheduler, sampler, MIDI, mute/solo/level state, then wires effects for soundfont load, score-change reschedule, visible-parts gain, and tab-visibility throttle. Helpers are extracted (PartLevelRefs bundle, useFastLayoutCallback, schedulers); the remaining body is cohesive provider wiring that does not decompose cleanly.
export function PlaybackProvider({
  score,
  visiblePartIds,
  soundProfileRegistry,
  vstTransport,
  audioRenderMode = "web",
  children,
}: PlaybackProviderProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest sound-profile registry, read from callbacks/effects without re-subscribing. */
  const soundProfileRegistryRef = useRef<SoundProfileRegistry | undefined>(soundProfileRegistry);
  useEffect(() => {
    soundProfileRegistryRef.current = soundProfileRegistry;
  }, [soundProfileRegistry]);

  /** Latest native VST transport (desktop only), read from callbacks without re-subscribing. */
  const vstTransportRef = useRef<VstTransport | undefined>(vstTransport);
  useEffect(() => {
    vstTransportRef.current = vstTransport;
  }, [vstTransport]);
  /** Parts the VST host currently owns; their SF2 voices are muted (§3.8). */
  const vstOwnedPartsRef = useRef<ReadonlySet<number>>(new Set<number>());
  /** VST-assigned parts from the latest resolution, prepared at play/seek time. */
  const vstAssignmentsRef = useRef<readonly VstPartAssignment[]>([]);
  /** Non-VST pitched parts to voice on the native SoundFont in native mode. */
  const sf2AssignmentsRef = useRef<readonly Sf2PartAssignment[]>([]);
  /** Latest audio render mode, read from callbacks without re-subscribing. */
  const audioRenderModeRef = useRef<"web" | "native">(audioRenderMode);
  useEffect(() => {
    audioRenderModeRef.current = audioRenderMode;
  }, [audioRenderMode]);
  /** Latest effective mute set from the mixer, re-applied to the host on each play. */
  const vstMutedPartsRef = useRef<ReadonlySet<number>>(new Set<number>());

  // --- Audio engine refs (persist across renders) ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const mixBusRef = useRef<GainNode | null>(null);
  const samplersRef = useRef<Map<number, ISampler>>(new Map());
  /** Engine routing table: part-level control facades plus independently
   *  addressable staff/voice lane samplers. */
  const routingSamplersRef = useRef<Map<number | string, ISampler>>(new Map());
  /** Per-part spatial nodes (for canvas visualization). */
  const spatialNodesRef = useRef<Map<number, SpatialNode>>(new Map());
  /** Per-part reverb send GainNodes. */
  const reverbSendsRef = useRef<Map<number, GainNode>>(new Map());
  /** Shared reverb engine. */
  const reverbEngineRef = useRef<ReverbEngine | null>(null);
  /** Master output node — EQ + limiter before ctx.destination. */
  const masterOutRef = useRef<GainNode | null>(null);
  /** Air EQ high-shelf filter on master bus. */
  const airEQRef = useRef<BiquadFilterNode | null>(null);
  /** Limiter/compressor on master bus. */
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const timelineRef = useRef<EngineMidiTimeline | null>(null);
  const scoreTimelinePositionRef = useRef<Pick<
    ScoreMidiTimeline,
    "model" | "measureStartBeats" | "expandedMeasureToOriginal"
  > | null>(null);
  /** Tempo-model time→position inverse for the playhead, rebuilt with each
   *  timeline. Applied to the engine after every loadTimeline. */
  const playheadResolverRef = useRef<PlayheadResolver | null>(null);
  /** Pre-scheduled metronome click track (score times), rebuilt with each
   *  timeline. Applied to the engine alongside the playhead resolver. */
  const clickTrackRef = useRef<readonly ClickEvent[]>([]);
  /** Tempo/meter source for (re)building the click track without a full
   *  timeline regen (e.g. when the count-in toggles). */
  const clickSourceRef = useRef<{
    model: import("@viritura/midi").MidiTimeline["model"];
    measureStartBeats: number[];
    measureTimeSignatures: { count: number; unit: number }[];
  } | null>(null);
  /** Live mirror of `countInEnabled` so play()/click rebuilds read it without a
   *  store round-trip (matches how the metronome toggle drives the engine). */
  const countInEnabledRef = useRef(false);
  /** Signature of part list that samplers were last built for. Used to avoid
   *  destroying SF2 synths on every note edit — only rebuild when the
   *  instrument list actually changes. */
  const samplerPartSignatureRef = useRef<string | null>(null);
  /** Section-level SF2 synths (one synth per orchestra section for performance). */
  const sectionSynthsRef = useRef<Map<OrchestraSection, SectionEntry>>(new Map());
  /** Per-part orchestral base pan (-1 to +1) derived from spatial X position relative to listener. */
  const basePanRef = useRef<Map<number, number>>(new Map());
  /** Per-part mixer pan offset (-1 to +1) from the mixer knob. */
  const mixerPanRef = useRef<Map<number, number>>(new Map());
  /** Per-part mixer volume (0..1) from the mixer knob (mute folds in as 0). */
  const mixerVolumeRef = useRef<Map<number, number>>(new Map());
  /** Whether each part uses stage-derived depth; stereo mode still follows stage X for pan. */
  const stageDepthEnabledRef = useRef<Map<number, boolean>>(new Map());
  /** Per-part reference distance (instrument projection). */
  const partRefDistRef = useRef<Map<number, number>>(new Map());
  /** Per-part orchestra section (for section-gain recomputation when listener moves). */
  const partSectionRef = useRef<Map<number, OrchestraSection>>(new Map());
  /** EQ color buses — 4 shared buses with different tonal curves for player differentiation. */
  const eqBusesRef = useRef<{ input: GainNode; filters: BiquadFilterNode[] }[]>([]);
  /** Current listener position for distance-based reverb scaling. */
  const listenerPosRef = useRef<SpatialPosition>({ ...DEFAULT_LISTENER_POSITION });
  const metronomeRef = useRef<Metronome | null>(null);
  // Re-entrancy guard: prevents rapid Play clicks / Space presses from starting
  // multiple overlapping transports before the first play() finishes its async
  // preparation (AudioContext resume, sampler build, VST host prepare).
  const playStartInFlightRef = useRef(false);

  // Bundle the refs that level-recompute helpers read from. Built once
  // (all underlying ref objects are stable for the provider's lifetime),
  // so the bundle has a stable identity safe to use in `useCallback` deps.
  const levelRefs = useMemo<PartLevelRefs>(
    () => ({
      audioCtxRef,
      samplersRef,
      spatialNodesRef,
      sectionSynthsRef,
      listenerPosRef,
      partRefDistRef,
      partSectionRef,
      basePanRef,
      mixerPanRef,
      mixerVolumeRef,
      stageDepthEnabledRef,
    }),
    [],
  );

  // Lazy-init AudioContext + engine on first interaction
  const ensureEngine = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext({ latencyHint: "playback" });
    }

    // Master output chain: masterOut → airEQ → limiter → ctx.destination
    if (!masterOutRef.current || !masterOutRef.current.context || masterOutRef.current.context.state === "closed") {
      const ctx = audioCtxRef.current;
      const masterOut = ctx.createGain();
      masterOut.gain.value = 1.0;

      // Air EQ: gentle high-shelf boost to add presence/shimmer to GM instruments
      const airEQ = ctx.createBiquadFilter();
      airEQ.type = "highshelf";
      airEQ.frequency.value = 8000;
      airEQ.gain.value = 2.5; // +2.5 dB above 8 kHz

      // Limiter: prevent clipping, gentle glue compression
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.ratio.value = 12;
      limiter.knee.value = 6;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.18;

      masterOut.connect(airEQ);
      airEQ.connect(limiter);
      limiter.connect(ctx.destination);
      masterOutRef.current = masterOut;
      airEQRef.current = airEQ;
      limiterRef.current = limiter;
    }

    if (!mixBusRef.current || !mixBusRef.current.context || mixBusRef.current.context.state === "closed") {
      const bus = audioCtxRef.current.createGain();
      bus.gain.value = 1.0;
      bus.connect(masterOutRef.current!);
      mixBusRef.current = bus;
    }
    if (!reverbEngineRef.current) {
      const reverb = new ReverbEngine(audioCtxRef.current, masterOutRef.current!);
      reverbEngineRef.current = reverb;
      // Eagerly load the default reverb preset (Musikverein). Reverb is
      // supplemental, so playback must not wait for this network resource.
      void (async () => {
        const preset = REVERB_PRESETS.find((p: ReverbPreset) => p.id === "musikvereinsaal");
        if (preset) await reverb.loadPreset(preset);
      })().catch((err: unknown) => {
        console.warn("[Audio] Reverb preset failed to load; continuing dry:", err);
      });
    }
    if (!metronomeRef.current) {
      metronomeRef.current = new Metronome({ audioContext: audioCtxRef.current });
      metronomeRef.current.setEnabled(false); // off by default
    }
    if (!engineRef.current || !engineRef.current.getTimeline) {
      engineRef.current = new PlaybackEngine(audioCtxRef.current);

      // Pre-scheduled metronome: clicks ride the engine's look-ahead window so
      // they land sample-accurately on the audio clock. Metronome.scheduleClick
      // no-ops while disabled, so toggling the metronome on/off mid-playback
      // takes effect within one schedule window without rebuilding anything.
      engineRef.current.setClickCallback((audioTime, accented) =>
        metronomeRef.current?.scheduleClick(audioTime, accented),
      );

      // Forward playhead events to React state.
      engineRef.current.on("playhead", (detail) => {
        dispatchPlayback({ type: "SET_PLAYHEAD", position: detail.position });
      });
      engineRef.current.on("state", (detail) => {
        dispatchPlayback({ type: "SET_STATUS", status: detail.state as PlaybackState["status"] });
      });
    }
    return engineRef.current;
  }, []);

  /** Dispose all current samplers, section SF2 synths, and clear the maps. */
  const disposeAllSamplers = useCallback(() => {
    for (const [, sampler] of samplersRef.current) {
      if ("dispose" in sampler && typeof sampler.dispose === "function") {
        (sampler as { dispose(): void }).dispose();
      }
    }
    samplersRef.current.clear();
    routingSamplersRef.current.clear();
    basePanRef.current.clear();
    // NOTE: mixerPanRef / mixerVolumeRef are intentionally NOT cleared here.
    // They hold the user's mixer intent (volume/pan/mute), which is independent
    // of the samplers and must survive a rebuild so the next play() re-applies
    // the current mute/solo state via the initial applyPartLevel pass.
    partRefDistRef.current.clear();
    partSectionRef.current.clear();
    // Destroy section-level SF2 synth instances
    for (const [, entry] of sectionSynthsRef.current) {
      for (const synth of entry.synths) synth.destroy();
      try {
        entry.gainNode.disconnect();
      } catch {
        /* ok */
      }
      if (entry.reverbSend)
        try {
          entry.reverbSend.disconnect();
        } catch {
          /* ok */
        }
      if (entry.predelay)
        try {
          entry.predelay.disconnect();
        } catch {
          /* ok */
        }
    }
    sectionSynthsRef.current.clear();
    samplerPartSignatureRef.current = null;
    // Disconnect EQ color buses
    for (const bus of eqBusesRef.current) {
      for (const f of bus.filters)
        try {
          f.disconnect();
        } catch {
          /* ok */
        }
      try {
        bus.input.disconnect();
      } catch {
        /* ok */
      }
    }
    eqBusesRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      void vstTransportRef.current?.release();
      disposeAllSamplers();
      metronomeRef.current?.dispose();
      if (audioCtxRef.current?.state !== "closed") {
        void audioCtxRef.current?.close();
      }
    };
  }, [disposeAllSamplers]);

  // --- Pre-fetch SF2 data on mount (no AudioContext needed) ---
  const sf2BufferRef = useRef<ArrayBuffer | null>(null);
  const sf2FetchPromiseRef = useRef<Promise<ArrayBuffer | null> | null>(null);
  const previewPercussion = usePercussionPreview({
    ensureEngine,
    audioContextRef: audioCtxRef,
    masterOutputRef: masterOutRef,
    sf2BufferRef,
    sf2FetchPromiseRef,
  });

  useEffect(() => {
    if (sf2BufferRef.current || sf2FetchPromiseRef.current) return;

    // Pre-fetch SF2 SoundFont buffer
    const promise = (async (): Promise<ArrayBuffer | null> => {
      // Cloudflare Pages caps individual assets at 25 MiB, so production can
      // serve the 119 MiB SoundFont from an R2 custom domain. Local development
      // keeps using the app-relative public directory.
      const env = (
        import.meta as {
          env?: { BASE_URL?: string; VITE_VIRITURA_ASSET_BASE_URL?: string };
        }
      ).env;
      const configuredAssetBaseUrl = env?.VITE_VIRITURA_ASSET_BASE_URL?.trim();
      const baseUrl = configuredAssetBaseUrl
        ? `${configuredAssetBaseUrl.replace(/\/+$/, "")}/`
        : (env?.BASE_URL ?? "/");
      const sf2Url = `${baseUrl}sounds/Shan-SGM-Pro-15.sf2`;
      try {
        const response = await fetch(sf2Url);
        if (!response.ok) {
          console.warn("SF2 SoundFont not available — playback will be silent");
          toast.warning("Sound library unavailable", {
            description: `Couldn't load SoundFont (${response.status}). Playback will be silent until ${sf2Url} is reachable.`,
          });
          return null;
        }
        // Validate by content, not by Content-Type. SPA hosts (Vite dev
        // server, most static hosts) return index.html with HTTP 200 for any
        // unknown path, and some hosts serve the SoundFont with a wrong MIME:
        // Tauri's asset protocol sniffs the body with the `infer` crate, which
        // doesn't recognise the `RIFF…sfbk` SF2 form and then falls back to
        // `text/html` for the unknown `.sf2` extension. So the only reliable
        // signal is the leading "RIFF" magic — trust the bytes, not the label.
        const contentType = response.headers.get("Content-Type") ?? "";
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 4) {
          console.warn("[Audio] SF2 fetch returned an empty buffer");
          return null;
        }
        const magic = new Uint8Array(buffer, 0, 4);
        const isRiff = magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46;
        if (!isRiff) {
          // Not a SoundFont. Distinguish an SPA index.html fallback (host isn't
          // serving the asset at all) from other invalid payloads so the toast
          // is actionable.
          if (contentType.startsWith("text/html")) {
            console.warn(
              `[Audio] ${sf2Url} returned an HTML page instead of the SoundFont — the host is serving an SPA fallback.`,
            );
            toast.warning("Sound library not deployed at this origin", {
              description: `${sf2Url} returned HTML. Playback will be silent until the SoundFont is served from this origin.`,
            });
            return null;
          }
          console.warn("[Audio] SF2 fetch returned a non-RIFF payload — not a SoundFont");
          toast.warning("Sound library data is invalid", {
            description: `The file at ${sf2Url} is not a valid SoundFont. Playback will be silent.`,
          });
          return null;
        }
        sf2BufferRef.current = buffer;
        console.log("SF2 SoundFont data pre-fetched");
        return buffer;
      } catch (err) {
        console.warn("[Audio] SF2 fetch failed:", err);
        toast.warning("Sound library failed to load", {
          description: `Playback will be silent. Check your network connection or that ${sf2Url} is deployed.`,
        });
        return null;
      }
    })();
    sf2FetchPromiseRef.current = promise;

    // Pre-fetch the AudioWorklet processor script (cached by browser)
    const baseUrl2 = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
    fetch(`${baseUrl2}sounds/spessasynth_processor.min.js`).catch(() => {});

    // Pre-import spessasynth_lib module (dynamic import, cached by bundler)
    import("spessasynth_lib").catch(() => {});
  }, []);

  /** Create samplers for all parts using SF2 section-pooled synths. */
  const createSamplersForScore = useCallback(
    async (
      scoreParts: Score["parts"],
      ctx: AudioContext,
      _bus: GainNode,
      timeline: EngineMidiTimeline | null,
    ): Promise<{
      samplers: Map<number, ISampler>;
      routingSamplers: Map<number | string, ISampler>;
      patches: PartPatchInfo[];
    }> => {
      const samplers = new Map<number, ISampler>();
      const routingSamplers = new Map<number | string, ISampler>();
      const patches: PartPatchInfo[] = [];
      const lanes = laneIdsByPart(timeline, scoreParts.length);

      // Wait for SF2 buffer
      let sf2Buffer = sf2BufferRef.current;
      if (!sf2Buffer && sf2FetchPromiseRef.current) {
        sf2Buffer = await sf2FetchPromiseRef.current;
      }

      // Clear old spatial nodes and reverb sends
      for (const [, node] of spatialNodesRef.current) node.disconnect();
      spatialNodesRef.current.clear();
      reverbSendsRef.current.clear();

      // Resolve each part through the built-in compatibility profile before
      // constructing any SF2 source or section routing.
      const resolvedParts = resolvePartSounds(scoreParts, score?.soundProfile, soundProfileRegistryRef.current);

      // Record VST-assigned parts so play()/seek() can (re)prepare the native
      // host and silence their SF2 fallback voices. Web builds resolve no VST
      // sources, so this stays empty and every part plays through SoundFont.
      vstAssignmentsRef.current = collectVstAssignments(resolvedParts);
      sf2AssignmentsRef.current = collectSf2Assignments(resolvedParts);

      // Group parts by orchestra section for SF2 synth sharing
      const sectionParts = groupPartsBySection(resolvedParts);

      // ── EQ color buses ─────────────────────────────────────────────
      // 4 shared buses with slightly different EQ curves so that sections
      // routed through different buses get subtly distinct tonal colors.
      // Sections are assigned round-robin (modulo 4). See buildEqColorBuses
      // for the per-bus parameter values.
      const masterOut = masterOutRef.current!;
      const eqBuses = buildEqColorBuses(ctx, masterOut, eqBusesRef.current);
      eqBusesRef.current = eqBuses;

      // Build one SF2 synth per section (gain-based distance, reverb send,
      // pre-delay, EQ color bus). See buildSectionSynths for the per-section
      // routing details.
      const USABLE_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
      if (sf2Buffer) {
        const sectionMap = await buildSectionSynths({
          ctx,
          sf2Buffer,
          sectionParts,
          eqBuses,
          reverb: reverbEngineRef.current,
          listenerPos: listenerPosRef.current,
        });
        for (const [section, entry] of sectionMap) {
          sectionSynthsRef.current.set(section, entry);
        }
      }

      // Decide which GS drum kit (program on bank 128) the percussion section
      // should load. See selectDrumKitProgram for the heuristic.
      const drumKitProgram = selectDrumKitProgram(scoreParts);

      // Create per-part samplers using section synths. See createPartSampler
      // for the per-part routing/classification details.
      const partRefs = {
        samplers,
        spatialNodes: spatialNodesRef.current,
        sectionSynths: sectionSynthsRef.current,
        partSection: partSectionRef.current,
        partRefDist: partRefDistRef.current,
        basePan: basePanRef.current,
        mixerVolume: mixerVolumeRef.current,
      };
      for (let i = 0; i < scoreParts.length; i++) {
        await createPartSampler({
          partIndex: i,
          resolved: resolvedParts[i]!,
          ctx,
          masterOut,
          sf2Buffer: sf2Buffer ?? null,
          drumKitProgram,
          usableChannels: USABLE_CHANNELS,
          reverb: reverbEngineRef.current,
          refs: partRefs,
          laneIds: lanes.get(i)!,
          routingSamplers,
          patches,
        });
      }
      setSpatialListener(ctx, DEFAULT_LISTENER_POSITION.x, DEFAULT_LISTENER_POSITION.y);

      // Stash the freshly-built samplers so applyPartLevel can find them when
      // we run the initial proximity / pan-compensation pass below. (The
      // outer caller also assigns samplersRef, but the section/level
      // recompute needs it now.)
      for (const [i, s] of samplers) samplersRef.current.set(i, s);
      // Initialize section gains and per-part CC7/CC10 from the default
      // listener position so the engine starts in a self-consistent state.
      for (const section of sectionSynthsRef.current.keys()) {
        recomputeSectionGain(section, levelRefs);
      }
      for (const i of samplers.keys()) {
        applyPartLevel(i, levelRefs);
      }

      // Apply per-part micro-detuning so unisons (e.g. 4 horns on the same
      // note) sound like distinct players rather than producing phase
      // artefacts. See applyDetuneSpread for the spread math.
      applyDetuneSpread(resolvedParts, samplers);

      // Warm up every section synth before returning. See warmUpSectionSynths
      // for the why; without this, the first noteOn after page load can race
      // the AudioWorklet's message processing.
      await warmUpSectionSynths(sectionSynthsRef.current.values());

      return { samplers, routingSamplers, patches };
    },
    [levelRefs, score],
  );

  // --- Actions (play defined later, after createSamplersForScore) ---

  // Apply the engine's view-based part filter, combining the visible-part
  // selection with VST ownership (see computeViewPartFilter).
  const applyViewPartFilter = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !score) return;
    engine.setViewPartFilter(
      computeViewPartFilter({ parts: score.parts, visiblePartIds, vstOwnedParts: vstOwnedPartsRef.current }),
    );
  }, [visiblePartIds, score]);

  // Prepare the native host for a play and silence the browser voices it owns.
  // In web mode (default) the host is skipped so every part plays in the browser;
  // in native mode all VST and pitched SF2 parts are hosted while the browser
  // engine keeps driving the playhead/metronome. On the web no transport is
  // injected, so every part stays on SoundFont (§3.8).
  const prepareNativeHost = useCallback(async () => {
    const vstTransport = vstTransportRef.current;
    const nativeMode = audioRenderModeRef.current === "native";
    if (vstTransport && score && nativeMode) {
      const plan: VstPreparePlan = {
        vstParts: vstAssignmentsRef.current,
        sf2Parts: sf2AssignmentsRef.current,
      };
      vstOwnedPartsRef.current = await prepareVstOwnedParts(vstTransport, score, plan);
      applyViewPartFilter();
      // The host resets its mute set on release/reload, so re-apply the current
      // mixer mute/solo state now that this play's slots are loaded.
      void vstTransport.setMutedParts(vstMutedPartsRef.current);
      // Sync each owned part's current fader level to its native slot so the
      // initial mix reflects saved mixer state, not just later live drags.
      for (const partIndex of vstOwnedPartsRef.current) {
        const gain = mixerVolumeRef.current.get(partIndex);
        if (gain !== undefined) void vstTransport.setPartGain(partIndex, gain);
      }
    } else if (vstOwnedPartsRef.current.size > 0) {
      // Left native mode (or nothing to host): un-silence every browser voice.
      vstOwnedPartsRef.current = new Set<number>();
      applyViewPartFilter();
    }
  }, [score, applyViewPartFilter]);

  const pause = useCallback(() => {
    engineRef.current?.pause();
    void vstTransportRef.current?.stop();
    dispatchPlayback({ type: "PAUSE" });
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    void vstTransportRef.current?.stop();
    disposeAllSamplers();
    dispatchPlayback({ type: "STOP" });
  }, [disposeAllSamplers]);

  const seek = useCallback((seconds: number) => {
    // Publish the requested position first. PlaybackEngine emits the precise
    // measure/beat synchronously when available, and that resolved update must
    // come after—not be overwritten by—the optimistic one.
    dispatchPlayback({ type: "SEEK", seconds });
    engineRef.current?.seek(seconds);
    void vstTransportRef.current?.seek(seconds);
  }, []);

  const setTempo = useCallback((bpm: number) => {
    engineRef.current?.setTempo(bpm);
    dispatchPlayback({ type: "SET_TEMPO", bpm });
  }, []);

  const setVolume = useCallback((volume: number) => {
    dispatchPlayback({ type: "SET_VOLUME", volume });
  }, []);

  const toggleMetronome = useCallback(() => {
    dispatchPlayback({ type: "TOGGLE_METRONOME" });
    if (metronomeRef.current) {
      metronomeRef.current.setEnabled(!metronomeRef.current.isEnabled());
    }
  }, []);

  /** Number of count-in beats = one bar of the first measure (default 4). */
  const countInBeatsForScore = useCallback((): number => {
    const ts = clickSourceRef.current?.measureTimeSignatures[0];
    return ts ? (ts.count * 4) / ts.unit : 4;
  }, []);

  /** Rebuild the click track from the cached tempo/meter source (honoring the
   *  count-in toggle) and push it to the engine. */
  const applyClickTrack = useCallback(() => {
    const src = clickSourceRef.current;
    if (!src) return;
    const countInBeats = countInEnabledRef.current ? countInBeatsForScore() : 0;
    clickTrackRef.current = buildClickTrack(src, { countInBeats });
    engineRef.current?.setClickTrack(clickTrackRef.current);
  }, [countInBeatsForScore]);

  const toggleCountIn = useCallback(() => {
    dispatchPlayback({ type: "TOGGLE_COUNT_IN" });
    countInEnabledRef.current = !countInEnabledRef.current;
    applyClickTrack();
  }, [applyClickTrack]);

  const setLoop = useCallback((start: number, end: number) => {
    dispatchPlayback({ type: "SET_LOOP", start, end });
  }, []);

  const clearLoop = useCallback(() => {
    dispatchPlayback({ type: "CLEAR_LOOP" });
  }, []);

  const applyMix = useCallback(
    (partIndex: number, volume: number, pan: number, muted: boolean, stageDepthEnabled: boolean) => {
      const effectiveVolume = muted ? 0 : volume;
      // Store mixer volume + pan unconditionally (even before samplers exist)
      // so the values survive across view switches and sampler rebuilds. The
      // initial applyPartLevel pass in createSamplersForScore then applies them
      // when the samplers are (re)built — which is what makes mute/solo honored
      // when playback is started from any view, not just the mixer page.
      mixerVolumeRef.current.set(partIndex, effectiveVolume);
      mixerPanRef.current.set(partIndex, pan);
      stageDepthEnabledRef.current.set(partIndex, stageDepthEnabled);
      // In native mode this part may be voiced by the native mixer; push its gain
      // live so a fader drag is immediately audible. A no-op for unowned parts.
      if (audioRenderModeRef.current === "native") {
        void vstTransportRef.current?.setPartGain(partIndex, effectiveVolume);
      }
      const sampler = samplersRef.current.get(partIndex);
      if (!sampler) return;
      // Combined level/pan are applied via applyPartLevel so spatial proximity
      // and pan-compensation are stacked on top of mixer state in one place.
      const section = partSectionRef.current.get(partIndex);
      if (section) applySectionLevels(section, levelRefs);
      else applyPartLevel(partIndex, levelRefs);
      void sampler;
    },
    [levelRefs],
  );

  const setVstMutedParts = useCallback((mutedParts: ReadonlySet<number>) => {
    vstMutedPartsRef.current = mutedParts;
    void vstTransportRef.current?.setMutedParts(mutedParts);
  }, []);

  const setEnsembleLayer = useCallback((partIndex: number, enabled: boolean) => {
    const sampler = samplersRef.current.get(partIndex);
    if (sampler && "setLayerEnabled" in sampler) {
      const controls = sampler as { setLayerEnabled(index: number, enabled: boolean): void };
      controls.setLayerEnabled(0, enabled);
      controls.setLayerEnabled(1, enabled); // String Ensemble 2 (no-op if layer doesn't exist)
    }
  }, []);

  const setAirEQGain = useCallback((gainDb: number) => {
    const eq = airEQRef.current;
    if (eq) eq.gain.setValueAtTime(gainDb, eq.context.currentTime);
  }, []);

  const setLimiterThreshold = useCallback((thresholdDb: number) => {
    const lim = limiterRef.current;
    if (lim) lim.threshold.setValueAtTime(thresholdDb, lim.context.currentTime);
  }, []);

  const setLimiterRatio = useCallback((ratio: number) => {
    const lim = limiterRef.current;
    if (lim) lim.ratio.setValueAtTime(ratio, lim.context.currentTime);
  }, []);

  const applyLayerPan = useCallback((partIndex: number, layerIndex: number, pan: number) => {
    const sampler = samplersRef.current.get(partIndex);
    if (sampler && "setLayerPan" in sampler) {
      (sampler as { setLayerPan(index: number, pan: number): void }).setLayerPan(layerIndex, pan);
    }
  }, []);

  /**
   * Scale a part's reverb send gain based on distance from the listener.
   * Closer instruments sound drier (intimate/present); farther instruments
   * sound wetter (enveloped by the hall). Range spans ~25 dB so the
   * dry/wet contrast across the stage is musically obvious. Ramped to
   * avoid zipper noise when the listener moves.
   */
  const updateReverbSend = useCallback((partIndex: number, partX: number, partY: number) => {
    const send = reverbSendsRef.current.get(partIndex);
    if (!send) return;
    const lx = listenerPosRef.current.x;
    const ly = listenerPosRef.current.y;
    const dist = Math.sqrt((partX - lx) ** 2 + (partY - ly) ** 2);
    // Orchestral range: ~0m (right at the listener) to ~14m (back of stage)
    const MIN_SEND = 0.05;
    const MAX_SEND = 0.9;
    const MAX_DIST = 14;
    const t = Math.min(dist / MAX_DIST, 1);
    const target = MIN_SEND + t * (MAX_SEND - MIN_SEND);
    const ctx = audioCtxRef.current;
    if (ctx) {
      send.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
    } else {
      send.gain.value = target;
    }
  }, []);

  const applySpatialPosition = useCallback(
    (partIndex: number, x: number, y: number) => {
      const node = spatialNodesRef.current.get(partIndex);
      if (node) node.setPosition(x, y);
      updateReverbSend(partIndex, x, y);
      const section = partSectionRef.current.get(partIndex);
      if (section) applySectionLevels(section, levelRefs);
      else applyPartLevel(partIndex, levelRefs);
    },
    [updateReverbSend, levelRefs],
  );

  const applySpatialListener = useCallback(
    (x: number, y: number) => {
      const ctx = audioCtxRef.current;
      if (ctx) setSpatialListener(ctx, x, y);
      listenerPosRef.current = { x, y };
      // Section-level reverb sends still track the centroid (these are coarse
      // by design). The dry section gain is normalized separately against its
      // loudest current member.
      for (const [section, entry] of sectionSynthsRef.current) {
        const dx = entry.position.x - x;
        const dy = entry.position.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (entry.reverbSend) {
          const target = Math.max(0.05, Math.min(0.9, 0.05 + dist * 0.075));
          entry.reverbSend.gain.setTargetAtTime(target, ctx?.currentTime ?? 0, 0.05);
        }
        if (entry.predelay) {
          // 3 ms/m, capped at 40 ms. Front desks: ~0 ms (in your face);
          // back of stage at 12-14 m: ~36-40 ms (sits behind the room).
          const target = Math.min(0.04, dist * 0.003);
          entry.predelay.delayTime.setTargetAtTime(target, ctx?.currentTime ?? 0, 0.05);
        }
        recomputeSectionGain(section, levelRefs);
      }
      // Recompute per-part reverb send + combined level/pan now that the
      // listener has moved.
      for (const [i, node] of spatialNodesRef.current) {
        const pos = node.getPosition();
        updateReverbSend(i, pos.x, pos.y);
        applyPartLevel(i, levelRefs);
      }
    },
    [updateReverbSend, levelRefs],
  );

  const setReverbPreset = useCallback(async (presetId: string) => {
    const reverb = reverbEngineRef.current;
    if (!reverb) return;
    const preset = REVERB_PRESETS.find((p: ReverbPreset) => p.id === presetId);
    if (preset) await reverb.loadPreset(preset);
  }, []);

  const setReverbWet = useCallback((level: number) => {
    reverbEngineRef.current?.setWetLevel(level);
  }, []);

  // Convert an authored score position to its performed timeline position.
  const measureBeatToSeconds = useCallback((measureIndex: number, beat: number): number | null => {
    const tl = scoreTimelinePositionRef.current;
    return tl ? sourceMeasureBeatToSeconds(tl, measureIndex, beat) : null;
  }, []);

  // Native mode: preview through the same host that drives playback, so a
  // click-to-hear sounds exactly like Play (correct VST/SF2 voice + shared
  // reverb). Lazily load the host on the first click (that first click stalls);
  // once loaded, later previews are instant. Returns true when the host voiced
  // the note, false when the caller should fall back to the browser sampler.
  const tryNativePreview = useCallback(
    async (midiNote: number, partIndex: number | undefined, velocity: number, durationMs: number): Promise<boolean> => {
      if (audioRenderModeRef.current !== "native" || partIndex === undefined || !vstTransportRef.current || !score) {
        return false;
      }
      try {
        await prepareNativeHost();
        return await vstTransportRef.current.previewNote(partIndex, midiNote, velocity, durationMs);
      } catch (err) {
        console.warn("[Audio] Native preview failed, falling back to SF2:", err);
        return false;
      }
    },
    [score, prepareNativeHost],
  );

  // Note preview using active samplers — auto-initializes on first call
  const previewInitializingRef = useRef(false);
  const previewNote = useCallback(
    async (midiNote: number, partIndex?: number, velocity = 80, durationMs = 400, altKitProgram?: number) => {
      if (await tryNativePreview(midiNote, partIndex, velocity, durationMs)) return;

      // If samplers exist, play immediately
      let sampler =
        (partIndex !== undefined ? samplersRef.current.get(partIndex) : undefined) ??
        (samplersRef.current.values().next().value as ISampler | undefined);

      if (!sampler && !previewInitializingRef.current && score && timelineRef.current) {
        // Auto-initialize audio engine + samplers on first preview attempt
        previewInitializingRef.current = true;
        try {
          ensureEngine();
          const ctx = audioCtxRef.current;
          if (ctx) {
            if (ctx.state === "suspended") await ctx.resume();
            const bus = mixBusRef.current!;
            const result = await createSamplersForScore(score.parts, ctx, bus, timelineRef.current);
            samplersRef.current = result.samplers;
            routingSamplersRef.current = result.routingSamplers;
            samplerPartSignatureRef.current = samplerSignature(score, timelineRef.current);
            dispatchPlayback({ type: "SET_PART_PATCHES", patches: result.patches });
            for (const [, s] of samplersRef.current) {
              if ("setVolume" in s) (s as { setVolume(v: number): void }).setVolume(0.9);
            }
            // Now try again
            sampler =
              (partIndex !== undefined ? samplersRef.current.get(partIndex) : undefined) ??
              (samplersRef.current.values().next().value as ISampler | undefined);
          }
        } catch (err) {
          console.warn("[Audio] Preview init failed:", err);
        } finally {
          previewInitializingRef.current = false;
        }
      }

      if (sampler) {
        // The AudioContext may have suspended while the user wasn't interacting
        // (browser autoplay policy / tab-switching). Resume it so noteOn isn't
        // silently swallowed by the audio worklet.
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch {
            /* ignore */
          }
        }
        if (ctx) {
          const now = ctx.currentTime;
          sampler.noteOn(midiNote, velocity, now, altKitProgram);
          sampler.noteOff(midiNote, now + durationMs / 1000, altKitProgram);
        } else {
          sampler.noteOn(midiNote, velocity, undefined, altKitProgram);
          setTimeout(() => sampler!.noteOff(midiNote, undefined, altKitProgram), durationMs);
        }
      }
    },
    [score, ensureEngine, createSamplersForScore, tryNativePreview],
  );

  // --- play() defined here (after createSamplersForScore) ---
  const play = useCallback(
    async (fromSeconds?: number) => {
      // Re-entrancy guard: ignore overlapping start requests (rapid Play clicks
      // or Space presses) while a previous play() is still preparing, or while
      // the transport is already playing. A resume from pause (getState() ===
      // "paused") and an explicit repositioned restart (fromSeconds provided)
      // are still allowed through.
      if (playStartInFlightRef.current) return;
      if (fromSeconds === undefined && engineRef.current?.getState() === "playing") return;
      playStartInFlightRef.current = true;
      try {
        const engine = ensureEngine();
        const ctx = audioCtxRef.current!;
        const bus = mixBusRef.current!;

        // Resume AudioContext (browser requires user gesture)
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        // If samplers haven't been built yet (or were cleared), build them now
        if (samplersRef.current.size === 0 && score && timelineRef.current) {
          // Show loading state while building samplers
          dispatchPlayback({ type: "SET_STATUS", status: "loading" });

          try {
            const { samplers, routingSamplers, patches } = await createSamplersForScore(
              score.parts,
              ctx,
              bus,
              timelineRef.current,
            );
            samplersRef.current = samplers;
            routingSamplersRef.current = routingSamplers;
            samplerPartSignatureRef.current = samplerSignature(score, timelineRef.current);
            engine.loadTimeline(timelineRef.current, routingSamplers);
            engine.setPlayheadResolver(playheadResolverRef.current);
            engine.setClickTrack(clickTrackRef.current);
            dispatchPlayback({ type: "SET_PART_PATCHES", patches });

            // createSamplersForScore already ran an initial applyPartLevel pass
            // for every part, which applies the current mixer volume/mute stored
            // in mixerVolumeRef (see applyMix). We must NOT clobber that with a
            // flat 0.9 here, or mute/solo set from any non-mixer view would be
            // silently reset on the sampler rebuild that play() performs.
          } catch (err) {
            console.error("Failed to build samplers:", err);
            toast.error("Audio engine failed to start", {
              description: err instanceof Error ? err.message : String(err),
            });
            dispatchPlayback({ type: "STOP" });
            return;
          }
        }

        // Ensure timeline is loaded into the engine (may have been skipped if
        // samplers were pre-built by previewNote auto-init)
        if (timelineRef.current && !engine.getTimeline()) {
          engine.loadTimeline(timelineRef.current, routingSamplersRef.current);
          engine.setPlayheadResolver(playheadResolverRef.current);
          engine.setClickTrack(clickTrackRef.current);
        }

        // Prepare the native host (native mode) or clear ownership (web mode),
        // then start both players from the same origin.
        const vstTransport = vstTransportRef.current;
        // Capture the VST origin before the transport starts (a resume without an
        // explicit position starts from the engine's paused score-time, never the
        // negative count-in lead, which is a metronome-only affordance).
        const vstOrigin = fromSeconds ?? engine.getScoreTimeSeconds();
        await prepareNativeHost();

        // Count-in: when enabled and starting fresh from the top (not resuming a
        // pause), begin the transport before score time 0 so the prepended
        // (negative-time) count-in clicks play into the downbeat.
        const startAt = fromSeconds ?? 0;
        const freshFromTop = engine.getState() === "stopped" && startAt <= 1e-6;
        if (countInEnabledRef.current && clickSourceRef.current && freshFromTop) {
          const lead = countInLeadSeconds(clickSourceRef.current, countInBeatsForScore());
          engine.play(-lead);
        } else {
          engine.play(fromSeconds);
        }
        if (vstTransport && vstOwnedPartsRef.current.size > 0) {
          void vstTransport.start(vstOrigin);
        }
        dispatchPlayback({ type: "PLAY" });
      } catch (err) {
        console.error("Failed to start playback:", err);
        toast.error("Audio engine failed to start", {
          description: err instanceof Error ? err.message : String(err),
        });
        dispatchPlayback({ type: "STOP" });
      } finally {
        playStartInFlightRef.current = false;
      }
    },
    [ensureEngine, score, createSamplersForScore, countInBeatsForScore, prepareNativeHost],
  );

  // --- Score change → regenerate timeline only ---
  // Samplers are created lazily in play() to ensure AudioContext is from user gesture.
  useEffect(() => {
    if (!score) return;

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      try {
        const partPrograms = resolvePartSounds(score.parts, score.soundProfile, soundProfileRegistryRef.current).map(
          (resolved) => requireSf2Sound(resolved.part.name, resolved.sf2).primary.program,
        );
        const midiTimeline = generateTimeline(score, { partPrograms });
        const timeline: EngineMidiTimeline = {
          events: midiTimeline.events,
          duration: midiTimeline.duration,
          tempoMap: midiTimeline.tempoMap.map((e) => ({
            measureIndex: e.measureIndex,
            beat: e.beatInMeasure,
            time: e.timeSeconds,
            bpm: e.bpm,
          })),
          measureStartTimes: midiTimeline.measureStartTimes,
        };
        timelineRef.current = timeline;
        scoreTimelinePositionRef.current = midiTimeline;

        playheadResolverRef.current = createPlayheadResolver(midiTimeline);
        engineRef.current?.setPlayheadResolver(playheadResolverRef.current);

        // Pre-schedule the metronome click track from the same tempo model.
        // Cache the tempo/meter source so the count-in can rebuild it without a
        // full timeline regen.
        clickSourceRef.current = {
          model: midiTimeline.model,
          measureStartBeats: midiTimeline.measureStartBeats,
          measureTimeSignatures: midiTimeline.measureTimeSignatures,
        };
        applyClickTrack();

        dispatchPlayback({ type: "SET_DURATION", duration: timeline.duration });
        if (timeline.tempoMap.length > 0) {
          dispatchPlayback({ type: "SET_SCORE_TEMPO", tempo: timeline.tempoMap[0]!.bpm });
        }

        // Only dispose samplers when the instrument list actually changes.
        // Note edits within the same part list reuse existing SF2 synths so
        // note preview keeps working across edits.
        const newSignature = samplerSignature(score, timeline);
        const routingChanged = samplerPartSignatureRef.current !== newSignature;
        if (routingChanged) {
          disposeAllSamplers();
          samplerPartSignatureRef.current = null;
        }
        engineRef.current?.loadTimeline(timeline, routingChanged ? new Map() : routingSamplersRef.current);
      } catch (err) {
        console.warn("Failed to generate playback timeline:", err);
        dispatchPlayback({ type: "STOP" });
      }
    }, SCORE_CHANGE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [score, disposeAllSamplers, applyClickTrack]);

  // --- Sync view-based part filter to the engine ---
  useEffect(() => {
    applyViewPartFilter();
  }, [applyViewPartFilter]);

  // --- Memoized context values ---

  const actionsValue = useMemo<PlaybackActions>(
    () => ({
      play,
      pause,
      stop,
      seek,
      setTempo,
      setVolume,
      toggleMetronome,
      toggleCountIn,
      setLoop,
      clearLoop,
      applyMix,
      setVstMutedParts,
      applySpatialPosition,
      applySpatialListener,
      setReverbPreset,
      setReverbWet,
      previewNote,
      previewPercussion,
      measureBeatToSeconds,
      setEnsembleLayer,
      setAirEQGain,
      setLimiterThreshold,
      setLimiterRatio,
      applyLayerPan,
    }),
    [
      play,
      pause,
      stop,
      seek,
      setTempo,
      setVolume,
      toggleMetronome,
      toggleCountIn,
      setLoop,
      clearLoop,
      applyMix,
      setVstMutedParts,
      applySpatialPosition,
      applySpatialListener,
      setReverbPreset,
      setReverbWet,
      previewNote,
      previewPercussion,
      measureBeatToSeconds,
      setEnsembleLayer,
      setAirEQGain,
      setLimiterThreshold,
      setLimiterRatio,
      applyLayerPan,
    ],
  );

  // Publish the latest action closures into the zustand store so consumers
  // (TransportBar, MixerPanel, ...) see live engine-bound actions.
  useEffect(() => {
    setPlaybackActions(actionsValue);
  }, [actionsValue]);

  return <>{children}</>;
}
