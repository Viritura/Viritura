import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import {
  resolveDrumKitTarget,
  applyDrumKitEdits,
  findPercussionPartIndex,
  setEventNotehead,
  getEventNotehead,
} from "../commands/drumKitCommands";

function makePercussionScore(): Score {
  return {
    parts: [
      {
        name: "Percussion",
        kit: {
          "kit-snare": { staffPosition: 2, name: "Snare", sound: "snd-snare", notehead: "normal" },
          "kit-crash": { staffPosition: 6, name: "Crash", sound: "snd-crash", notehead: "x" },
        },
        measures: [],
      },
      { name: "Violin", measures: [] },
    ],
    global: {
      measures: [],
      sounds: {
        "snd-snare": { midiNumber: 38, name: "Acoustic Snare" },
        "snd-crash": { midiNumber: 49, name: "Crash Cymbal 1" },
      },
    },
  } as unknown as Score;
}

describe("drumKitCommands", () => {
  it("finds the percussion part, preferring a valid hint", () => {
    const score = makePercussionScore();
    expect(findPercussionPartIndex(score)).toBe(0);
    expect(findPercussionPartIndex(score, 1)).toBe(0); // Violin isn't percussion → fall back
    expect(findPercussionPartIndex(score, 0)).toBe(0);
  });

  it("resolves a part's kit into editable rows (top of staff first)", () => {
    const target = resolveDrumKitTarget(makePercussionScore(), 0);
    expect(target).not.toBeNull();
    expect(target!.partName).toBe("Percussion");
    // Crash (sp 6) sorts before Snare (sp 2).
    expect(target!.components.map((c) => c.id)).toEqual(["kit-crash", "kit-snare"]);
    const crash = target!.components[0]!;
    expect(crash).toMatchObject({ name: "Crash", staffPosition: 6, notehead: "x", midiKey: 49 });
  });

  it("applies edits: notehead, staff position, MIDI key, and borrowed kit", () => {
    const score = makePercussionScore();
    const next = applyDrumKitEdits(score, 0, [
      { id: "kit-snare", name: "Snare", staffPosition: 0, notehead: "normal", drumKit: undefined, midiKey: 40 },
      { id: "kit-crash", name: "Tam-tam", staffPosition: -3, notehead: "normal", drumKit: 49, midiKey: 45 },
    ]);

    const kit = next.parts[0]!.kit!;
    // Snare: notehead "normal" is dropped; key 40 written to its (part-scoped) sound entry.
    expect(kit["kit-snare"]!.notehead).toBeUndefined();
    expect(kit["kit-snare"]!.staffPosition).toBe(0);
    expect(next.global!.sounds!["snd-p0-kit-snare"]!.midiNumber).toBe(40);

    // Crash → Tam-tam borrows the Ethnic kit (49) at key 45.
    expect(kit["kit-crash"]!.drumKit).toBe(49);
    expect(kit["kit-crash"]!.name).toBe("Tam-tam");
    expect(next.global!.sounds!["snd-p0-kit-crash"]!.midiNumber).toBe(45);

    // Original score is untouched (produce returns a new score).
    expect(score.parts[0]!.kit!["kit-snare"]!.staffPosition).toBe(2);
  });

  it("rebuilds the kit on apply: adds new components and removes dropped ones, pruning orphan sounds", () => {
    const score = makePercussionScore();
    // Drop the crash, keep the snare, add a new "kit-cowbell".
    const next = applyDrumKitEdits(score, 0, [
      { id: "kit-snare", name: "Snare", staffPosition: 2, notehead: "normal", drumKit: undefined, midiKey: 38 },
      { id: "kit-cowbell", name: "Cowbell", staffPosition: 5, notehead: "triangleUp", drumKit: undefined, midiKey: 56 },
    ]);

    const kit = next.parts[0]!.kit!;
    expect(Object.keys(kit).sort()).toEqual(["kit-cowbell", "kit-snare"]);
    expect(kit["kit-crash"]).toBeUndefined();
    expect(kit["kit-cowbell"]!.notehead).toBe("triangleUp");
    expect(next.global!.sounds!["snd-p0-kit-cowbell"]!.midiNumber).toBe(56);

    // The removed crash's original sound entry is pruned.
    expect(next.global!.sounds!["snd-crash"]).toBeUndefined();
  });

  it("rejects an empty percussion map", () => {
    const score = makePercussionScore();
    expect(applyDrumKitEdits(score, 0, [])).toBe(score);
  });
});

/** A percussion score whose single measure plays one note per kit component,
 *  so we can assert how kit-note references are rewritten on apply. */
function makePercussionScoreWithNotes(): Score {
  const ev = (kc: string) =>
    ({ type: "event", duration: { base: "quarter" }, kitNotes: [{ kitComponent: kc }] }) as const;
  return {
    parts: [
      {
        name: "Percussion",
        kit: {
          "kit-snare": { staffPosition: 2, name: "Snare", sound: "snd-snare" },
          "kit-crash": { staffPosition: 6, name: "Crash", sound: "snd-crash", notehead: "x" },
        },
        measures: [{ sequences: [{ content: [ev("kit-snare"), ev("kit-crash")] }] }],
      },
    ],
    global: {
      measures: [{}],
      sounds: {
        "snd-snare": { midiNumber: 38, name: "Acoustic Snare" },
        "snd-crash": { midiNumber: 49, name: "Crash Cymbal 1" },
      },
    },
  } as unknown as Score;
}

/** Pull every kit-note's component reference out of a part's first measure. */
function kitRefs(score: Score, partIndex = 0): string[] {
  const content = score.parts[partIndex]!.measures[0]!.sequences[0]!.content;
  return content.flatMap((e) => (e.type === "event" ? (e.kitNotes ?? []).map((kn) => kn.kitComponent) : []));
}

describe("applyDrumKitEdits — kit-note reference integrity", () => {
  it("leaves references untouched when ids are preserved (in-place edits)", () => {
    const score = makePercussionScoreWithNotes();
    const next = applyDrumKitEdits(score, 0, [
      // Same ids, but change notehead + staff position.
      { id: "kit-snare", name: "Snare", staffPosition: 0, notehead: "x", drumKit: undefined, midiKey: 38 },
      { id: "kit-crash", name: "Crash", staffPosition: 6, notehead: "x", drumKit: undefined, midiKey: 49 },
    ]);
    expect(kitRefs(next)).toEqual(["kit-snare", "kit-crash"]);
    // The component (same id) now carries the new notehead, so the note follows.
    expect(next.parts[0]!.kit!["kit-snare"]!.notehead).toBe("x");
  });

  it("rebinds a removed component's notes to the surviving nearest staff position", () => {
    const score = makePercussionScoreWithNotes();
    // Drop the crash (sp 6); keep snare (sp 2). The crash note should rebind to
    // the only survivor (snare), not dangle.
    const next = applyDrumKitEdits(score, 0, [
      { id: "kit-snare", name: "Snare", staffPosition: 2, notehead: "normal", drumKit: undefined, midiKey: 38 },
    ]);
    expect(kitRefs(next)).toEqual(["kit-snare", "kit-snare"]);
  });

  it("re-skins the kit on a preset-style replace (all new ids) by staff position", () => {
    const score = makePercussionScoreWithNotes();
    // Entirely new ids (as a preset would produce). snare@2 → nearest new is
    // "low"@1 (dist 1) over "high"@5 (dist 3); crash@6 → "high"@5 (dist 1).
    const next = applyDrumKitEdits(score, 0, [
      { id: "preset-low", name: "Low", staffPosition: 1, notehead: "normal", drumKit: undefined, midiKey: 36 },
      { id: "preset-high", name: "High", staffPosition: 5, notehead: "x", drumKit: undefined, midiKey: 49 },
    ]);
    expect(kitRefs(next)).toEqual(["preset-low", "preset-high"]);
    // No reference points at a now-deleted id.
    const kit = next.parts[0]!.kit!;
    for (const ref of kitRefs(next)) expect(kit[ref]).toBeDefined();
  });
});

/** A pitched score with one two-note chord event, for note-level notehead tests. */
function makePitchedScore(): Score {
  return {
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "E", octave: 4 } }, { pitch: { step: "G", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    global: { measures: [{}] },
  } as unknown as Score;
}

const PITCHED_LOC = { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 };

describe("setEventNotehead — pitched notes", () => {
  it("sets a per-note notehead override on every note in the event", () => {
    const score = makePitchedScore();
    const next = setEventNotehead(score, { ...PITCHED_LOC, notehead: "diamond" })!;
    const notes = next.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(notes.type).toBe("event");
    if (notes.type !== "event") throw new Error("expected event");
    expect(notes.notes!.map((n) => n.notehead)).toEqual(["diamond", "diamond"]);
    // Original untouched.
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toBe(notes);
  });

  it("clears the override when set back to normal", () => {
    const score = makePitchedScore();
    const withDiamond = setEventNotehead(score, { ...PITCHED_LOC, notehead: "diamond" })!;
    const cleared = setEventNotehead(withDiamond, { ...PITCHED_LOC, notehead: "normal" })!;
    const ev = cleared.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type !== "event") throw new Error("expected event");
    expect(ev.notes!.every((n) => n.notehead === undefined)).toBe(true);
  });

  it("reads the current notehead via getEventNotehead", () => {
    const score = makePitchedScore();
    expect(getEventNotehead(score, PITCHED_LOC)).toBe("normal");
    const next = setEventNotehead(score, { ...PITCHED_LOC, notehead: "x" })!;
    expect(getEventNotehead(next, PITCHED_LOC)).toBe("x");
  });
});

const PERC_LOC = { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 };

describe("setEventNotehead — percussion kit-notes", () => {
  it("mints a new kit-component carrying the requested notehead and repoints the kit-note", () => {
    const score = makePercussionScoreWithNotes();
    // snare event: current component "kit-snare" has no notehead (normal).
    const next = setEventNotehead(score, { ...PERC_LOC, notehead: "x" })!;
    const refs = kitRefs(next);
    expect(refs[0]).not.toBe("kit-snare");
    const comp = next.parts[0]!.kit![refs[0]!]!;
    expect(comp.notehead).toBe("x");
    // Same instrument: sound + staff position preserved.
    expect(comp.sound).toBe("snd-snare");
    expect(comp.staffPosition).toBe(2);
    // Original snare component is left intact (may be referenced elsewhere).
    expect(next.parts[0]!.kit!["kit-snare"]).toBeDefined();
  });

  it("is a no-op when the component already has the requested notehead", () => {
    const score = makePercussionScoreWithNotes();
    // crash event already uses notehead "x".
    const next = setEventNotehead(score, { ...PERC_LOC, eventIndex: 1, notehead: "x" });
    expect(next).toBe(score);
  });

  it("reuses an existing matching component instead of duplicating", () => {
    const score = makePercussionScoreWithNotes();
    // Add a second snare hit so two notes reference kit-snare.
    const part = score.parts[0]! as { measures: { sequences: { content: unknown[] }[] }[] };
    part.measures[0]!.sequences[0]!.content.push({
      type: "event",
      duration: { base: "quarter" },
      kitNotes: [{ kitComponent: "kit-snare" }],
    });
    const first = setEventNotehead(score, { ...PERC_LOC, notehead: "x" })!;
    const newId = kitRefs(first)[0]!;
    // Now flip the THIRD event (the extra snare) to "x" — should reuse newId.
    const second = setEventNotehead(first, { ...PERC_LOC, eventIndex: 2, notehead: "x" })!;
    expect(kitRefs(second)[2]).toBe(newId);
    // Only one snare-x component was created.
    const snareXComps = Object.values(second.parts[0]!.kit!).filter(
      (c) => c.sound === "snd-snare" && c.notehead === "x",
    );
    expect(snareXComps).toHaveLength(1);
  });

  it("reads the percussion notehead via getEventNotehead", () => {
    const score = makePercussionScoreWithNotes();
    expect(getEventNotehead(score, PERC_LOC)).toBe("normal");
    expect(getEventNotehead(score, { ...PERC_LOC, eventIndex: 1 })).toBe("x");
  });
});
