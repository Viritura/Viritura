import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { patch, type Score, type ScorePatch } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { createDocumentStore } from "../store/documentStore";
import { dispatchMcpTool } from "./toolDispatch";
import { useMcpSessionStore } from "./sessionStore";
import { clearPatchBatches } from "./patchBatches";
import { clearIdempotentRequests } from "./idempotentRequests";

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
    clearIdempotentRequests();
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

  it("round-trips raw MNX content and note extensions through validation and acceptance", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });
    const patches = [
      {
        kind: "setSequenceContent",
        sequencePath: pianoLocator.sequencePath,
        content: [
          {
            id: "raw-event",
            duration: { base: "whole" },
            notes: [{ id: "raw-note", pitch: { step: "D", octave: 4 }, _x: { viritura: { notehead: "diamond" } } }],
          },
        ],
      },
    ];
    const validation = await dispatchMcpTool(store, "score.validate", { patches });
    expect(validation.structuredContent).toMatchObject({ valid: true, repairs: [] });
    const result = await dispatchMcpTool(store, "preview.propose_patches", { patches });
    expect(result.structuredContent).toMatchObject({ status: "accepted" });
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      type: "event",
      notes: [{ id: "raw-note", notehead: "diamond" }],
    });
    expect(store.getState().mnxJson).toContain('"notehead":"diamond"');
  });

  it("accepts raw MNX notes and preserves valid internal notes with nested vendor data", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });
    const raw = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "addNoteToEvent",
          locator: pianoLocator,
          note: { id: "raw-note", pitch: { step: "D", octave: 4 }, _x: { viritura: { notehead: "diamond" } } },
        },
      ],
    });
    expect(raw.structuredContent).toMatchObject({ status: "accepted" });
    const internal = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "addNoteToEvent",
          locator: pianoLocator,
          note: {
            id: "model-note",
            pitch: { step: "F", octave: 4 },
            notehead: "diamond",
            markings: { _x: { anotherVendor: { retained: true } } },
          },
        },
      ],
    });
    expect(internal.structuredContent).toMatchObject({ status: "accepted" });
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      notes: expect.arrayContaining([
        expect.objectContaining({ id: "raw-note", notehead: "diamond" }),
        expect.objectContaining({ id: "model-note", markings: { _x: { anotherVendor: { retained: true } } } }),
      ]),
    });
  });

  it("accepts typed lyric dictionaries in internal sequence content", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "setSequenceContent",
          sequencePath: pianoLocator.sequencePath,
          content: [
            {
              type: "event",
              id: "sung",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: 4 }, notehead: "diamond" }],
              lyrics: { lines: { "1": { text: "Hello" }, "2": { text: "Again" } } },
            },
          ],
        },
      ],
    });
    expect(result.structuredContent).toMatchObject({ status: "pending" });
    const invalid = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "setSequenceContent",
          sequencePath: pianoLocator.sequencePath,
          content: [
            {
              type: "event",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: 4 }, notehead: "diamond" }],
              lyrics: { lines: { "1": { text: 17 } } },
            },
          ],
        },
      ],
    });
    expect(invalid.structuredContent).toMatchObject({ code: "invalid_patches" });
  });

  it("rejects unknown patch kinds and MNX fields that would be discarded", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    for (const candidate of [
      { kind: "unknownPatch" },
      {
        kind: "setSequenceContent",
        sequencePath: pianoLocator.sequencePath,
        content: [{ duration: { base: "whole" }, rest: {}, _x: { anotherVendor: { important: true } } }],
      },
    ]) {
      const result = await dispatchMcpTool(store, "preview.propose_patches", { patches: [candidate] });
      expect(result.structuredContent).toMatchObject({ code: "invalid_patches" });
    }
    expect(useMcpSessionStore.getState().proposals).toEqual({});
  });

  it("previews padding and commits the exact reviewed rest IDs", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });
    const patches = [
      {
        kind: "setSequenceContent",
        sequencePath: pianoLocator.sequencePath,
        content: [{ id: "short", duration: { base: "quarter" }, rest: {} }],
      },
    ];
    const validation = await dispatchMcpTool(store, "score.validate", { patches });
    expect(validation.structuredContent).toMatchObject({
      valid: true,
      requiresRhythmTruncationApproval: false,
      repairs: [{ action: "pad", actualBeats: 1, expectedBeats: 4, repairedBeats: 4 }],
    });
    const result = await dispatchMcpTool(store, "preview.propose_patches", { patches });
    expect(result.structuredContent).toMatchObject({ status: "accepted", repairs: [{ action: "pad" }] });
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0]!;
    expect(JSON.parse(proposal.proposedMnx!)).toEqual(JSON.parse(store.getState().mnxJson));
  });

  it("shows splice effects and requires explicit approval before truncating notes", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });
    const patches = [
      {
        kind: "spliceSequenceContent",
        sequencePath: pianoLocator.sequencePath,
        removeFromEventId: "event-1",
        removeToEventId: "event-1",
        insert: [
          { id: "kept", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
          { id: "removed", duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
        ],
      },
    ];
    const validation = await dispatchMcpTool(store, "score.validate", { patches });
    expect(validation.structuredContent).toMatchObject({
      valid: true,
      requiresRhythmTruncationApproval: true,
      repairs: [{ action: "truncate", actualBeats: 5, expectedBeats: 4, removedEventIds: ["removed"] }],
      splicePreviews: [{ before: [{ id: "event-1" }], after: [{ id: "kept" }] }],
    });
    const blocked = await dispatchMcpTool(store, "preview.propose_patches", { patches });
    expect(blocked.structuredContent).toMatchObject({ code: "rhythm_truncation_requires_confirmation" });
    expect(useMcpSessionStore.getState().proposals).toEqual({});
    const accepted = await dispatchMcpTool(store, "preview.propose_patches", { patches, allowRhythmTruncation: true });
    expect(accepted.structuredContent).toMatchObject({ status: "accepted" });
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0]!;
    expect(JSON.parse(proposal.proposedMnx!)).toEqual(JSON.parse(store.getState().mnxJson));
  });

  it("replays an accepted request without applying it twice, even after its base revision changes", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });
    const baseRevision = store.getState().scoreRevision;
    const args = { patches: [addNote4], requestId: "add-chord-note", baseRevision };
    const first = await dispatchMcpTool(store, "preview.propose_patches", args);
    const retry = await dispatchMcpTool(store, "preview.propose_patches", args);
    expect(first.structuredContent).toMatchObject({ status: "accepted" });
    expect(retry.structuredContent).toMatchObject({
      proposalId: (first.structuredContent as { proposalId: string }).proposalId,
      status: "accepted",
      replayed: true,
    });
    expect(Object.keys(useMcpSessionStore.getState().proposals)).toHaveLength(1);
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes).toHaveLength(4);
    const conflict = await dispatchMcpTool(store, "preview.propose_patches", { ...args, patches: [pitchNote1] });
    expect(conflict.structuredContent).toMatchObject({ code: "idempotency_conflict" });
  });

  it("reports the current proposal status in both replayed text and structured output", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const args = { patches: [pitchNote1], requestId: "pending-proposal" };
    const first = await dispatchMcpTool(store, "preview.propose_patches", args);
    const proposalId = (first.structuredContent as { proposalId: string }).proposalId;
    useMcpSessionStore.getState().setProposalStatus(proposalId, "rejected");
    const retry = await dispatchMcpTool(store, "preview.propose_patches", args);
    expect(retry.structuredContent).toMatchObject({ proposalId, status: "rejected", replayed: true });
    expect(retry.content[0]?.text).toContain("rejected");
    expect(retry.content[0]?.text).not.toContain("awaiting review");
  });

  it("reports revision conflicts and marks pending proposals stale", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const baseRevision = store.getState().scoreRevision;
    const proposal = await dispatchMcpTool(store, "preview.propose_patches", { patches: [pitchNote1], baseRevision });
    const proposalId = (proposal.structuredContent as { proposalId: string }).proposalId;
    store
      .getState()
      .commitPatches([patch.addNoteToEvent(pianoLocator, { id: "note-4", pitch: { step: "B", octave: 4 } })]);
    const conflict = await dispatchMcpTool(store, "preview.propose_patches", { patches: [pitchNote1], baseRevision });
    expect(conflict.structuredContent).toMatchObject({
      code: "revision_conflict",
      baseRevision,
      currentRevision: store.getState().scoreRevision,
    });
    const status = await dispatchMcpTool(store, "preview.get_status", { proposalId });
    expect(status.structuredContent).toMatchObject({ status: "stale", baseRevision });
  });

  it("makes batch chunks retry-safe and supports inspection and cancellation", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const baseRevision = store.getState().scoreRevision;
    const chunk = { batchId: "batch", patches: [addNote4], final: false, requestId: "chunk-1", baseRevision };
    expect((await dispatchMcpTool(store, "preview.propose_patches", chunk)).structuredContent).toMatchObject({
      status: "batching",
      patchCount: 1,
    });
    expect((await dispatchMcpTool(store, "preview.propose_patches", chunk)).structuredContent).toMatchObject({
      status: "batching",
      patchCount: 1,
      replayed: true,
    });
    expect((await dispatchMcpTool(store, "preview.get_batch", { batchId: "batch" })).structuredContent).toMatchObject({
      status: "batching",
      baseRevision,
      patchCount: 1,
      chunkCount: 1,
    });
    expect(
      (await dispatchMcpTool(store, "preview.cancel_batch", { batchId: "batch" })).structuredContent,
    ).toMatchObject({
      status: "cancelled",
    });
    expect((await dispatchMcpTool(store, "preview.get_batch", { batchId: "batch" })).structuredContent).toMatchObject({
      code: "batch_not_found",
    });
  });

  it("does not append a failed final chunk to the open batch", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    await dispatchMcpTool(store, "preview.propose_patches", { batchId: "batch", patches: [addNote4], final: false });
    const last = {
      kind: "spliceSequenceContent",
      sequencePath: pianoLocator.sequencePath,
      removeFromEventId: "event-1",
      removeToEventId: "event-1",
      insert: [
        { id: "whole", duration: { base: "whole" }, rest: {} },
        { id: "extra", duration: { base: "quarter" }, rest: {} },
      ],
    };
    const blocked = await dispatchMcpTool(store, "preview.propose_patches", { batchId: "batch", patches: [last] });
    expect(blocked.structuredContent).toMatchObject({ code: "rhythm_truncation_requires_confirmation" });
    expect((await dispatchMcpTool(store, "preview.get_batch", { batchId: "batch" })).structuredContent).toMatchObject({
      patchCount: 1,
      chunkCount: 1,
    });
    const final = await dispatchMcpTool(store, "preview.propose_patches", {
      batchId: "batch",
      patches: [last],
      allowRhythmTruncation: true,
    });
    expect(final.structuredContent).toMatchObject({ status: "pending" });
  });

  it.each([false, true])("removes staff text through a patch proposal (auto-accept: %s)", async (autoAccept) => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.expressions = [
      { position: { fraction: [0, 1] }, text: [{ text: "dolce" }] },
      { position: { fraction: [0, 1] }, text: [{ text: "<copilot>done" }] },
      { position: { fraction: [1, 2] }, text: [{ text: "</copilot>" }] },
    ];
    const store = createDocumentStore();
    store.getState().loadScore(score, "test.mnx");
    const before = store.getState().mnxJson;
    const originalMeasure = structuredClone(store.getState().workingScore!.parts[0]!.measures[0]!);
    useMcpSessionStore.getState().start({ autoAccept });
    const patches: ScorePatch[] = [2, 1].map((expressionIndex) => ({
      kind: "removeMeasureExpression",
      measurePath: { partId: "keyboard.piano", measureIndex: 0 },
      expressionIndex,
    }));

    const validation = await dispatchMcpTool(store, "score.validate", { patches });
    expect(validation.structuredContent).toMatchObject({ valid: true });
    expect(store.getState().mnxJson).toBe(before);

    const result = await dispatchMcpTool(store, "preview.propose_patches", { patches });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: autoAccept ? "accepted" : "pending" });
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0]!;
    const expectedMeasure = { ...originalMeasure, expressions: [originalMeasure.expressions![0]] };
    expect(parseMnx(JSON.parse(proposal.proposedMnx!)).parts[0]!.measures[0]).toEqual(expectedMeasure);
    if (autoAccept) {
      expect(store.getState().workingScore!.parts[0]!.measures[0]).toEqual(expectedMeasure);
      expect(parseMnx(JSON.parse(store.getState().mnxJson)).parts[0]!.measures[0]).toEqual(expectedMeasure);
      expect(store.getState().lastCommittedPatches).toEqual(patches);
      expect(store.getState().dirty).toBe(true);
    } else {
      expect(store.getState().mnxJson).toBe(before);
    }
  });

  it.each([-1, 0.5, 1, "0", "splice", null, undefined])(
    "rejects an invalid or missing expression index (%s) before staging",
    async (expressionIndex) => {
      const score = makeScore();
      score.parts[0]!.measures[0]!.expressions = [{ position: { fraction: [0, 1] }, text: [{ text: "keep me" }] }];
      const store = createDocumentStore();
      store.getState().loadScore(score, "test.mnx");
      const before = store.getState().mnxJson;
      useMcpSessionStore.getState().start({ autoAccept: true });

      const result = await dispatchMcpTool(store, "preview.propose_patches", {
        patches: [
          {
            kind: "removeMeasureExpression",
            measurePath: { partId: "keyboard.piano", measureIndex: 0 },
            expressionIndex,
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: expressionIndex === 1 ? "tool_failed" : "invalid_patches",
      });
      expect(store.getState().mnxJson).toBe(before);
      expect(useMcpSessionStore.getState().proposals).toEqual({});
    },
  );

  it.each(["0", "__proto__", -1, 0.5, null])(
    "rejects an invalid measure index (%s) during validation and proposal",
    async (measureIndex) => {
      const score = makeScore();
      score.parts[0]!.measures[0]!.expressions = [{ position: { fraction: [0, 1] }, text: [{ text: "keep me" }] }];
      const store = createDocumentStore();
      store.getState().loadScore(score, "test.mnx");
      const before = store.getState().mnxJson;
      useMcpSessionStore.getState().start({ autoAccept: true });
      const patches = [
        {
          kind: "removeMeasureExpression",
          measurePath: { partId: "keyboard.piano", measureIndex },
          expressionIndex: 0,
        },
      ];

      const validation = await dispatchMcpTool(store, "score.validate", { patches });
      expect(validation.structuredContent).toMatchObject({ valid: false });
      const result = await dispatchMcpTool(store, "preview.propose_patches", { patches });
      expect(result.isError).toBe(true);
      expect(store.getState().mnxJson).toBe(before);
      expect(useMcpSessionStore.getState().proposals).toEqual({});
    },
  );

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
    expect(first.structuredContent).toMatchObject({ batchId: "orchestration", status: "batching", patchCount: 1 });
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

  it("validates and stages global chord-symbol patches", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    const before = store.getState().mnxJson;

    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      summary: "Add D harmony",
      patches: [
        {
          kind: "setGlobalMeasureField",
          measureIndex: 0,
          update: {
            field: "chordSymbols",
            value: [{ position: { fraction: [0, 1] }, rawText: "D" }],
          },
        },
      ],
    });

    expect(result.isError).not.toBe(true);
    expect(store.getState().mnxJson).toBe(before);
    const proposal = Object.values(useMcpSessionStore.getState().proposals)[0];
    expect(proposal).toMatchObject({ status: "pending", summary: "Add D harmony" });
    expect(proposal?.proposedMnx).toContain('"chordSymbols"');
    expect(proposal?.proposedMnx).toContain('"rawText": "D"');
  });

  it("applies global chord-symbol patches through auto-accept", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore(), "test.mnx");
    useMcpSessionStore.getState().start({ autoAccept: true });

    const result = await dispatchMcpTool(store, "preview.propose_patches", {
      patches: [
        {
          kind: "setGlobalMeasureField",
          measureIndex: 0,
          update: {
            field: "chordSymbols",
            value: [{ position: { fraction: [0, 1] }, rawText: "D" }],
          },
        },
      ],
    });

    expect(result.structuredContent).toMatchObject({ status: "accepted" });
    expect(store.getState().workingScore?.global.measures[0]?.chordSymbols).toEqual([
      { position: { fraction: [0, 1] }, rawText: "D" },
    ]);
    expect(store.getState().mnxJson).toContain('"rawText":"D"');
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
      violations: [{ measureIndex: 0, voice: 0, eventId: "e1", noteId: "n1", soundingMidi: 48, direction: "below" }],
    });
    const filtered = await dispatchMcpTool(store, "score.get_instruments", { partIds: [] });
    expect(filtered.content[0]?.text).toBe("Returned 0 instruments (0 out of range).");
    expect(filtered.structuredContent).toMatchObject({ instruments: [], outOfRangeCount: 0 });
  });

  it("checks transposing instruments against concert pitch and locates out-of-range notes", async () => {
    const store = createDocumentStore();
    const score = makeScore();
    const part = score.parts[0]!;
    part._x = { viritura: { instrumentId: "wind.reed.clarinet.bflat" } };
    part.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
    score.global.measures[0]!.number = 0;
    score.global.measures[0]!.id = "pickup";
    part.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "clarinet-event",
        duration: { base: "whole" },
        notes: [
          { id: "lowest", pitch: { step: "D", octave: 3 } },
          { id: "too-low", pitch: { step: "C", octave: 3 } },
        ],
      },
    ];
    store.getState().loadScore(score, "clarinet.mnx");
    const result = await dispatchMcpTool(store, "score.get_instruments", {});
    expect(result.structuredContent).toMatchObject({
      instruments: [
        {
          soundingRange: { low: 48, high: 50 },
          belowRange: 1,
          violations: [{ measureIndex: 0, measureNumber: 0, measureId: "pickup", noteId: "too-low", soundingMidi: 48 }],
        },
      ],
    });
  });

  it("paginates every located range violation", async () => {
    const store = createDocumentStore();
    const score = makeScore();
    score.parts[0]!._x = { viritura: { instrumentId: "wind.flutes.flute" } };
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("Expected an event.");
    event.notes = Array.from({ length: 105 }, (_, index) => ({
      id: `out-${String(index)}`,
      pitch: { step: "C", octave: 3 },
    }));
    store.getState().loadScore(score, "flute.mnx");
    const first = await dispatchMcpTool(store, "score.get_instruments", {
      partIds: ["keyboard.piano"],
      violationLimit: 100,
    });
    expect(first.structuredContent).toMatchObject({
      instruments: [{ belowRange: 105, violationsTruncated: true, violationOffset: 0, nextViolationOffset: 100 }],
    });
    const last = await dispatchMcpTool(store, "score.get_instruments", {
      partIds: ["keyboard.piano"],
      violationOffset: 100,
      violationLimit: 100,
    });
    expect(last.structuredContent).toMatchObject({
      instruments: [
        {
          belowRange: 105,
          violationOffset: 100,
          nextViolationOffset: null,
          violations: [
            { noteId: "out-100" },
            { noteId: "out-101" },
            { noteId: "out-102" },
            { noteId: "out-103" },
            { noteId: "out-104" },
          ],
        },
      ],
    });
  });

  it("discovers instruments, blocks unsafe changes and preserves music in safe proposals", async () => {
    const store = createDocumentStore();
    const score = makeScore();
    score.parts[0]!._x = { viritura: { instrumentId: "wind.flutes.flute" } };
    store.getState().loadScore(score, "flute.mnx");
    const before = store.getState().mnxJson;
    const catalog = await dispatchMcpTool(store, "score.get_instrument_catalog", { query: "wind.reed.oboe" });
    expect(catalog.structuredContent).toMatchObject({ instruments: [{ id: "wind.reed.oboe" }] });
    const unsafe = await dispatchMcpTool(store, "preview.change_instrument", {
      partId: "keyboard.piano",
      instrumentId: "drum.snare-drum",
    });
    expect(unsafe.structuredContent).toMatchObject({ code: "instrument_change_unsafe" });
    expect(useMcpSessionStore.getState().proposals).toEqual({});

    const pending = await dispatchMcpTool(store, "preview.change_instrument", {
      partId: "keyboard.piano",
      instrumentId: "keyboard.piano",
    });
    expect(pending.structuredContent).toMatchObject({
      status: "pending",
      instrumentChange: { warning: expect.stringContaining("staff 1") },
      summary: expect.stringContaining("staff 1"),
    });
    expect(store.getState().mnxJson).toBe(before);

    useMcpSessionStore.getState().start({ autoAccept: true });
    const accepted = await dispatchMcpTool(store, "preview.change_instrument", {
      partId: "keyboard.piano",
      instrumentId: "wind.reed.oboe",
    });
    expect(accepted.structuredContent).toMatchObject({ status: "accepted" });
    expect(store.getState().workingScore!.parts[0]!._x?.viritura?.instrumentId).toBe("wind.reed.oboe");
    expect(store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      id: "event-1",
      notes: [{ id: "note-1" }, { id: "note-2" }, { id: "note-3" }],
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

    const warning = await dispatchMcpTool(store, "preview.normalize_tritsch_instruments", {});
    expect(warning.structuredContent).toMatchObject({ code: "rhythm_truncation_requires_confirmation" });
    const result = await dispatchMcpTool(store, "preview.normalize_tritsch_instruments", {
      allowRhythmTruncation: true,
    });

    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
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
