import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipPrimitives } from "@viritura/ui";
import { parseMnx, serializeMnx } from "@viritura/format";
import { buildTempoModel, generateTimeline } from "@viritura/midi";
import type { Score } from "@viritura/core";
import { createHistoryStore } from "../store/historyStore";
import type { Selection } from "../store/selectionStore";
import { TempoRampInspector } from "./TempoRampInspector";
import { removeTempoRamp, saveTempoRamp, type RampEdit } from "./editing";
import { selectedRampSpan } from "./selection";
import { NotationInspector } from "../components/NotationInspector";
import { DocumentProvider, useDocument, useDocumentActions } from "../store/DocumentContext";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";
import { removeMeasureRangeFromScore } from "../keyboard/normalModeDeleteHelpers";
import { deleteAnnotation, deleteAnnotations } from "../commands/deleteCommands";
import { resolveAnnotationLocation } from "../score/ElementPath";

afterEach(() => {
  cleanup();
  resetSelectionStore();
});

function source(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { id: "m0", time: { count: 3, unit: 4 }, tempos: [{ bpm: 100, value: { base: "quarter" } }] },
        { id: "m1" },
        { id: "m2" },
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: [0, 1, 2].map((m) => ({
          sequences: [
            {
              content: [0, 1, 2].map((n) => ({
                type: "event" as const,
                id: `e${m}${n}`,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}
const selection: Selection = {
  kind: "measure",
  startPartIndex: 0,
  endPartIndex: 0,
  startStaffIndex: 0,
  endStaffIndex: 0,
  startMeasure: 0,
  endMeasure: 1,
};
const edit: RampEdit = {
  startMeasure: 0,
  startBeat: 0,
  endMeasure: 1,
  endBeat: 3,
  targetMode: "ratio",
  target: 80,
  curve: "smooth",
  text: "rit.",
};

function Harness({ initial, onUpdate }: { initial: Score; onUpdate: (score: Score) => void }) {
  const [score, setScore] = useState(initial);
  return (
    <TooltipPrimitives.Provider>
      <TempoRampInspector
        score={score}
        selection={selection}
        updateScore={(next) => {
          setScore(next);
          onUpdate(next);
        }}
      />
    </TooltipPrimitives.Provider>
  );
}

function ConnectedInspector() {
  const { loadScore } = useDocumentActions();
  const { score } = useDocument();
  const { selectMeasure, extendMeasure } = useSelectionActions();
  useEffect(() => {
    loadScore(source(), "ramps.mnx");
    selectMeasure(0, 0, 0);
    extendMeasure(0, 0, 1);
  }, [loadScore, selectMeasure, extendMeasure]);
  return (
    <>
      <NotationInspector />
      <output data-testid="connected-score">{JSON.stringify(score)}</output>
    </>
  );
}

describe("native tempo ramp authoring", () => {
  it("is reachable from a real bar-range selection in Notation Properties", async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider>
        <DocumentProvider>
          <ConnectedInspector />
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );
    await user.click(await screen.findByRole("button", { name: "Add tempo ramp" }));
    await user.click(screen.getByRole("button", { name: "Create tempo ramp" }));
    const saved = JSON.parse(screen.getByTestId("connected-score").textContent!) as Score;
    expect(saved.global.measures[0]!.gradualTempo?.end.measure).toBe("m1");
    expect(saved.global.measures[0]!.gradualTempo?.endRatio).toBe(0.8);
  });
  it("creates, edits and removes a ramp with printed system text", async () => {
    const user = userEvent.setup();
    let current = source();
    render(
      <Harness
        initial={current}
        onUpdate={(score) => {
          current = score;
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add tempo ramp" }));
    expect(screen.getByRole("spinbutton", { name: "End offset (quarter notes)" }).getAttribute("value")).toBe("3");
    await user.click(screen.getByRole("combobox", { name: "Tempo curve" }));
    await user.click(screen.getByRole("option", { name: "Smooth" }));
    await user.click(screen.getByRole("button", { name: "Create tempo ramp" }));
    expect(current.global.measures[0]!.gradualTempo?.endRatio).toBe(0.8);
    expect(current.global.measures[0]!.gradualTempo?.curve).toBe("smooth");
    expect(current.global.measures[0]!.systemText?.[0]?.text).toEqual([{ text: "rit." }]);
    expect(screen.getByRole("status", { name: "Tempo ramp preview" }).textContent).toContain("100.0 to 80.0");
    await user.click(screen.getByRole("combobox", { name: "Target mode" }));
    await user.click(screen.getByRole("option", { name: "Quarter-note BPM" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Target BPM (quarter note)" }), {
      target: { value: "140" },
    });
    await user.click(screen.getByRole("combobox", { name: "Marking preset" }));
    await user.click(screen.getByRole("option", { name: "accel." }));
    await user.click(screen.getByRole("button", { name: "Apply tempo ramp" }));
    expect(current.global.measures[0]!.gradualTempo?.endBpm).toBe(140);
    expect(current.global.measures[0]!.gradualTempo?.endRatio).toBeUndefined();
    expect(current.global.measures[0]!.systemText?.[0]?.text).toEqual([{ text: "accel." }]);
    await user.click(screen.getByRole("button", { name: "Remove tempo ramp" }));
    expect(current.global.measures[0]!.gradualTempo).toBeUndefined();
    expect(current.global.measures[0]!.systemText).toBeUndefined();
  });

  it("surfaces invalid targets and spans instead of changing the score", async () => {
    const user = userEvent.setup();
    let updates = 0;
    render(
      <Harness
        initial={source()}
        onUpdate={() => {
          updates++;
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add tempo ramp" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Target (% of starting tempo)" }), {
      target: { value: "0" },
    });
    await user.click(screen.getByRole("button", { name: "Create tempo ramp" }));
    expect(screen.getByRole("alert").textContent).toContain("greater than zero");
    expect(updates).toBe(0);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Target (% of starting tempo)" }), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "End offset (quarter notes)" }), {
      target: { value: "4" },
    });
    await user.click(screen.getByRole("button", { name: "Create tempo ramp" }));
    expect(screen.getByRole("alert").textContent).toContain("within their bars");
    expect(updates).toBe(0);
  });

  it("persists one coherent edit through history, save/reload and playback", () => {
    const score = source();
    const history = createHistoryStore(JSON.stringify(serializeMnx(score)), { current: undefined });
    const next = saveTempoRamp(score, edit).score!;
    history.getState().pushState(JSON.stringify(serializeMnx(next)), "Tempo ramp");
    const restored = parseMnx(serializeMnx(next));
    expect(buildTempoModel(restored.global.measures).model.bpmAtBeat(6)).toBeCloseTo(80);
    const undone = parseMnx(JSON.parse(history.getState().undo()!));
    expect(undone.global.measures[0]!.gradualTempo).toBeUndefined();
    expect(undone.global.measures[0]!.systemText).toBeUndefined();
    const redone = parseMnx(JSON.parse(history.getState().redo()!));
    expect(redone.global.measures[0]!.gradualTempo?.endRatio).toBe(0.8);
    expect(redone.global.measures[0]!.systemText).toHaveLength(1);
    expect(score.global.measures[0]!.gradualTempo).toBeUndefined();
  });

  it("preserves unrelated text and the ramp label's rich text and placement when editing playback", () => {
    const next = saveTempoRamp(source(), edit).score!;
    const measure = next.global.measures[0]!;
    measure.systemText![0]!.manualOffset = [2, 3];
    measure.systemText![0]!.text = [{ text: "rit.", style: { weight: "bold" } }];
    measure.systemText!.push({ id: "other", text: [{ text: "espressivo" }], position: { fraction: [0, 1] } });
    const edited = saveTempoRamp(next, { ...edit, curve: "late" }, 0).score!;
    const label = edited.global.measures[0]!.systemText?.find((text) => text.id !== "other");
    expect(label?.text).toEqual([{ text: "rit.", style: { weight: "bold" } }]);
    expect(label?.manualOffset).toEqual([2, 3]);
    expect(removeTempoRamp(edited, 0).global.measures[0]!.systemText?.map((text) => text.id)).toEqual(["other"]);
  });

  it.each(["single", "multiple"] as const)(
    "removes ramp playback when deleting its printed label through %s annotation deletion",
    (mode) => {
      const baseline = source();
      baseline.global.measures[2]!.tempos = [{ bpm: 110, value: { base: "quarter" } }];
      const initial = saveTempoRamp(baseline, edit).score!;
      const measure = initial.global.measures[0]!;
      measure.systemText!.push({
        id: "other",
        text: [{ text: "espressivo" }],
        position: { fraction: [0, 1] },
      });
      const labelId = measure.gradualTempo!.systemTextId!;
      const location = resolveAnnotationLocation(`m0/systemText/${labelId}`)!;
      const history = createHistoryStore(JSON.stringify(serializeMnx(initial)), { current: undefined });
      const removed =
        mode === "single" ? deleteAnnotation(initial, location)! : deleteAnnotations(initial, [location, location])!;
      expect(removed.global.measures[0]!.gradualTempo).toBeUndefined();
      expect(removed.global.measures[0]!.systemText?.map((text) => text.id)).toEqual(["other"]);
      expect(removed.global.measures.map((bar) => bar.tempos)).toEqual(
        baseline.global.measures.map((bar) => bar.tempos),
      );
      expect(generateTimeline(initial).model.bpmAtBeat(3)).toBeCloseTo(90);
      expect(generateTimeline(removed)).toEqual(generateTimeline(baseline));
      expect(initial.global.measures[0]!.gradualTempo?.systemTextId).toBe(labelId);

      history.getState().pushState(JSON.stringify(serializeMnx(removed)), "Delete tempo ramp label");
      const restored = parseMnx(serializeMnx(removed));
      expect(restored.global.measures[0]!.gradualTempo).toBeUndefined();
      expect(generateTimeline(restored)).toEqual(generateTimeline(baseline));
      const undone = parseMnx(JSON.parse(history.getState().undo()!));
      expect(undone.global.measures[0]!.gradualTempo?.systemTextId).toBe(labelId);
      expect(generateTimeline(undone).model.bpmAtBeat(3)).toBeCloseTo(90);
      const redone = parseMnx(JSON.parse(history.getState().redo()!));
      expect(redone.global.measures[0]!.gradualTempo).toBeUndefined();
      expect(generateTimeline(redone)).toEqual(generateTimeline(baseline));
    },
  );

  it("keeps playback, inspector rendering and undo/redo valid after deleting the endpoint bar", () => {
    const initial = saveTempoRamp(source(), edit).score!;
    initial.global.measures[0]!.systemText!.push({
      id: "other",
      text: [{ text: "espressivo" }],
      position: { fraction: [0, 1] },
    });
    const history = createHistoryStore(JSON.stringify(serializeMnx(initial)), { current: undefined });
    const removed = removeMeasureRangeFromScore(initial, 1, 1)!;
    history.getState().pushState(JSON.stringify(serializeMnx(removed)), "Delete bars");
    expect(removed.global.measures[0]!.gradualTempo).toBeUndefined();
    expect(removed.global.measures[0]!.systemText?.map((text) => text.id)).toEqual(["other"]);
    expect(() => generateTimeline(removed)).not.toThrow();
    render(<Harness initial={removed} onUpdate={() => {}} />);
    expect(screen.getByRole("button", { name: "Add tempo ramp" })).toBeTruthy();
    const undone = parseMnx(JSON.parse(history.getState().undo()!));
    expect(undone.global.measures[0]!.gradualTempo?.end.measure).toBe("m1");
    expect(() => generateTimeline(undone)).not.toThrow();
    const redone = parseMnx(JSON.parse(history.getState().redo()!));
    expect(redone.global.measures[0]!.gradualTempo).toBeUndefined();
    expect(() => generateTimeline(redone)).not.toThrow();
  });

  it("rejects overlaps and a second ramp in the same starting bar", () => {
    const next = saveTempoRamp(source(), edit).score!;
    expect(saveTempoRamp(next, edit).error).toContain("one tempo ramp");
    expect(saveTempoRamp(next, { ...edit, startMeasure: 1, endMeasure: 2 }).error).toContain("overlap");
    expect(saveTempoRamp(source(), { ...edit, endMeasure: 0, endBeat: 0 }).error).toContain("positive span");
    expect(saveTempoRamp(source(), { ...edit, endMeasure: 1e100 }).error).toContain("within the score");
  });

  it("normalizes reversed note selections and includes the final selected note", () => {
    expect(
      selectedRampSpan(source(), {
        kind: "range",
        startElementId: "p0/m1/s0/e11",
        endElementId: "p0/m0/s0/e01",
      }),
    ).toEqual({ startMeasure: 0, startBeat: 1, endMeasure: 1, endBeat: 2 });
  });

  it("authors a pickup ramp over its written duration without changing the displayed meter", () => {
    const score = source();
    score.global.measures[0]!.number = 0;
    score.parts[0]!.measures[0]!.sequences[0]!.content.splice(1);
    const span = selectedRampSpan(score, { ...selection, endMeasure: 0 });
    expect(span?.endBeat).toBe(1);
    const next = saveTempoRamp(score, { ...edit, ...span! }).score!;
    expect(next.global.measures[0]!.number).toBe(0);
    expect(next.global.measures[0]!.time).toEqual({ count: 3, unit: 4 });
    expect(generateTimeline(next).model.bpmAtBeat(1)).toBeCloseTo(80);
  });

  it("uses selected tuplet timing rather than nominal written note durations", () => {
    const score = source();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        outer: { multiple: 2, duration: { base: "eighth" } },
        inner: { multiple: 3, duration: { base: "eighth" } },
        content: [0, 1, 2].map((i) => ({
          type: "event",
          id: `t${i}`,
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "C", octave: 4 } }],
        })),
      },
    ];
    const span = selectedRampSpan(score, {
      kind: "range",
      startElementId: "p0/m0/s0/t1",
      endElementId: "p0/m0/s0/t2",
    });
    expect(span?.startBeat).toBeCloseTo(1 / 3);
    expect(span?.endBeat).toBeCloseTo(1);
  });
});
