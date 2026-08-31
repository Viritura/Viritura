/**
 * DocumentStore — Zustand-based document store.
 *
 * Replaces React Context for score state to enable selector-based subscriptions.
 * Components subscribe to only the slices they need via useDocumentStore(selector),
 * preventing the 2000+ component re-render cascade that Context causes.
 */

import { createStore } from "zustand";
import type { Score, ScorePatch } from "@viritura/core";
import { applyPatchesToScore, patchAffectedMeasures } from "@viritura/core";
import { parseMnx, serializeMnx, DeltaSerializer } from "@viritura/format";
import { repairBeatCounts, type MeasureBeatInfo } from "../commands/measureValidation";
import { enrichInstrumentIdentities } from "../score/InstrumentCatalog";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { produce } from "../score/scoreClone";
import { LayoutCoalescer } from "./layoutCoalescer";
import { useNoteInputStore, type CursorPosition } from "./noteInputStore";

export interface DocumentStoreState {
  // ── State ──
  score: Score | null;
  /** Latest command model. Updated synchronously without changing `score`, so
   * rapid commands compose correctly while React panels wait for paint. */
  workingScore: Score | null;
  mnxJson: string;
  dirty: boolean;
  fileName: string;
  /** Increments only when the open document changes, never for ordinary edits. */
  documentGeneration: number;
  beatCountIssues: MeasureBeatInfo[];
  /** Note-input cursor captured synchronously before the latest user edit. */
  lastEditCursorBefore: CursorPosition | null;
  /**
   * Patches that produced the most recent `score`/`mnxJson` transition,
   * or `[]` for any state change that didn't go through the patch pipeline
   * (initial load, repair, paste-replace, etc.). The live-mode Y.Doc
   * bridge subscriber reads this to choose between the fast adapter
   * (`applyPatches`) and the schema-blind path (`setMnxJson`).
   */
  lastCommittedPatches: readonly ScorePatch[];

  // ── Actions ──
  loadScoreFromUrl: (url: string) => Promise<void>;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  updateScore: (
    score: Score,
    affectedMeasures?: { start: number; end: number },
    /**
     * If this update was produced by `applyPatchesToScore(prevScore, patches)`,
     * pass the same `patches` through. The live-mode subscriber consumes it
     * via `lastCommittedPatches` to drive the fast Y.Doc adapter. Omit for
     * non-patch transitions (load, repair, etc.); `lastCommittedPatches`
     * resets to `[]` in that case.
     */
    patches?: readonly ScorePatch[],
  ) => void;
  /**
   * Patch-IR dispatch path. Apply `patches` to the current score via the
   * Immer interpreter, broadcast them on the patch bus (so the live-mode
   * Y.Doc bridge can mirror them), and update store state. No-op when
   * `patches` is empty or there's no current score.
   *
   * This is the future-facing API for commands. Today only the `changePitch`
   * pilot routes through here; other commands still call `updateScore`
   * directly with a freshly cloned Score.
   */
  commitPatches: (patches: readonly ScorePatch[], affectedMeasures?: { start: number; end: number }) => void;
  /**
   * Whole-document replace path used to accept an MCP `preview.propose_mnx`
   * proposal. Parses and validates `mnxJson` through `parseMnx` (which throws
   * on schema violations), then routes the fresh score through `updateScore`
   * with no patch list — forcing a full structural relayout and marking the
   * document dirty. Throws if the document fails validation; callers keep the
   * propose/approve gate by only invoking this on human approval.
   */
  commitDocument: (mnxJson: string) => void;
  newScore: () => void;
  repairMeasures: () => void;
  dismissBeatCountWarnings: () => void;
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;

export function createDocumentStore() {
  const deltaSerializer = new DeltaSerializer();
  let publishSequence = 0;

  // Drop-stale / latest-wins layout coalescer: keeps at most one layout
  // in-flight + one pending on the single layout worker, so a fast-typed burst
  // settles in ~2 computes instead of N serial ones. `buildPatch` extracts the
  // *latest* content for the unioned changed-measure set, so coalescing is
  // byte-identical to firing every edit (see layoutCoalescer.ts).
  const coalescer = new LayoutCoalescer(
    (global, part, timeSignatureSettings) => deltaSerializer.buildPatch(global, part, timeSignatureSettings),
    (json, patchInfo) => getGlobalPerfTracker().fastLayoutCallback?.(json, patchInfo),
  );

  return createStore<DocumentStoreState>((set, get) => ({
    // ── Initial state ──
    score: null,
    workingScore: null,
    mnxJson: "",
    dirty: false,
    fileName: "",
    documentGeneration: 0,
    beatCountIssues: [],
    lastEditCursorBefore: null,
    lastCommittedPatches: [],

    // ── Actions ──
    loadScoreFromUrl: async (url: string) => {
      publishSequence += 1;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load MNX file: ${response.status} ${response.statusText}`);
      }
      const jsonText = await response.text();
      const parsed = parseMnx(JSON.parse(jsonText));
      // Normalise on import so the very first edit doesn't trigger a flood of
      // "many changes across N parts" diffs from auto-repair (creating new
      // rest IDs to fix overfull/underfull measures). See loadScore().
      repairBeatCounts(parsed);
      // Backfill instrument identity from the catalog so audio playback
      // doesn't have to fall back to fuzzy name matching.
      enrichInstrumentIdentities(parsed);
      const json = JSON.stringify(serializeMnx(parsed));
      // Prime the delta serializer so the first edit yields a real incremental
      // diff (see loadScore for the full rationale).
      deltaSerializer.invalidate();
      deltaSerializer.serialize(parsed);
      set({
        score: parsed,
        workingScore: parsed,
        mnxJson: json,
        dirty: false,
        fileName: url,
        documentGeneration: get().documentGeneration + 1,
        beatCountIssues: [],
        lastCommittedPatches: [],
      });
      // A new document supersedes any in-flight/pending coalesced layout.
      coalescer.reset();
    },

    loadScore: (newScore: Score, name?: string, preSerializedJson?: string) => {
      publishSequence += 1;
      // Auto-repair on load so subsequent edits don't surface a spurious
      // "27 changes across 22 parts" history entry the moment a user touches
      // anything. `updateScore` runs `repairBeatCounts` after every edit, and
      // any new rest events it inserts get fresh IDs from `generateEventId()`
      // — those IDs differ from whatever the source MNX (or our parser's
      // deterministic `auto-N` scheme) used for the original events, which
      // makes the semantic-diff engine count every truncated/padded measure
      // as a discrete change. By repairing once on load, the stored mnxJson
      // is already in the post-repair shape, so the first user edit yields a
      // diff that contains only the user's actual change.
      const repairs = repairBeatCounts(newScore);
      // Backfill instrument identity from the catalog (idempotent — parts
      // that already have `_x.viritura.instrumentId` are left alone).
      const enriched = enrichInstrumentIdentities(newScore);
      // If repairs or enrichment happened, the caller's preSerializedJson is stale.
      const json =
        repairs > 0 || enriched > 0 || !preSerializedJson ? JSON.stringify(serializeMnx(newScore)) : preSerializedJson;
      // Prime the delta serializer's per-measure/structural caches against the
      // loaded score so the FIRST edit produces a real incremental diff. Without
      // this, the first `serialize()` sees cold caches and reports EVERY measure
      // + structural field as changed → `structuralChange: true` → a full layout
      // on the first keystroke (which also reseeds the engine's patch state).
      deltaSerializer.invalidate();
      deltaSerializer.serialize(newScore);

      const perf = getGlobalPerfTracker();
      if (perf.fastLayoutCallback) {
        // A new document supersedes any in-flight/pending coalesced layout;
        // reset, then fire its full layout through the coalescer so a fast
        // first edit during a slow cold load still coalesces behind it.
        coalescer.reset();
        coalescer.submit({
          json,
          changedGlobalMeasures: [],
          changedPartMeasures: new Map(),
          structuralChange: true,
          timeSignatureSettingsChange: false,
        });
      }

      set({
        score: newScore,
        workingScore: newScore,
        mnxJson: json,
        dirty: false,
        fileName: name ?? "",
        documentGeneration: get().documentGeneration + 1,
        beatCountIssues: [],
        lastCommittedPatches: [],
      });
    },

    updateScore: (
      newScore: Score,
      affectedMeasures?: { start: number; end: number },
      patches?: readonly ScorePatch[],
    ) => {
      const perf = getGlobalPerfTracker();
      const sequence = ++publishSequence;
      const cursorBeforeEdit = useNoteInputStore.getState().cursorPosition;
      // Commands submitted while the worker is busy must compose against this
      // latest model, but changing only `workingScore` does not invalidate the
      // React-visible `score` selector tree.
      set({ workingScore: newScore });
      perf.markEditStart();
      performance.mark("viritura:edit-start");
      try {
        const m = performance.measure("viritura:command-processing", "viritura:input-event", "viritura:edit-start");
        perf.commandProcessingMs = m.duration;
      } catch {
        /* no input-event mark for programmatic calls */
      }

      const repairT0 = performance.now();
      // Scope the per-edit beat-count repair to the touched measure range.
      // Most call sites pass `affectedMeasures` directly; for the rest, fall
      // back to the range derived from the patch list so we don't silently
      // run an O(score) repair scan after every edit on a long score.
      const repairRange = affectedMeasures ?? (patches ? (patchAffectedMeasures(patches) ?? undefined) : undefined);
      repairBeatCounts(newScore, repairRange);
      const repairMs = performance.now() - repairT0;
      if (repairMs > 0.5) {
        console.debug(`[Viritura] Beat count repair: ${repairMs.toFixed(1)}ms`);
      }

      performance.mark("viritura:serialize-start");
      const t0 = performance.now();
      const result = deltaSerializer.prepare(newScore);
      let json: string | null = null;
      const publishedJson = (): string => (json ??= deltaSerializer.assemble(newScore));
      // A patch failure may resolve after a newer edit has updated the mutable
      // delta caches. Build fallback directly from this edit's immutable score
      // snapshot so recovery can never mix generations.
      const fallbackJson = (): string => JSON.stringify(serializeMnx(newScore));
      perf.serializeMs = performance.now() - t0;
      performance.mark("viritura:serialize-end");
      performance.measure("viritura:serialize", "viritura:serialize-start", "viritura:serialize-end");

      let layoutDone: Promise<void> | null = null;
      if (perf.fastLayoutCallback) {
        const hasMeasureChanges = result.changedGlobalMeasures.length > 0 || result.changedPartMeasures.size > 0;
        const patchEligible = !result.structuralChange && (hasMeasureChanges || result.timeSignatureSettingsChange);
        // Coalesce onto the single layout worker: fire now if idle, else fold
        // into the pending request (latest JSON wins, changed measures unioned).
        // The coalescer rebuilds the patch from the latest serializer cache at
        // fire time, so dropping an intermediate edit's layout never drops its
        // content (see layoutCoalescer.ts).
        layoutDone = coalescer.submit({
          json: patchEligible ? "" : publishedJson(),
          fallbackJson: patchEligible ? fallbackJson : undefined,
          changedGlobalMeasures: result.changedGlobalMeasures,
          changedPartMeasures: result.changedPartMeasures,
          structuralChange: result.structuralChange,
          timeSignatureSettingsChange: result.timeSignatureSettingsChange,
        });
      }
      const publish = (): void => {
        // Latest-wins: an older layout completion cannot publish an
        // intermediate React tree after a newer command was submitted.
        if (sequence !== publishSequence) return;
        // Successful patch layout never consumes the full document. Assemble
        // it only after authoritative paint, immediately before publication.
        const jsonForPublication = publishedJson();
        set({
          score: newScore,
          workingScore: newScore,
          mnxJson: jsonForPublication,
          dirty: true,
          lastEditCursorBefore: cursorBeforeEdit,
          lastCommittedPatches: patches ?? [],
        });
        performance.mark("viritura:setState-done");
        try {
          performance.measure("viritura:updateScore", "viritura:edit-start", "viritura:setState-done");
        } catch {
          /* */
        }
      };
      if (layoutDone) void layoutDone.then(publish);
      else publish();
    },

    commitPatches: (patches, affectedMeasures) => {
      if (patches.length === 0) return;
      const score = get().workingScore;
      if (!score) return;

      const newScore = applyPatchesToScore(score, patches);
      get().updateScore(newScore, affectedMeasures, patches);
    },

    commitDocument: (mnxJson: string) => {
      // parseMnx runs the schema assertion and throws on any violation, so an
      // invalid document can never reach updateScore. enrichInstrumentIdentities
      // mirrors loadScore (idempotent). No patch list → full structural relayout.
      const parsed = parseMnx(JSON.parse(mnxJson) as unknown);
      enrichInstrumentIdentities(parsed);
      get().updateScore(parsed);
    },

    repairMeasures: () => {
      const score = get().workingScore;
      if (!score) return;
      const newScoreCopy = produce(score, (draft: Score) => {
        repairBeatCounts(draft);
      });
      if (newScoreCopy !== score) {
        const json = JSON.stringify(serializeMnx(newScoreCopy));
        set({
          score: newScoreCopy,
          workingScore: newScoreCopy,
          mnxJson: json,
          dirty: true,
          lastCommittedPatches: [],
        });
      }
      set({ beatCountIssues: [] });
    },

    dismissBeatCountWarnings: () => {
      set({ beatCountIssues: [] });
    },

    newScore: () => {
      publishSequence += 1;
      deltaSerializer.invalidate();
      set({
        score: null,
        workingScore: null,
        mnxJson: "",
        dirty: false,
        fileName: "",
        documentGeneration: get().documentGeneration + 1,
        beatCountIssues: [],
        lastCommittedPatches: [],
      });
    },
  }));
}
