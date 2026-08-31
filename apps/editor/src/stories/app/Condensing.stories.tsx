/**
 * Comprehensive condensing stories for professional engraving cases.
 *
 * These stories exercise the auto-condensing engine against a matrix
 * of musical situations a professional condensor handles by hand:
 *
 *   - Initial-measure labels (a2 on m1, often missed by auto-condensors)
 *   - Mid-measure mode onset (a2 starting at beat 3)
 *   - N-way condensing (3 horns, 4 horns)
 *   - Partial unison (1.2. a2, 3. solo)
 *   - String section idiom (Unis. / Div.)
 *   - Conflicting dynamics force divisi
 *   - Mid-bar condensing change (Workstream A)
 *
 * The Rust analyzer + label engraver in
 * `engine/viritura-engine/src/layout/condensing.rs` is the system under test.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview as BaseScorePreview, type ScorePreviewProps } from "../storyFixtures/ScorePreview";

// Engraving-matrix stories render the blue source staves below every
// condensed staff (same affordance as the editor's "expand condensed staff"
// gesture) so reviewers can see source material alongside the condensed
// result without leaving the story.
const ScorePreview = (props: ScorePreviewProps) => <BaseScorePreview expandCondensingSources {...props} />;

const meta: Meta = {
  title: "App/Condensing/Engraving Matrix",
  parameters: {
    docs: {
      description: {
        component:
          "Each story renders a synthetic MNX score targeting one specific " +
          "condensing-engraving case. Use these to verify the Rust analyzer " +
          "and label placement loop in `condensing.rs` / `mnx_layout.rs`.",
      },
    },
  },
};
export default meta;

// ═══════════════════════════════════════════════════
// Builder helpers — reduce per-story boilerplate
// ═══════════════════════════════════════════════════

type Step = "A" | "B" | "C" | "D" | "E" | "F" | "G";
type Base = "whole" | "half" | "quarter" | "eighth" | "16th";

interface NoteSpec {
  step: Step;
  octave: number;
  alter?: number;
  id?: string;
  ties?: { target: string }[];
}
interface SlurSpec {
  target: string;
  side?: "up" | "down";
}
interface EvSpec {
  d: Base;
  notes?: NoteSpec[]; // empty/undefined → rest
  dots?: number;
  marks?: Record<string, unknown>;
  id?: string;
  slurs?: SlurSpec[];
}

function ev(spec: EvSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: "event",
    duration: spec.dots ? { base: spec.d, dots: spec.dots } : { base: spec.d },
  };
  if (spec.id) out["id"] = spec.id;
  if (!spec.notes || spec.notes.length === 0) {
    out["rest"] = {};
  } else {
    out["notes"] = spec.notes.map((n) => {
      const note: Record<string, unknown> = {
        pitch: {
          step: n.step,
          octave: n.octave,
          ...(n.alter ? { alter: n.alter } : {}),
        },
      };
      if (n.id) note["id"] = n.id;
      if (n.ties && n.ties.length) note["ties"] = n.ties;
      return note;
    });
  }
  if (spec.marks) out["markings"] = spec.marks;
  if (spec.slurs && spec.slurs.length) out["slurs"] = spec.slurs;
  return out;
}

function pitch(step: Step, octave: number, alter?: number): NoteSpec {
  return { step, octave, ...(alter ? { alter } : {}) };
}

// Quick chord/note shorthands
const N = (s: Step, o: number, d: Base = "quarter"): EvSpec => ({
  d,
  notes: [{ step: s, octave: o }],
});
const R = (d: Base = "quarter"): EvSpec => ({ d });

interface PartSpec {
  id: string;
  name: string;
  shortName?: string;
  // MNX `transposition.interval`: chromatic = halfSteps, diatonic = staffDistance.
  // Example for Horn in F: { chromatic: -7, diatonic: -4 }.
  transpose?: { chromatic: number; diatonic: number };
  measures: EvSpec[][]; // [measure][event] — single sequence per measure
  // Optional per-measure `_x.viritura.condensingOverride`. Length should
  // match `measures.length`; entries may be undefined to skip.
  condensingOverride?: (string | undefined)[];
}

function part(p: PartSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    shortName: p.shortName ?? p.name.slice(0, 2) + ".",
    measures: p.measures.map((evs, mi) => {
      const m: Record<string, unknown> = {
        sequences: [{ content: evs.map((e) => ev(e)) }],
      };
      const override = p.condensingOverride?.[mi];
      if (override) {
        m["_x"] = { viritura: { condensingOverride: override } };
      }
      return m;
    }),
  };
  if (p.transpose) {
    // MNX spec key is `transposition`, with `interval.halfSteps` /
    // `interval.staffDistance` — not the MusicXML-style `transpose.chromatic` /
    // `transpose.diatonic`. Using the wrong key surfaces as a schema error in
    // the MNX source panel ("transpose: property not allowed").
    //
    // Direction also flips: MusicXML's `<transpose>` is written → sounding
    // (Horn in F = chromatic -7), but MNX's `transposition.interval` is
    // sounding → written (Horn in F = halfSteps +7, staffDistance +4). The
    // engine reads it as sounding-→-written (see
    // `engine/viritura-engine/src/model/pitch.rs` — "F horn: sounding C4 →
    // written G4 (staffDistance=4, halfSteps=7)"). PartSpec keeps the
    // MusicXML-style negative convention for ergonomic story authoring; we
    // negate here so a Horn-in-F spec actually renders as a Horn in F (G in
    // written pitches) rather than a Horn in G (D in written pitches).
    out["transposition"] = {
      interval: {
        halfSteps: -p.transpose.chromatic,
        staffDistance: -p.transpose.diatonic,
      },
    };
  }
  return out;
}

interface StaffSpec {
  label?: string;
  shortLabel?: string;
  sources: { part: string }[];
  // Override the stacked numeric column on the staff label (e.g. `[2, 1]`
  // displays "2./1." instead of the auto-derived "1./2."). Used to indicate
  // voice crossings when the parts render chord-merged in a single voice.
  condensedNumbers?: number[];
  // Override the stacked numeric column with grouped rows (e.g. `[[3], [1, 2]]`
  // displays "3" on top, "1·2" below). Used for partial-unison voicings where
  // one source plays a distinct upper voice over a unison group below.
  // When set, takes precedence over `condensedNumbers` for row composition.
  condensedNumberRows?: number[][];
}

interface ScoreBuildSpec {
  measureCount: number;
  time?: { count: number; unit: number };
  key?: { fifths: number };
  parts: PartSpec[];
  // simple flat layout: one entry per condensed staff
  staves: StaffSpec[];
  // optional layout changes at specific measures (workstream A demo)
  layoutChanges?: Array<{ atMeasure: number; layoutId: string; position?: [number, number] }>;
  altLayouts?: Array<{ id: string; staves: StaffSpec[] }>;
}

function buildScore(spec: ScoreBuildSpec): string {
  const measures: Record<string, unknown>[] = [];
  for (let i = 0; i < spec.measureCount; i++) {
    if (i === 0) {
      measures.push({
        time: spec.time ?? { count: 4, unit: 4 },
        key: spec.key ?? { fifths: 0 },
      });
    } else {
      measures.push({});
    }
  }

  const layouts: Record<string, unknown>[] = [
    {
      id: "cond",
      content: spec.staves.map((s) => ({
        type: "staff",
        ...(s.label ? { label: s.label } : { labelref: "shortName" }),
        ...(s.shortLabel ? { shortLabel: s.shortLabel } : {}),
        ...(s.condensedNumbers ? { _condensedNumbers: s.condensedNumbers } : {}),
        ...(s.condensedNumberRows ? { _condensedNumberRows: s.condensedNumberRows } : {}),
        sources: s.sources,
      })),
    },
  ];
  if (spec.altLayouts) {
    for (const al of spec.altLayouts) {
      layouts.push({
        id: al.id,
        content: al.staves.map((s) => ({
          type: "staff",
          ...(s.label ? { label: s.label } : { labelref: "shortName" }),
          ...(s.shortLabel ? { shortLabel: s.shortLabel } : {}),
          ...(s.condensedNumbers ? { _condensedNumbers: s.condensedNumbers } : {}),
          ...(s.condensedNumberRows ? { _condensedNumberRows: s.condensedNumberRows } : {}),
          sources: s.sources,
        })),
      });
    }
  }

  const system: Record<string, unknown> = { measure: "0", layout: "cond" };
  if (spec.layoutChanges?.length) {
    system["layoutChanges"] = spec.layoutChanges.map((lc) => ({
      layout: lc.layoutId,
      location: {
        measure: String(lc.atMeasure),
        ...(lc.position ? { position: { fraction: lc.position } } : {}),
      },
    }));
  }

  // If any part declares a transposition, default the score to written
  // pitches — that's what a real transposed score looks like (Horns in F
  // notated a P5 above sounding). Stories can still opt out by editing the
  // MNX live in the Monaco side-panel.
  const anyTransposed = spec.parts.some((p) => p.transpose);

  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures },
      parts: spec.parts.map(part),
      layouts,
      scores: [
        {
          name: "Condensed",
          ...(anyTransposed ? { useWritten: true } : {}),
          pages: [{ systems: [system] }],
        },
      ],
    },
    null,
    2,
  );
}

// ═══════════════════════════════════════════════════
// 1. INITIAL MEASURE a2 — m1 should print "a 2"
// ═══════════════════════════════════════════════════

export const InitialMeasureA2: StoryObj = {
  name: "Initial-measure 'a 2' — both flutes identical from m1",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "half"), N("A", 5, "half")],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "half"), N("A", 5, "half")],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// 2. MID-MEASURE a2 ONSET — beat 3 of m3 (Beethoven 5 case)
// ═══════════════════════════════════════════════════

export const MidMeasureA2Onset: StoryObj = {
  name: "Mid-measure 'a 2' — onset at beat 3 (Beethoven 5 m3)",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 3,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              // m1: a2
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              // m2: divergent rhythms (divisi)
              [N("G", 5, "half"), N("A", 5), N("B", 5)],
              // m3: divergent beats 1-2, unison from beat 3
              [N("C", 5, "half"), N("D", 5), N("E", 5)],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("E", 5), N("F", 5), N("G", 5), N("A", 5)],
              // m3: different beats 1-2, same as fl1 from beat 3
              [N("A", 4), N("B", 4), N("D", 5), N("E", 5)],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// 3. N-WAY: a3 — 3 horns in unison
// ═══════════════════════════════════════════════════

export const A3ThreeHorns: StoryObj = {
  name: "'a 3' — three horns in unison",
  render: () => {
    const horn = (id: string, _name: string): PartSpec => ({
      id,
      name: "Horn",
      shortName: "Hn.",
      transpose: { chromatic: -7, diatonic: -4 }, // Horn in F
      // Sounding pitches — written = sounding + P5 for Horn in F.
      // Keep concert pitches inside roughly C4–C5 so the written-pitch
      // rendering (G4–G5) sits on the treble staff.
      measures: [
        [N("G", 4), N("E", 4), N("C", 4), N("E", 4)],
        [N("G", 4, "half"), N("F", 4, "half")],
      ],
    });
    return (
      <ScorePreview
        mnxJson={buildScore({
          measureCount: 2,
          parts: [horn("h1", "Hn.1"), horn("h2", "Hn.2"), horn("h3", "Hn.3")],
          staves: [
            {
              sources: [{ part: "h1" }, { part: "h2" }, { part: "h3" }],
            },
          ],
        })}
      />
    );
  },
};

// ═══════════════════════════════════════════════════
// 4. N-WAY: a4 — 4 horns in unison
// ═══════════════════════════════════════════════════

export const A4FourHorns: StoryObj = {
  name: "'a 4' — four horns in unison (Mahler/Strauss idiom)",
  render: () => {
    const horn = (id: string, _name: string): PartSpec => ({
      id,
      name: "Horn",
      shortName: "Hn.",
      transpose: { chromatic: -7, diatonic: -4 },
      // See A3ThreeHorns above — sounding C4-ish keeps written pitches
      // around G4–G5, the heart of the horn's treble range.
      measures: [[N("G", 4), N("E", 4), N("C", 4), N("E", 4)], [N("D", 4, "whole")]],
    });
    return (
      <ScorePreview
        mnxJson={buildScore({
          measureCount: 2,
          parts: [horn("h1", "Hn.1"), horn("h2", "Hn.2"), horn("h3", "Hn.3"), horn("h4", "Hn.4")],
          staves: [
            {
              sources: [{ part: "h1" }, { part: "h2" }, { part: "h3" }, { part: "h4" }],
            },
          ],
        })}
      />
    );
  },
};

// ═══════════════════════════════════════════════════
// 5. PARTIAL UNISON — Hn 1+2 in unison, Hn 3 solo on top
// ═══════════════════════════════════════════════════

export const PartialUnison: StoryObj = {
  name: "Partial unison — '1.2. a 2' + '3. solo'",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "h1",
            name: "Horn",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("C", 4), N("D", 4), N("E", 4), N("F", 4)], [N("G", 4, "whole")]],
          },
          {
            id: "h2",
            name: "Horn",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("C", 4), N("D", 4), N("E", 4), N("F", 4)], [N("G", 4, "whole")]],
          },
          {
            id: "h3",
            name: "Horn",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("G", 4), N("A", 4), N("B", 4), N("C", 5)], [N("D", 5, "whole")]],
          },
        ],
        staves: [
          {
            // Note: no explicit label or condensedNumberRows — the engine
            // auto-detects the partial-unison voicing (h1+h2 share C4 while
            // h3 plays G4) and emits a stacked label "3" / "1·2" reflecting
            // the voice partition that isn't discernable from the amalgamated
            // chord alone.
            sources: [{ part: "h1" }, { part: "h2" }, { part: "h3" }],
          },
        ],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// CONFLICTING DYNAMICS force divisi
// ═══════════════════════════════════════════════════

export const ConflictingDynamics: StoryObj = {
  name: "Conflicting dynamics force divisi (Fl.1 ff, Fl.2 pp)",
  render: () => {
    // Build by hand because we need dynamics directions
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              {
                dynamics: [
                  {
                    id: "flute-1-ff",
                    type: "immediate",
                    value: "ff",
                    position: { fraction: [0, 1] },
                  },
                ],
                sequences: [
                  {
                    content: [ev(N("C", 5)), ev(N("D", 5)), ev(N("E", 5)), ev(N("F", 5))],
                  },
                ],
              },
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              {
                dynamics: [
                  {
                    id: "flute-2-pp",
                    type: "immediate",
                    value: "pp",
                    position: { fraction: [0, 1] },
                  },
                ],
                sequences: [
                  {
                    content: [ev(N("C", 5)), ev(N("D", 5)), ev(N("E", 5)), ev(N("F", 5))],
                  },
                ],
              },
            ],
          },
        ],
        layouts: [
          {
            id: "cond",
            content: [
              {
                type: "staff",
                sources: [{ part: "fl1" }, { part: "fl2" }],
              },
            ],
          },
        ],
        scores: [
          {
            name: "Condensed",
            pages: [{ systems: [{ measure: "0", layout: "cond" }] }],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
};

// ═══════════════════════════════════════════════════
// 8. MID-BAR CONDENSING CHANGE — grouping shifts at beat 3
// (Workstream A — requires `position.fraction` on layoutChanges)
// ═══════════════════════════════════════════════════

export const MidBarCondensingChange: StoryObj = {
  name: "Mid-bar condensing change — Fl.1+2 → Fl.1 + Fl.2 at beat 3",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "half"), N("A", 5, "half")],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("E", 5, "half"), N("F", 5, "half")],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
        altLayouts: [
          {
            id: "split",
            staves: [{ sources: [{ part: "fl1" }] }, { sources: [{ part: "fl2" }] }],
          },
        ],
        layoutChanges: [
          // Switch to split layout at beat 3 of measure 0 (position 1/2 of measure)
          { atMeasure: 0, layoutId: "split", position: [1, 2] },
        ],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// 9. CHANGE AT SYSTEM BREAK — Fl.1+2+3 condensed → split mid-piece
// ═══════════════════════════════════════════════════

export const ChangeAcrossSystems: StoryObj = {
  name: "Layout change at barline — 3 condensed → 3 separate at m3",
  // The `location` object on layoutChanges currently omits the optional
  // `position` field; opt out of strict MNX validation until the builder
  // emits a `position.fraction` (Workstream A).
  parameters: { mnxValidation: false },
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 4,
        parts: [
          {
            id: "f1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "whole")],
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "whole")],
            ],
          },
          {
            id: "f2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("E", 5, "whole")],
              [N("A", 5), N("B", 5), N("C", 6), N("D", 6)],
              [N("E", 6, "whole")],
            ],
          },
          {
            id: "f3",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("C", 5, "whole")],
              [N("F", 4), N("G", 4), N("A", 4), N("B", 4)],
              [N("C", 5, "whole")],
            ],
          },
        ],
        staves: [
          {
            sources: [{ part: "f1" }, { part: "f2" }, { part: "f3" }],
          },
        ],
        altLayouts: [
          {
            id: "split",
            staves: [{ sources: [{ part: "f1" }] }, { sources: [{ part: "f2" }] }, { sources: [{ part: "f3" }] }],
          },
        ],
        layoutChanges: [{ atMeasure: 2, layoutId: "split" }],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// RHYTHM MISMATCH — must render as divisi even when pitches OK
// ═══════════════════════════════════════════════════

export const RhythmMismatchDivisi: StoryObj = {
  name: "Rhythm mismatch → divisi (stem up/down voices)",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("C", 5), N("D", 5), N("E", 5), N("F", 5)]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("E", 5, "half"), N("F", 5, "half")]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// 12. SOLO ALTERNATION — Hn.1 plays m1, Hn.2 plays m2
// ═══════════════════════════════════════════════════

export const SoloAlternation: StoryObj = {
  name: "Solo alternation — '1.' → '2.' → 'a 2'",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 3,
        parts: [
          {
            id: "h1",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("C", 4), N("D", 4), N("E", 4), N("F", 4)], [R("whole")], [N("G", 4, "whole")]],
          },
          {
            id: "h2",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[R("whole")], [N("E", 4), N("F", 4), N("G", 4), N("A", 4)], [N("G", 4, "whole")]],
          },
        ],
        staves: [{ sources: [{ part: "h1" }, { part: "h2" }] }],
      })}
    />
  ),
};

// ═══════════════════════════════════════════════════
// 13. SHARED ARTICULATIONS amalgamate cleanly (staccato a2)
// ═══════════════════════════════════════════════════

export const SharedArticulationsAmalgamate: StoryObj = {
  name: "Shared articulations — staccato on both sources → amalgamates",
  render: () => {
    const stac = { staccato: {} } as Record<string, unknown>;
    return (
      <ScorePreview
        mnxJson={buildScore({
          measureCount: 1,
          parts: [
            {
              id: "fl1",
              name: "Flute",
              shortName: "Fl.",
              measures: [
                [
                  { d: "quarter", notes: [pitch("C", 5)], marks: stac },
                  { d: "quarter", notes: [pitch("D", 5)], marks: stac },
                  { d: "quarter", notes: [pitch("E", 5)], marks: stac },
                  { d: "quarter", notes: [pitch("F", 5)], marks: stac },
                ],
              ],
            },
            {
              id: "fl2",
              name: "Flute",
              shortName: "Fl.",
              measures: [
                [
                  { d: "quarter", notes: [pitch("E", 4)], marks: stac },
                  { d: "quarter", notes: [pitch("F", 4)], marks: stac },
                  { d: "quarter", notes: [pitch("G", 4)], marks: stac },
                  { d: "quarter", notes: [pitch("A", 4)], marks: stac },
                ],
              ],
            },
          ],
          staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
        })}
      />
    );
  },
};

// ═══════════════════════════════════════════════════
// 14. CONFLICTING ARTICULATIONS force divisi (one staccato, one tenuto)
// ═══════════════════════════════════════════════════

export const ConflictingArticulations: StoryObj = {
  name: "Conflicting articulations force divisi",
  render: () => {
    const stac = { staccato: {} } as Record<string, unknown>;
    const ten = { tenuto: {} } as Record<string, unknown>;
    return (
      <ScorePreview
        mnxJson={buildScore({
          measureCount: 1,
          parts: [
            {
              id: "fl1",
              name: "Flute",
              shortName: "Fl.",
              measures: [
                [
                  { d: "quarter", notes: [pitch("C", 5)], marks: stac },
                  { d: "quarter", notes: [pitch("D", 5)], marks: stac },
                  { d: "quarter", notes: [pitch("E", 5)], marks: stac },
                  { d: "quarter", notes: [pitch("F", 5)], marks: stac },
                ],
              ],
            },
            {
              id: "fl2",
              name: "Flute",
              shortName: "Fl.",
              measures: [
                [
                  { d: "quarter", notes: [pitch("C", 5)], marks: ten },
                  { d: "quarter", notes: [pitch("D", 5)], marks: ten },
                  { d: "quarter", notes: [pitch("E", 5)], marks: ten },
                  { d: "quarter", notes: [pitch("F", 5)], marks: ten },
                ],
              ],
            },
          ],
          staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
        })}
      />
    );
  },
};

// ═══════════════════════════════════════════════════
// 15. AMALGAMATE → UNISON TRAIL — first half harmony, second half unison
// ═══════════════════════════════════════════════════

export const AmalgamateUnisonTrail: StoryObj = {
  name: "Amalgamate→unison trail — 'a 2' onset mid-bar after harmony",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("C", 5), N("D", 5), N("E", 5), N("F", 5)]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("A", 4), N("B", 4), N("E", 5), N("F", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// ╔═══════════════════════════════════════════════════════════════╗
// ║  Stave-sharing rules (standard engraving practice)             ║
// ║                                                                ║
// ║  Each story below targets a single stave-sharing rule. Rule    ║
// ║  IDs `SS-NN` are local labels used by this fixture set.        ║
// ║  Several stories describe behaviour the engine does not yet    ║
// ║  implement and serve as visual fixtures the engraver should    ║
// ║  grow to match.                                                ║
// ╚═══════════════════════════════════════════════════════════════╝

// Voice crossing (default) — when the parts cross, the engine splits them
// into separate divisi voices with stems by part assignment (1st up, 2nd
// down). The stem direction itself communicates which voice is on top at
// any moment, so no label gymnastics are needed.
export const VoiceCrossSeparateVoices: StoryObj = {
  name: "Voice cross — separate voices (default; stems show part assignment)",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            // 1st descends through 2nd's range
            measures: [[N("G", 5), N("E", 5), N("C", 5), N("A", 4)]],
            condensingOverride: ["divisi"],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            // 2nd ascends through 1st's range
            measures: [[N("A", 4), N("C", 5), N("E", 5), N("G", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// Voice crossing (label idiom) — alternative engraving choice: keep the
// parts chord-merged on a single voice and indicate the inversion by
// flipping the stacked numeric column on the staff label from "1./2."
// to "2./1." This is the convention used when stems would otherwise be
// ambiguous or when editorial preference favours a single line.
export const VoiceCrossInvertedLabel: StoryObj = {
  name: "Voice cross — chord-merged with inverted '2./1.' label",
  // Uses the Viritura `_condensedNumbers` staff extension which is not
  // yet wrapped under `_x.viritura`; opt out of strict MNX validation
  // until the vendor-extension migration covers staff-level keys.
  parameters: { mnxValidation: false },
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("G", 5), N("E", 5), N("C", 5), N("A", 4)]],
            condensingOverride: ["amalgamate"],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("A", 4), N("C", 5), N("E", 5), N("G", 5)]],
          },
        ],
        staves: [
          {
            sources: [{ part: "fl1" }, { part: "fl2" }],
            // Flip the stacked numeric column to "2./1." to indicate the
            // upper notehead is now Flute 2 and the lower is Flute 1.
            condensedNumbers: [2, 1],
          },
        ],
      })}
    />
  ),
};

// SS-07 — Only one part is tied across the bar. The tied part must take a
// separate stem at the tied note even though both parts are otherwise
// in rhythmic unison.
export const OneSidedTieSeparateStem: StoryObj = {
  name: "SS-07 — One-sided tie forces separate stem on tied note",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [
                N("C", 5),
                N("D", 5),
                {
                  d: "half",
                  notes: [
                    {
                      step: "E",
                      octave: 5,
                      id: "fl1_tied",
                      ties: [{ target: "fl1_tied_target" }],
                    },
                  ],
                },
              ],
              // Tied target — fl1's E5 sustains into m2 beat 1.
              [
                {
                  d: "quarter",
                  notes: [{ step: "E", octave: 5, id: "fl1_tied_target" }],
                },
                N("D", 5),
                N("C", 5),
                N("B", 4),
              ],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            // fl2 retakes the note on m2 beat 1 (no tie). Same rhythm in m1,
            // but fl1's tie forces separate stems on the half-note.
            measures: [
              [N("C", 5), N("D", 5), { d: "half", notes: [pitch("E", 5)] }],
              [N("E", 5), N("D", 5), N("C", 5), N("B", 4)],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
  // NOTE: tied note carries `id` on fl1's half-note (`fl1_tied`) with a `ties`
  // entry pointing at fl1's m2 beat-1 note (`fl1_tied_target`). fl2 retakes
  // E5 with no tie — standard engraving requires separate stems on m1's half so fl1's tie
  // is unambiguous. The engine must split the otherwise-unison chord into
  // two stems whenever one source ties forward and the other doesn't.
};

// SS-05 — Same rhythm, different slur boundaries → separate stems.
export const DifferentSlurLengthsForceDivisi: StoryObj = {
  name: "SS-05 — Different slur lengths force separate stems",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            // Slur from ev1 → ev2 (first two notes)
            measures: [
              [
                { d: "quarter", notes: [pitch("C", 5)], id: "g5_fl1_1", slurs: [{ target: "g5_fl1_2" }] },
                { d: "quarter", notes: [pitch("D", 5)], id: "g5_fl1_2" },
                { d: "quarter", notes: [pitch("E", 5)] },
                { d: "quarter", notes: [pitch("F", 5)] },
              ],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            // Slur spans all four notes
            measures: [
              [
                { d: "quarter", notes: [pitch("C", 5)], id: "g5_fl2_1", slurs: [{ target: "g5_fl2_4" }] },
                { d: "quarter", notes: [pitch("D", 5)] },
                { d: "quarter", notes: [pitch("E", 5)] },
                { d: "quarter", notes: [pitch("F", 5)], id: "g5_fl2_4" },
              ],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-08 — Mid-phrase entry: fl1 plays beats 1–2 (with its own slur), fl2
// joins at beat 3. Expected labels: "1." at fl1's opening, "a 2" at the
// merge in beat 3.
export const MidPhraseEntryLabels: StoryObj = {
  name: "SS-08 — Mid-phrase entry: '1.' at start, 'a 2' at merge",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [
                { d: "quarter", notes: [pitch("C", 5)], id: "g8_a", slurs: [{ target: "g8_b" }] },
                { d: "quarter", notes: [pitch("D", 5)], id: "g8_b" },
                N("E", 5),
                N("F", 5),
              ],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[R(), R(), N("E", 5), N("F", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-09–11 — A short rhythm mismatch in the middle of an otherwise-unison
// phrase: prefer keeping two stems for the whole phrase rather than
// flipping single ↔ double stems repeatedly. Story sets up a 4-bar
// phrase that's identical except for m2 (fl2 has eighths against fl1's
// quarters). Expected engraving: two stems for all four bars.
export const StableStemsAcrossRhythmMismatch: StoryObj = {
  name: "SS-09–11 — Keep two stems through an otherwise-unison phrase",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 4,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5), N("A", 5), N("G", 5), N("F", 5)],
              [N("E", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "half"), N("C", 5, "half")],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              // Rhythm mismatch here: eighths vs fl1's quarters
              [
                N("G", 5, "eighth"),
                N("F", 5, "eighth"),
                N("A", 5, "eighth"),
                N("G", 5, "eighth"),
                N("G", 5),
                N("F", 5),
              ],
              [N("E", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5, "half"), N("C", 5, "half")],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-14 — A label is required at every entry after a tacet/division. m1:
// only fl1 plays (label "1."). m2: fl2 enters in unison (label "a 2"
// REQUIRED — without this the reader can't tell whether fl2's m1 rest
// is real silence or a divisi rest).
export const EntryLabelAfterTacet: StoryObj = {
  name: "SS-14 — Label required at every entry after tacet",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5), N("A", 5), N("B", 5), N("C", 6)],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[R("whole")], [N("G", 5), N("A", 5), N("B", 5), N("C", 6)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-15 — Long unison passage that wraps across multiple systems. Expected:
// the doubling indication "(a 2)" repeats in brackets at the start of
// every new system / after a page-turn. (Engine work pending — for now
// this story documents the visual target.)
export const RepeatLabelAtSystemBreak: StoryObj = {
  name: "SS-15 — Repeat '(a 2)' at start of every new system",
  render: () => {
    const longRun: EvSpec[] = [N("C", 5), N("D", 5), N("E", 5), N("F", 5)];
    return (
      <ScorePreview
        mnxJson={buildScore({
          measureCount: 12,
          parts: [
            {
              id: "fl1",
              name: "Flute",
              shortName: "Fl.",
              measures: Array.from({ length: 12 }, () => longRun),
            },
            {
              id: "fl2",
              name: "Flute",
              shortName: "Fl.",
              measures: Array.from({ length: 12 }, () => longRun),
            },
          ],
          staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
        })}
      />
    );
  },
};

// SS-16 — Short occasional unison, woodwind/brass form: two noteheads on
// one stem for a single beat in an otherwise-divisi phrase.
//
// Per standard engraving the sandwich unison on beat 3 should render with split stems
// for just that event. Until the renderer supports per-event stem
// splitting inside an otherwise-amalgamated voice, we prefer Amalgamate
// for the whole measure — the unison beat collapses to a single shared
// notehead+stem. The `has_disallowed_unison_layout` analyzer in
// `condensing.rs` is retained for the future per-event split-stem path.
export const SandwichedUnisonStaysAmalgamate: StoryObj = {
  name: "SS-16 — Sandwiched unison stays amalgamate (shared notehead, single stem)",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            // Divisi at a third except beat 3 where both play E5
            measures: [[N("C", 5), N("D", 5), N("E", 5), N("F", 5)]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("A", 4), N("B", 4), N("E", 5), N("D", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-16b — Edge-anchored unison span IS allowed: a trailing unison
// (Amalgamate, Amalgamate, Unison, Unison) stays Amalgamate (single
// stem; the unison beats render as a single shared notehead).
export const EdgeAnchoredUnisonStaysAmalgamate: StoryObj = {
  name: "SS-16b — Edge-anchored unison (trailing) stays amalgamate",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            // Last two beats unison (E5, F5)
            measures: [[N("C", 5), N("D", 5), N("E", 5), N("F", 5)]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("A", 4), N("B", 4), N("E", 5), N("F", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-17 — Same situation but strings. Unison on beat 3 MUST render as two
// stems (single stem would read as a double-stop on two strings).
// OMITTED: strings-section behaviour is out of scope for now.
// (Kept as a const so the fixture isn't lost; not exported.)
const _StringUnisonTwoStemsOmitted: StoryObj = {
  name: "SS-17 — Short unison in strings must use two stems (not double-stop)",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "v1",
            name: "Violin",
            shortName: "Vln.",
            measures: [[N("C", 5), N("D", 5), N("E", 5), N("F", 5)]],
          },
          {
            id: "v2",
            name: "Violin",
            shortName: "Vln.",
            measures: [[N("A", 4), N("B", 4), N("E", 5), N("D", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "v1" }, { part: "v2" }] }],
      })}
    />
  ),
};

// SS-20 — Four parts on one stave, default allocation: 1.2 up / 3.4 down.
export const FourPartsDefault12Up34Down: StoryObj = {
  name: "SS-20 — Four parts default: 1.2 up / 3.4 down",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "h1",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("G", 4), N("A", 4), N("B", 4), N("C", 5)]],
          },
          {
            id: "h2",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("E", 4), N("F", 4), N("G", 4), N("A", 4)]],
          },
          {
            id: "h3",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("C", 4), N("D", 4), N("E", 4), N("F", 4)]],
          },
          {
            id: "h4",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("A", 3), N("B", 3), N("C", 4), N("D", 4)]],
          },
        ],
        staves: [{ sources: [{ part: "h1" }, { part: "h2" }, { part: "h3" }, { part: "h4" }] }],
      })}
    />
  ),
};

// SS-21 — Outer pairs (1+4 / 2+3) share rhythm. Stem 1.4 up, 2.3 down.
export const FourPartsOuterPairs14Up23Down: StoryObj = {
  name: "SS-21 — Four parts, outer pairs: 1.4 up / 2.3 down",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          // 1 & 4 share quarter-note rhythm
          {
            id: "h1",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("G", 4), N("A", 4), N("B", 4), N("C", 5)]],
          },
          // 2 & 3 share half-note rhythm
          {
            id: "h2",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("E", 4, "half"), N("F", 4, "half")]],
          },
          {
            id: "h3",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("C", 4, "half"), N("D", 4, "half")]],
          },
          {
            id: "h4",
            name: "Horn",
            shortName: "Hn.",
            transpose: { chromatic: -7, diatonic: -4 },
            measures: [[N("A", 3), N("B", 3), N("C", 4), N("D", 4)]],
          },
        ],
        staves: [{ sources: [{ part: "h1" }, { part: "h2" }, { part: "h3" }, { part: "h4" }] }],
      })}
    />
  ),
};

// SS-24 — Numeral placement: prefer to the left of notes when there is
// room; fall back to above-stave when the left margin is congested.
// Story renders two systems' worth of rapid label changes; visual review
// confirms placement strategy.
export const CondensedNumeralPlacement: StoryObj = {
  name: "SS-24 — Numeral placement: left of notes vs. above stave",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 4,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [R("whole")],
              [N("G", 5), N("A", 5), N("G", 5), N("F", 5)],
              [N("E", 5), N("F", 5), N("G", 5), N("A", 5)],
            ],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [R("whole")],
              [N("A", 4), N("B", 4), N("C", 5), N("D", 5)],
              [R("whole")],
              [N("E", 5), N("F", 5), N("G", 5), N("A", 5)],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-26 — Separately stemmed parts share rests where possible. m1 is
// divisi (separate stems), m2 both parts rest: should print as a single
// whole-bar rest, NOT one rest above and one below.
export const SeparateStemsShareRests: StoryObj = {
  name: "SS-26 — Separately stemmed parts share rests",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("E", 5), N("F", 5), N("G", 5), N("A", 5)], [R("whole")]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("C", 5), N("D", 5), N("E", 5), N("F", 5)], [R("whole")]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-27 — All parts tacet: one whole-bar rest serves the whole stave.
export const AllPartsShareWholeBarRest: StoryObj = {
  name: "SS-27 — All parts tacet → single shared whole-bar rest",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          { id: "fl1", name: "Flute", shortName: "Fl.", measures: [[R("whole")]] },
          { id: "fl2", name: "Flute", shortName: "Fl.", measures: [[R("whole")]] },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-29 — Traditional tacet layout: an explicit whole-bar rest for each
// tacet player. m1 fl2 plays alone; fl1 has an explicit rest.
export const TraditionalTacetRest: StoryObj = {
  name: "SS-29 — Tacet (traditional) — explicit rest per tacet player",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[R("whole")], [N("G", 5), N("A", 5), N("G", 5), N("F", 5)]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5), N("A", 5), N("G", 5), N("F", 5)],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-30 — Alternative tacet layout: omit the tacet whole-bar rest entirely
// and label only the active player. (Same MNX as SS-29; engraving option
// differs — engine should expose this as a style toggle.)
export const OmittedTacetRest: StoryObj = {
  name: "SS-30 — Tacet (alternative) — omit rest, label '2.' active",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 2,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[R("whole")], [N("G", 5), N("A", 5), N("G", 5), N("F", 5)]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [
              [N("C", 5), N("D", 5), N("E", 5), N("F", 5)],
              [N("G", 5), N("A", 5), N("G", 5), N("F", 5)],
            ],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
  // NOTE: stylistic alternative to SS-29. Distinguished from SS-29 by a
  // forthcoming `condensingStyle: "omitTacetRests"` engine option.
};

// SS-32 — Mid-system stem-direction reversal requires an intervening rest.
// Story: fl1 plays beats 1–2, rests on beat 3, then fl2 enters on beat 4
// while fl1 is silent — providing the required rest between same-direction
// stems.
export const MidSystemStemReversalNeedsRest: StoryObj = {
  name: "SS-32 — Mid-system stem reversal needs intervening rest",
  render: () => (
    <ScorePreview
      mnxJson={buildScore({
        measureCount: 1,
        parts: [
          {
            id: "fl1",
            name: "Flute",
            shortName: "Fl.",
            measures: [[N("C", 5), N("D", 5), R(), R()]],
          },
          {
            id: "fl2",
            name: "Flute",
            shortName: "Fl.",
            measures: [[R(), R(), N("E", 5), N("F", 5)]],
          },
        ],
        staves: [{ sources: [{ part: "fl1" }, { part: "fl2" }] }],
      })}
    />
  ),
};

// SS-33 — Both parts share a single 'con sord.' text expression on the stave.
// MNX core has no mute concept, so this uses the Viritura vendor extension
// `_x.viritura.expressions` (see packages/format/schemas/viritura-extensions.json).
// Hand-built because the story builder doesn't emit per-measure expressions yet.
export const SharedMuteExpression: StoryObj = {
  name: "SS-33 — Shared 'con sord.' on common-stem parts",
  render: () => {
    const conSord = {
      _x: {
        viritura: {
          expressions: [{ text: "con sord.", position: { fraction: [0, 1] }, placement: "below" }],
        },
      },
      sequences: [{ content: [ev(N("G", 4)), ev(N("A", 4)), ev(N("B", 4)), ev(N("C", 5))] }],
    } as Record<string, unknown>;
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
        parts: [
          {
            id: "h1",
            name: "Horn",
            shortName: "Hn.",
            transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
            measures: [conSord],
          },
          {
            id: "h2",
            name: "Horn",
            shortName: "Hn.",
            transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
            measures: [conSord],
          },
        ],
        layouts: [{ id: "cond", content: [{ type: "staff", sources: [{ part: "h1" }, { part: "h2" }] }] }],
        scores: [{ name: "Condensed", useWritten: true, pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  // NOTE: when both parts on a shared stem carry the same mute state,
  // engraver should emit ONE 'con sord.' on the dynamic side of the stem.
};

// SS-34 — Mute states differ → separate stems and separate labels (one above
// for up-stem player, one below for down-stem player). Same vendor-extension
// approach as SS-33 (`_x.viritura.expressions`) since MNX core has no mute concept.
export const DifferentMuteExpressions: StoryObj = {
  name: "SS-34 — Different mutes → separate stems, label per part",
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
        parts: [
          {
            id: "h1",
            name: "Horn",
            shortName: "Hn.",
            transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
            measures: [
              {
                _x: {
                  viritura: {
                    expressions: [{ text: "con sord.", position: { fraction: [0, 1] }, placement: "above" }],
                  },
                },
                sequences: [{ content: [ev(N("G", 4)), ev(N("A", 4)), ev(N("B", 4)), ev(N("C", 5))] }],
              },
            ],
          },
          {
            id: "h2",
            name: "Horn",
            shortName: "Hn.",
            transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
            measures: [
              {
                _x: {
                  viritura: {
                    expressions: [{ text: "senza sord.", position: { fraction: [0, 1] }, placement: "below" }],
                  },
                },
                sequences: [{ content: [ev(N("E", 4)), ev(N("F", 4)), ev(N("G", 4)), ev(N("A", 4))] }],
              },
            ],
          },
        ],
        layouts: [{ id: "cond", content: [{ type: "staff", sources: [{ part: "h1" }, { part: "h2" }] }] }],
        scores: [{ name: "Condensed", useWritten: true, pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
};
