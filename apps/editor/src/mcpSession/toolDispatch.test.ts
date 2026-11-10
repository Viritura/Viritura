import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score, ScorePatch } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { createDocumentStore } from "../store/documentStore";
import { dispatchMcpTool } from "./toolDispatch";
import { useMcpSessionStore } from "./sessionStore";
import { clearPatchBatches } from "./patchBatches";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    metadata: { title: "MCP Test" },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "keyboard.piano",
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "event-1",
                    duration: { base: "whole" },
                    notes: [
                      { id: "note-1", pitch: { step: "C", octave: 4 } },
                      { id: "note-2", pitch: { step: "E", octave: 4 } },
                      { id: "note-3", pitch: { step: "G", octave: 4 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("MCP editor tool dispatch", () => {
  beforeEach(() => {
    useMcpSessionStore.setState(useMcpSessionStore.getInitialState());
    clearPatchBatches();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pianoLocator = { sequencePath: { partId: "keyboard.piano", measureIndex: 0, voice: 0 }, eventId: "event-1" };
  const addNote4 = {
    kind: "addNoteToEvent",
    locator: pianoLocator,
    note: { id: "note-4", pitch: { step: "B", octave: 4 } },
  };
  const pitchNote4 = { kind: "setNotePitch", locator: pianoLocator, noteId: "note-4", pitch: { step: "A", octave: 4 } };
  const pitchNote1 = { kind: "setNotePitch", locator: pianoLocator, noteId: "note-1", pitch: { step: "D", octave: 4 } };

  it.each([false, true])("combines batched patch calls into one proposal (auto-accept: %s)", async (autoAccept) => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;
    useMcpSessionStore.getState().start({ autoAccept });
    const commit = vi.spyOn(store.getState(), "commitPatches");

    const first = await dispatchMcpTool(store, "preview.propose_patches", {
      batchId: "orchestration",
      final: false,
      patches: [addNote4],
    });
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toEqual({ batchId: "orchestration", status: "batching", patchCount: 1 });
    expect(useMcpSessionStore.getState().proposals).toEqual({});
    expect(store.getState().mnxJson).toBe(before);

    // The final part targets a note that only exists after the first part.
    const last = await dispatchMcpTool(store, "preview.propose_patches", {
      batchId: "orchestration",
      final: true,
      patches: [pitchNote4, pitchNote1],
      summary: "Orchestrate passage",
    });

    expect(last.isError).not.toBe(true);
    expect(last.structuredContent).toMatchObject({
      status: autoAccept ? "accepted" : "pending",
      summary: "Orchestrate passage",
    });
    const proposals = Object.values(useMcpSessionStore.getState().proposals);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.patches).toEqual([addNote4, pitchNote4, pitchNote1]);
    expect(commit).toHaveBeenCalledTimes(autoAccept ? 1 : 0);
    if (autoAccept) {
      const notes = store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
      expect(notes).toMatchObject({
        notes: expect.arrayContaining([{ id: "note-4", pitch: { step: "A", octave: 4 } }]),
      });
    }
  });

  it("discards a batch when the score changes before it is final", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start();
    await dispatchMcpTool(store, "preview.propose_patches", { batchId: "b", final: false, patches: [addNote4] });
    store.getState().commitPatches([pitchNote1 as ScorePatch]);

    const stale = await dispatchMcpTool(store, "preview.propose_patches", { batchId: "b", patches: [pitchNote4] });

    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ code: "batch_stale" });
    expect(useMcpSessionStore.getState().proposals).toEqual({});
  });

  it("keeps earlier batch parts when a later part is invalid", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start();
    await dispatchMcpTool(store, "preview.propose_patches", { batchId: "b", final: false, patches: [addNote4] });

    const invalid = await dispatchMcpTool(store, "preview.propose_patches", {
      batchId: "b",
      final: false,
      patches: [{ ...pitchNote4, noteId: "missing" }],
    });
    expect(invalid.isError).toBe(true);

    const final = await dispatchMcpTool(store, "preview.propose_patches", { batchId: "b", patches: [pitchNote4] });
    expect(final.isError).not.toBe(true);
    expect(Object.values(useMcpSessionStore.getState().proposals)[0]!.patches).toEqual([addNote4, pitchNote4]);
  });

  it("rejects non-final calls without a batch and clears batches when the session stops", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start();

    const missingBatch = await dispatchMcpTool(store, "preview.propose_patches", { final: false, patches: [addNote4] });
    expect(missingBatch.structuredContent).toMatchObject({ code: "invalid_batch" });

    await dispatchMcpTool(store, "preview.propose_patches", { batchId: "b", final: false, patches: [addNote4] });
    useMcpSessionStore.getState().stop();
    useMcpSessionStore.getState().start();
    const orphan = await dispatchMcpTool(store, "preview.propose_patches", { batchId: "b", patches: [pitchNote4] });

    expect(orphan.isError).toBe(true);
    expect(useMcpSessionStore.getState().proposals).toEqual({});
  });

  it.each([false, true])("auto-accepts validated patches (large score: %s)", async (largeScore) => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    if (largeScore) {
      store.setState({ mnxJson: `${store.getState().mnxJson}${" ".repeat(513 * 1024)}` });
    }
    useMcpSessionStore.getState().start({ autoAccept: true });
    const commit = vi.spyOn(store.getState(), "commitPatches");

    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "setNotePitch",
          locator: { sequencePath: { partId: "keyboard.piano", measureIndex: 0, voice: 0 }, eventId: "event-1" },
          noteId: "note-1",
          pitch: { step: "D", octave: 4 },
        },
      ],
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "accepted" });
    expect(result.content[0]?.text).toContain("auto-accepted and applied");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(store.getState().mnxJson).toContain('"step":"D"');
    expect(store.getState().dirty).toBe(true);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0]!;
    const status = await dispatchMcpTool(store, "preview.get_status", { proposalId: proposal.id });
    expect(status.structuredContent).toMatchObject({ status: "accepted" });
  });

  it("auto-accepts whole-document and generated proposals through the normal document commit", async () => {
    const store = createDocumentStore();
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.stemDirection = "up";
    store.getState().loadScore(score, "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });
    const commit = vi.spyOn(store.getState(), "commitDocument");

    const reset = await dispatchMcpTool(store, "preview.reset_stem_directions", {});
    expect(reset.structuredContent).toMatchObject({ status: "accepted" });
    expect(store.getState().mnxJson).not.toContain("stemDirection");

    const proposed = JSON.parse(store.getState().mnxJson) as { global: { measures: object[] } };
    proposed.global.measures.push({});
    const replace = await dispatchMcpTool(store, "preview.propose_mnx", { mnx: proposed });

    expect(replace.structuredContent).toMatchObject({ status: "accepted" });
    expect(store.getState().workingScore?.global.measures).toHaveLength(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("keeps validation dry-runs and invalid proposals non-mutating with auto-accept enabled", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;
    useMcpSessionStore.getState().start({ autoAccept: true });

    const validation = await dispatchMcpTool(store, "score.validate", { mnx: JSON.parse(before) as unknown });
    expect(validation.structuredContent).toMatchObject({ valid: true });
    const invalid = await dispatchMcpTool(store, "preview.propose_mnx", { mnx: { invalid: true } });
    expect(invalid.isError).toBe(true);
    const invalidPatches = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [{ kind: "setNotePitch", locator: {}, noteId: "missing", pitch: { step: "D", octave: 4 } }],
    });
    expect(invalidPatches.isError).toBe(true);
    expect(store.getState().mnxJson).toBe(before);
    expect(useMcpSessionStore.getState().proposals).toEqual({});
  });

  it("reports failed auto-accept commits as errors and marks the proposal stale", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;
    useMcpSessionStore.getState().start({ autoAccept: true });
    vi.spyOn(store.getState(), "commitDocument").mockImplementation(() => {
      throw new Error("Commit failed");
    });

    const result = await dispatchMcpTool(store, "preview.propose_mnx", { mnx: JSON.parse(before) as unknown });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "tool_failed", message: "Commit failed" });
    expect(Object.values(useMcpSessionStore.getState().proposals)[0]?.status).toBe("stale");
    expect(store.getState().mnxJson).toBe(before);
  });

  it("defaults to manual approval again after disconnecting an auto-accept session", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;
    const session = useMcpSessionStore.getState();
    session.start({ autoAccept: true });
    session.setRegistering();
    expect(useMcpSessionStore.getState().autoAccept).toBe(true);
    session.stop();
    expect(useMcpSessionStore.getState().autoAccept).toBe(false);
    session.clear();
    session.start();

    const result = await dispatchMcpTool(store, "preview.propose_mnx", { mnx: JSON.parse(before) as unknown });

    expect(result.structuredContent).toMatchObject({ status: "pending" });
    expect(store.getState().mnxJson).toBe(before);
  });

  it("returns a compact overview without exposing the whole score", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "score.overview", {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ title: "MCP Test", measureCount: 1, partCount: 1 });
  });

  it("validates and stages patches without changing the live document", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;

    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      summary: "Raise middle C to D",
      patches: [
        {
          kind: "setNotePitch",
          locator: { sequencePath: { partId: "keyboard.piano", measureIndex: 0, voice: 0 }, eventId: "event-1" },
          noteId: "note-1",
          pitch: { step: "D", octave: 4 },
        },
      ],
    });

    expect(result.isError).not.toBe(true);
    expect(store.getState().mnxJson).toBe(before);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal).toMatchObject({ status: "pending", summary: "Raise middle C to D" });
    expect(proposal?.proposedMnx).toContain('"step": "D"');
  });

  it("returns an MCP tool error for a stale patch target", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "setNotePitch",
          locator: { sequencePath: { partId: "keyboard.piano", measureIndex: 0, voice: 0 }, eventId: "missing" },
          noteId: "note-1",
          pitch: { step: "D", octave: 4 },
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "tool_failed" });
  });

  it("uses bounded patch review instead of a whole-document diff for large scores", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    store.setState({ mnxJson: `${store.getState().mnxJson}${" ".repeat(513 * 1024)}` });

    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "setNotePitch",
          locator: { sequencePath: { partId: "keyboard.piano", measureIndex: 0, voice: 0 }, eventId: "event-1" },
          noteId: "note-1",
          pitch: { step: "D", octave: 4 },
        },
      ],
    });

    expect(result.isError).not.toBe(true);
    expect(Object.values(useMcpSessionStore.getState().proposals)[0]?.proposedMnx).toBeNull();
  });

  it("stages automatic stem directions for top-level and nested events", async () => {
    const score = makeScore();
    const topLevelEvent = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    topLevelEvent.duration = { base: "half" };
    topLevelEvent.stemDirection = "up";
    score.parts[0]!.measures[0]!.sequences[0]!.content.push({
      type: "tuplet",
      inner: { duration: { base: "quarter" }, multiple: 3 },
      outer: { duration: { base: "quarter" }, multiple: 2 },
      content: [
        {
          type: "event",
          id: "nested-event",
          duration: { base: "half", dots: 1 },
          stemDirection: "down",
          notes: [{ id: "nested-note", pitch: { step: "D", octave: 4 } }],
        },
      ],
    });
    const store = createDocumentStore();
    store.getState().loadScore(score, "test.mnx");

    const result = await dispatchMcpTool(store, "preview.reset_stem_directions", {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "pending" });
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal?.summary).toBe("Reset 2 note stem directions to automatic");
    expect(proposal?.document?.proposedMnx).not.toContain("stemDirection");
    expect(store.getState().workingScore?.parts[0]?.measures[0]?.sequences[0]?.content[0]).toHaveProperty(
      "stemDirection",
      "up",
    );
  });

  it("stages an orchestral Part split without mutating the live score", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeOrchestralScore(), "orchestra.mnx");
    const beforeJson = store.getState().mnxJson;
    const beforeScore = structuredClone(store.getState().workingScore);

    const result = await dispatchMcpTool(store, "preview.split_orchestral_staves", {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "pending" });
    expect(store.getState().mnxJson).toBe(beforeJson);
    expect(store.getState().workingScore).toEqual(beforeScore);
    const proposals = Object.values(useMcpSessionStore.getState().proposals);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.document?.proposedMnx).toContain('"id":"P2-1"');
    expect(proposals[0]?.document?.proposedMnx).toContain('"name":"Condensed Score"');
    expect(proposals[0]?.summary).toContain("Split combined oboe, clarinet, bassoon");
  });

  it("returns compact measure ranges instead of the complete document", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "score.get_measures", {
      startMeasure: 1,
      endMeasure: 1,
      partIds: ["keyboard.piano"],
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ startMeasure: 1, endMeasure: 1 });
    expect((result.structuredContent as { parts: unknown[] }).parts).toHaveLength(1);
  });

  it("identifies exact chords encoded in note events", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "score.analyze_chords", { startMeasure: 1, endMeasure: 1 });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      measures: [{ chordEvents: [{ analysis: { root: "C", quality: "major", symbol: "C" } }] }],
    });
  });

  it("stages high-level chord-note additions for review", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "preview.propose_chord_notes", {
      summary: "Make Cmaj7",
      changes: [
        {
          partId: "keyboard.piano",
          measure: 1,
          voice: 0,
          eventId: "event-1",
          pitches: [{ step: "B", octave: 4 }],
        },
      ],
    });

    expect(result.isError).not.toBe(true);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal?.summary).toBe("Make Cmaj7");
    expect(proposal?.patches).toMatchObject([{ kind: "addNoteToEvent", note: { pitch: { step: "B", octave: 4 } } }]);
    expect(store.getState().score?.parts[0]?.measures[0]?.sequences[0]?.content[0]?.notes).toHaveLength(3);
  });

  it("returns measure start times, tempo regions, and duration from the timeline", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(twoMeasureScore(), "timed.mnx");

    const result = await dispatchMcpTool(store, "score.get_timeline", {});

    expect(result.isError).not.toBe(true);
    const timeline = result.structuredContent as {
      measures: { measure: number; startSeconds: number }[];
      tempoChanges: { bpm: number }[];
      totalDurationSeconds: number;
    };
    // 4/4 at ♩=120 → each measure is 2 s; the second measure starts at 2 s.
    expect(timeline.measures).toHaveLength(2);
    expect(timeline.measures[1]?.startSeconds).toBeCloseTo(2, 3);
    // Measure 2 runs at ♩=60 → 4 s long, so the whole fragment is 6 s.
    expect(timeline.totalDurationSeconds).toBeCloseTo(6, 3);
    expect(timeline.tempoChanges.map((t) => t.bpm)).toEqual([120, 60]);
  });

  it("bounds the timeline payload to a measure range", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(twoMeasureScore(), "timed.mnx");

    const result = await dispatchMcpTool(store, "score.get_timeline", { startMeasure: 2, endMeasure: 2 });

    const timeline = result.structuredContent as { measures: { measure: number }[] };
    expect(timeline.measures).toHaveLength(1);
    expect(timeline.measures[0]?.measure).toBe(2);
  });

  it("dry-run validates a patch array without staging a proposal", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "score.validate", {
      patches: [
        {
          kind: "setNotePitch",
          locator: { sequencePath: { partId: "keyboard.piano", measureIndex: 0, voice: 0 }, eventId: "event-1" },
          noteId: "note-1",
          pitch: { step: "D", octave: 4 },
        },
      ],
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ valid: true, mode: "patches" });
    expect(Object.values(useMcpSessionStore.getState().proposals)).toHaveLength(0);
  });

  it("reports diagnostics for an invalid document without staging a proposal", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "score.validate", { mnx: { not: "an mnx document" } });

    expect(result.isError).not.toBe(true);
    const validation = result.structuredContent as { valid: boolean; diagnostics: string[] };
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects a validate call that supplies neither or both inputs", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");

    const result = await dispatchMcpTool(store, "score.validate", { patches: [], mnx: {} });

    expect(result.isError).toBe(true);
  });

  it("returns the persisted video-sync settings", async () => {
    const store = createDocumentStore();
    const score = makeScore();
    score.videoSync = { version: 1, pictureOffsetSeconds: 74.6, pictureAudioEnabled: true };
    store.getState().loadScore(score, "synced.mnx");

    const result = await dispatchMcpTool(store, "score.get_video_sync", {});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ videoSync: { pictureOffsetSeconds: 74.6 } });
  });

  it("flags notes outside an instrument's catalog range", async () => {
    const store = createDocumentStore();
    const score = makeScore();
    const flutePart = score.parts[0]!;
    flutePart.name = "Flute";
    flutePart._x = { viritura: { instrumentId: "wind.flutes.flute" } };
    // Flute's lowest sounding note is C4 (MIDI 60); a C3 is out of range.
    flutePart.measures[0]!.sequences[0]!.content = [
      { type: "event", id: "e1", duration: { base: "whole" }, notes: [{ id: "n1", pitch: { step: "C", octave: 3 } }] },
    ];
    store.getState().loadScore(score, "flute.mnx");

    const result = await dispatchMcpTool(store, "score.get_instruments", {});

    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as {
      outOfRangeCount: number;
      instruments: { instrumentId: string | null; outOfRange: boolean; belowRange: number }[];
    };
    expect(payload.outOfRangeCount).toBe(1);
    expect(payload.instruments[0]).toMatchObject({
      instrumentId: "wind.flutes.flute",
      outOfRange: true,
      belowRange: 1,
    });
  });

  it("stages one whole-document proposal with a structural summary", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;

    const proposedDoc = JSON.parse(before) as { global: { measures: unknown[] } };
    // Author a second bar so the diff summary shows a non-trivial delta.
    proposedDoc.global.measures.push({});

    const result = await dispatchMcpTool(store, "preview.propose_mnx", { mnx: proposedDoc });

    expect(result.isError).not.toBe(true);
    // The live document is untouched until the human approves.
    expect(store.getState().mnxJson).toBe(before);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal?.document).toBeDefined();
    const measuresMetric = proposal?.document?.diff.metrics.find((m) => m.label === "Measures");
    expect(measuresMetric).toMatchObject({ before: 1, after: 2, delta: 1 });
  });

  it("stages Tritsch instrument normalization without mutating the live score", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeTritschScore(), "tritsch.mnx");
    const before = store.getState().mnxJson;

    const result = await dispatchMcpTool(store, "preview.normalize_tritsch_instruments", {});

    expect(result.isError).not.toBe(true);
    expect(store.getState().mnxJson).toBe(before);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal).toMatchObject({
      status: "pending",
      summary: "Normalize Tritsch instruments, wind voices and stems, sound profile, and percussion routing",
    });
    const proposed = parseMnx(JSON.parse(proposal!.document!.proposedMnx) as unknown);
    expect(proposed.parts.find((part) => part.id === "P3-1")).toMatchObject({
      name: "Clarinet in B♭ 1",
      _x: { viritura: { instrumentId: "wind.reed.clarinet.bflat", midiProgram: 71, family: "woodwinds" } },
    });
    expect(proposed.soundProfile?.parts["P11"]?.sourceId).toBe("metal.cymbal.clash-primary");
    expect(proposed.global.sounds?.["snd-cymbals-49"]?.midiNumber).toBe(49);
    expect(proposed.parts.find((part) => part.id === "P2-2")?.measures[0]?.sequences[0]?.voice).toBe("v1");
  });

  it("authors a multi-tempo fragment via propose_mnx and verifies bar timing end to end", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "seed.mnx");

    // A model authors the whole fragment and stages it as one proposal.
    const proposeResult = await dispatchMcpTool(store, "preview.propose_mnx", { mnx: twoMeasureDocument() });
    expect(proposeResult.isError).not.toBe(true);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal?.document).toBeDefined();

    // The human approves: commit the validated document verbatim.
    store.getState().commitDocument(proposal!.document!.proposedMnx);

    // Now verify via the timeline that bar 2 lands where the tempo map predicts.
    const timelineResult = await dispatchMcpTool(store, "score.get_timeline", {});
    const timeline = timelineResult.structuredContent as {
      measures: { measure: number; startSeconds: number }[];
      totalDurationSeconds: number;
    };
    expect(timeline.measures[1]?.startSeconds).toBeCloseTo(2, 3);
    expect(timeline.totalDurationSeconds).toBeCloseTo(6, 3);
  });
});

/** Two 4/4 bars: bar 1 at ♩=120 (2 s), bar 2 at ♩=60 (4 s); total 6 s. */
function twoMeasureScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        { tempos: [{ bpm: 60, value: { base: "quarter" } }] },
      ],
    },
    parts: [
      {
        id: "keyboard.piano",
        name: "Piano",
        measures: [wholeNoteMeasure("m1"), wholeNoteMeasure("m2")],
      },
    ],
  };
}

function wholeNoteMeasure(prefix: string): Score["parts"][number]["measures"][number] {
  return {
    sequences: [
      {
        content: [
          {
            type: "event",
            id: `${prefix}-e`,
            duration: { base: "whole" },
            notes: [{ id: `${prefix}-n`, pitch: { step: "C", octave: 4 } }],
          },
        ],
      },
    ],
  };
}

function makeOrchestralScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      ["P2", "Oboi", 1],
      ["P3", "Clarinetti in Bb", 2],
      ["P4", "Fagotti", 2],
      ["P5", "Corni in F", 1],
      ["P6", "Trombe in Bb", 1],
      ["P7", "Tromboni", 2],
    ].map(([id, name, staves]) => ({
      id: id as string,
      name: name as string,
      staves: staves as number,
      measures: [
        {
          sequences: [
            {
              staff: 1,
              content: [
                {
                  type: "event" as const,
                  id: `${String(id)}-event`,
                  duration: { base: "whole" as const },
                  notes: [{ id: `${String(id)}-note`, pitch: { step: "C" as const, octave: 4 as const } }],
                },
              ],
            },
          ],
        },
      ],
    })),
    layouts: [
      {
        id: "full",
        content: ["P2", "P3", "P4", "P5", "P6", "P7"].map((part) => ({ type: "staff" as const, sources: [{ part }] })),
      },
    ],
  };
}

function makeTritschScore(): Score {
  const roster = [
    ["P1", "Flauto"],
    ["P2-1", "Oboe 1"],
    ["P2-2", "Oboe 2"],
    ["P3-1", "Clarinet in B♭ 1"],
    ["P3-2", "Clarinet in B♭ 2"],
    ["P4-1", "Bassoon 1"],
    ["P4-2", "Bassoon 2"],
    ["P5-1", "Horn in F 1"],
    ["P5-2", "Horn in F 2"],
    ["P6-1", "Trumpet in Bb 1"],
    ["P6-2", "Trumpet in Bb 2"],
    ["P7-1", "Trombone 1"],
    ["P7-2", "Trombone 2"],
    ["P7-3", "Trombone 3"],
    ["P8", "Timpani in E.A."],
    ["P9", "Grancassa"],
    ["P10", "Triangolo"],
    ["P11", "Piatti"],
    ["P12", "Violino I"],
    ["P13", "Violino II"],
    ["P14", "Viola"],
    ["P15", "Violoncello"],
    ["P16", "Basso"],
  ] as const;
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{}], sounds: { "snd-perc-45": { name: "Low Tom", midiNumber: 45 } } },
    parts: roster.map(([id, name]) => ({ id, name, measures: [{ sequences: [] }] })),
  };
  score.parts.find((part) => part.id === "P2-2")!.measures = [
    {
      sequences: [
        {
          voice: "v5",
          content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
        },
      ],
    },
  ];
  for (const [partId, componentId] of [
    ["P9", "P9-kit-0"],
    ["P10", "P10-kit-0"],
    ["P11", "P11-kit-0"],
  ]) {
    const part = score.parts.find((candidate) => candidate.id === partId)!;
    part.kit = { [componentId]: { name: "Low Tom", sound: "snd-perc-45", staffPosition: 0 } };
    part.measures = [
      { sequences: [{ content: [{ duration: { base: "quarter" }, kitNotes: [{ kitComponent: componentId }] }] }] },
    ];
  }
  score.parts.find((part) => part.id === "P2-1")!._x = { viritura: { instrumentId: "wind.reed.oboe" } };
  score.parts.find((part) => part.id === "P2-2")!._x = { viritura: { instrumentId: "wind.reed.oboe" } };
  for (const id of ["P5-1", "P5-2"])
    score.parts.find((part) => part.id === id)!._x = { viritura: { instrumentId: "brass.french-horn" } };
  for (const id of ["P7-1", "P7-2", "P7-3"])
    score.parts.find((part) => part.id === id)!._x = { viritura: { instrumentId: "brass.trombone" } };
  score.parts.find((part) => part.id === "P14")!._x = { viritura: { instrumentId: "strings.viola" } };
  return score;
}

/** The same two-bar fragment as a raw MNX document object for propose_mnx. */
function twoMeasureDocument(): Record<string, unknown> {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        { tempos: [{ bpm: 60, value: { base: "quarter" } }] },
      ],
    },
    parts: [
      {
        id: "wind.flutes.flute",
        name: "Flute",
        measures: [wholeNoteMeasure("f1"), wholeNoteMeasure("f2")],
      },
      {
        id: "strings.violin",
        name: "Violin",
        measures: [wholeNoteMeasure("v1"), wholeNoteMeasure("v2")],
      },
    ],
  };
}
