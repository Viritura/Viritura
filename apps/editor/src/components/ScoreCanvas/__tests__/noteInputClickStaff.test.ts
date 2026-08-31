import { describe, it, expect, vi } from "vitest";
import type { Score } from "@viritura/core";
import { isRest } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { addNoteAtClick } from "../noteInputClickHandler";
import type { NoteInputState } from "../../../store/noteInputStore";
import type { NoteInputClickInfo } from "../../InputCursor";
import { sequenceContentBeats } from "../../../commands/noteCommands";
import { buildNavigationIndex } from "../../../navigation/NavigationIndex";
import { resolveEventLocation } from "../../../score/ElementPath";

/**
 * Regression: clicking a note onto a lower staff in a multi-part score used to
 * compute the staff number from the SYSTEM-GLOBAL visual staff index. Sequence
 * `staff` properties are part-local (always 1 for a single-staff part), so the
 * grand-staff sequence lookup matched nothing and the note was written to a
 * phantom new voice instead of replacing the measure's rest. Keyboard entry was
 * unaffected. See Rhapsody-in-Blue note-entry bug.
 */

/** A two-part score; each single-staff part carries `staff: 1` on its one
 *  sequence containing a single full-measure (whole) rest in 4/4. */
function makeTwoPartScore(): Score {
  const wholeRest = () => ({ type: "event" as const, duration: { base: "whole" as const }, rest: {} });
  const part = (id: string, name: string) => ({
    id,
    name,
    measures: [{ sequences: [{ staff: 1, content: [wholeRest()] }] }],
  });
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [part("p0", "Violin I"), part("p1", "Violin II")],
  } as unknown as Score;
}

/** measureBounds mapping part 0 to global staff 0 (y=0) and part 1 to global
 *  staff 1 (y=100) — mirrors a full-score layout where staffIndex is global. */
function makeDisplayList(): DisplayList {
  return {
    measureBounds: [
      { index: 0, partIndex: 0, staffIndex: 0, systemIndex: 0, y: 0, x: 0, width: 200, height: 40 },
      { index: 0, partIndex: 1, staffIndex: 1, systemIndex: 0, y: 100, x: 0, width: 200, height: 40 },
    ],
  } as unknown as DisplayList;
}

function makeNoteInputState(): NoteInputState {
  return {
    active: true,
    currentVoice: 1,
    currentDuration: "whole",
    dotCount: 0,
    isRest: false,
    currentAccidental: null,
    tieActive: false,
    slurActive: false,
  } as unknown as NoteInputState;
}

/** Click on the SECOND visual staff (global index 1 = Violin II). */
function makeClickInfo(): NoteInputClickInfo {
  return {
    scoreX: 10,
    scoreY: 100,
    staffPosition: 0,
    staff: { x: 0, xEnd: 200, y: 100, spatium: 10, height: 40, index: 1 },
    shiftKey: false,
    altKey: false,
  } as unknown as NoteInputClickInfo;
}

function runClick(score: Score, noteInputState = makeNoteInputState(), setAccidental = vi.fn()): Score {
  let captured: Score = score;
  addNoteAtClick({
    info: makeClickInfo(),
    score,
    noteInputState,
    spatialIndex: null,
    displayList: makeDisplayList(),
    selectedScoreIndex: 0,
    updateScore: (s: Score) => {
      captured = s;
    },
    setCursor: vi.fn(),
    setLastPitch: vi.fn(),
    setAccidental,
    setSlurStart: vi.fn(),
    clearSlurStart: vi.fn(),
    toggleSlur: vi.fn(),
    playbackActions: { previewNote: vi.fn() } as never,
  });
  return captured;
}

describe("addNoteAtClick — staff/voice resolution on lower staves", () => {
  it("materializes a complete selectable 5/2 bar when clicking a quarter note at its start", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 5, unit: 2 } }] },
      parts: [
        {
          id: "part-1",
          name: "Piano",
          measures: [
            {
              sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
            },
          ],
        },
      ],
    };
    let result = score;
    addNoteAtClick({
      info: {
        scoreX: 10,
        scoreY: 0,
        staffPosition: 0,
        staff: { x: 0, xEnd: 200, y: 0, spatium: 10, height: 40, index: 0 },
        shiftKey: false,
        altKey: false,
      } as NoteInputClickInfo,
      score,
      noteInputState: { ...makeNoteInputState(), currentDuration: "quarter" },
      spatialIndex: null,
      displayList: {
        measureBounds: [{ index: 0, partIndex: 0, staffIndex: 0, systemIndex: 0, y: 0, x: 0, width: 200, height: 40 }],
      } as unknown as DisplayList,
      selectedScoreIndex: 0,
      updateScore: (next) => {
        result = next;
      },
      setCursor: vi.fn(),
      setLastPitch: vi.fn(),
      setAccidental: vi.fn(),
      setSlurStart: vi.fn(),
      clearSlurStart: vi.fn(),
      toggleSlur: vi.fn(),
      playbackActions: { previewNote: vi.fn() } as never,
    });

    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;
    const inserted = content[0]!;
    expect(content.reduce((beats, item) => beats + sequenceContentBeats(item), 0)).toBe(10);
    expect(inserted.notes).toHaveLength(1);
    expect(inserted.id).toBeTruthy();
    expect(content.slice(1).every((item) => isRest(item))).toBe(true);

    const elementId = `p0/m0/s0/${inserted.id}`;
    expect(resolveEventLocation(elementId, result)).toMatchObject({ measureIndex: 0, eventIndex: 0 });
    expect(buildNavigationIndex(result).entries.some((entry) => entry.elementId === elementId)).toBe(true);
  });

  it("replaces the rest in voice 1 instead of creating a phantom voice", () => {
    const result = runClick(makeTwoPartScore());

    const seqs = result.parts[1]!.measures[0]!.sequences;
    // No phantom second sequence/voice was created.
    expect(seqs.length).toBe(1);

    const content = seqs[0]!.content;
    expect(content.length).toBe(1);
    // The full-measure rest is now a note, not a rest.
    expect(isRest(content[0]!)).toBe(false);
    expect(content[0]!.type).toBe("event");
    expect((content[0] as { notes?: unknown[] }).notes?.length).toBeGreaterThan(0);
  });

  it("leaves the untouched part's rest intact", () => {
    const result = runClick(makeTwoPartScore());
    const firstPartContent = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(firstPartContent.length).toBe(1);
    expect(isRest(firstPartContent[0]!)).toBe(true);
  });

  it("clears an explicit accidental after inserting a note", () => {
    const setAccidental = vi.fn();
    runClick(makeTwoPartScore(), { ...makeNoteInputState(), currentAccidental: "sharp" }, setAccidental);

    expect(setAccidental).toHaveBeenCalledWith(null);
  });
});
