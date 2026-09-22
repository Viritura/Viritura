import { afterEach, describe, it, expect, vi } from "vitest";
import type { Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { addNoteAtClick } from "../noteInputClickHandler";
import { resetNoteInputStore, type NoteInputState } from "../../../store/noteInputStore";
import type { NoteInputClickInfo } from "../../InputCursor";

/**
 * Regression: a plain (non-Shift) click on a percussion staff at a beat that
 * already holds a kit-note used to be treated as an empty/rest beat — because
 * the merge-vs-overwrite check only looked at `item.notes`, never
 * `item.kitNotes` — so clicking a second drum at the same beat silently
 * overwrote the first hit instead of layering onto it (a real chord of
 * simultaneous drums). See AGENTS percussion investigation.
 */

/** A single unpitched-percussion part: kick at staffPosition -4 (below the
 *  staff), snare at staffPosition 0 (middle line). */
function makePercussionScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "p0",
        name: "Drums",
        kit: {
          kick: { name: "Kick", sound: "snd-kick", staffPosition: -4 },
          snare: { name: "Snare", sound: "snd-snare", staffPosition: 0 },
        },
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [
                  { type: "event", id: "e0", duration: { base: "quarter" }, kitNotes: [{ kitComponent: "kick" }] },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

function makeDisplayList(): DisplayList {
  return {
    measureBounds: [{ index: 0, partIndex: 0, staffIndex: 0, systemIndex: 0, y: 100, x: 0, width: 200, height: 40 }],
  } as unknown as DisplayList;
}

function makeNoteInputState(): NoteInputState {
  return {
    active: true,
    currentVoice: 1,
    currentDuration: "quarter",
    dotCount: 0,
    isRest: false,
    currentAccidental: null,
    tieActive: false,
    slurActive: false,
  } as unknown as NoteInputState;
}

/** Click at MNX staffPosition 0 (snare's line): posFromTop = 4, scoreY = 100 + 4*(10/2). */
function makeSnareClickInfo(): NoteInputClickInfo {
  return {
    scoreX: 10,
    scoreY: 120,
    staffPosition: 0,
    staff: { x: 0, xEnd: 200, y: 100, spatium: 10, height: 40, index: 0 },
    shiftKey: false,
    altKey: false,
  } as unknown as NoteInputClickInfo;
}

function runClick(score: Score, info: NoteInputClickInfo): Score {
  let captured: Score = score;
  addNoteAtClick({
    info,
    score,
    noteInputState: makeNoteInputState(),
    spatialIndex: null,
    displayList: makeDisplayList(),
    selectedScoreIndex: 0,
    updateScore: (s: Score) => {
      captured = s;
    },
    setCursor: vi.fn(),
    setLastPitch: vi.fn(),
    setAccidental: vi.fn(),
    setSlurStart: vi.fn(),
    clearSlurStart: vi.fn(),
    toggleSlur: vi.fn(),
    playbackActions: { previewNote: vi.fn() } as never,
  });
  return captured;
}

afterEach(() => resetNoteInputStore());

describe("addNoteAtClick — percussion overlapping notes", () => {
  it("adds a second drum to the same beat instead of overwriting the first hit", () => {
    const score = makePercussionScore();
    const result = runClick(score, makeSnareClickInfo());

    const event = result.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(event.kitNotes).toHaveLength(2);
    const components = event.kitNotes!.map((kn) => kn.kitComponent).sort();
    expect(components).toEqual(["kick", "snare"]);

    // Source score must remain untouched (immutable mutation contract).
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.kitNotes).toHaveLength(1);
  });

  it("does not duplicate the same drum when clicked twice at the same beat", () => {
    const score = makePercussionScore();
    // Click kick's own line (staffPosition -4 → posFromTop 8 → scoreY 140).
    const kickClickInfo: NoteInputClickInfo = {
      ...makeSnareClickInfo(),
      scoreY: 140,
    };
    const result = runClick(score, kickClickInfo);

    const event = result.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(event.kitNotes).toHaveLength(1);
    expect(event.kitNotes![0]!.kitComponent).toBe("kick");
  });
});
