import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

/**
 * Engrave Mode — per-system staff visibility via derived layouts.
 *
 * MNX models hidden staves by referencing a different `LayoutDefinition`
 * for the affected system. Viritura generates derived layouts on demand
 * when the user toggles staff visibility in Engrave Mode (see
 * `setStaffVisibilityInScore` and `deriveHiddenLayout`).
 */
const meta: Meta = {
  title: "App/Engrave Mode/Staff Visibility",
  component: ScorePreview,
};
export default meta;

function w(step: string, octave: number) {
  return { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step, octave } }] };
}

const measures = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i + 1}`,
  ...(i === 0 ? { time: { count: 4, unit: 4 }, key: { fifths: 0 } } : {}),
}));

function eightBars(steps: string[], octave: number) {
  return steps.map((s) => ({ sequences: [{ content: [w(s, octave)] }] }));
}

const trio = {
  mnx: { version: 1 },
  global: { measures },
  parts: [
    {
      id: "fl",
      name: "Flute",
      shortName: "Fl.",
      measures: [
        { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], sequences: [{ content: [w("G", 5)] }] },
        ...eightBars(["A", "B", "C", "D", "E", "F", "G"], 5),
      ],
    },
    {
      id: "vn",
      name: "Violin",
      shortName: "Vn.",
      measures: [
        { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], sequences: [{ content: [w("E", 5)] }] },
        ...eightBars(["F", "G", "A", "B", "C", "D", "E"], 5),
      ],
    },
    {
      id: "vc",
      name: "Cello",
      shortName: "Vc.",
      measures: [
        { clefs: [{ clef: { sign: "F", staffPosition: 2 } }], sequences: [{ content: [w("C", 3)] }] },
        ...eightBars(["D", "E", "F", "G", "A", "B", "C"], 3),
      ],
    },
  ],
  layouts: [
    {
      id: "L-trio",
      content: [
        { type: "staff", labelref: "shortName", sources: [{ part: "fl" }] },
        { type: "staff", labelref: "shortName", sources: [{ part: "vn" }] },
        { type: "staff", labelref: "shortName", sources: [{ part: "vc" }] },
      ],
    },
    {
      // Derived: flute hidden (e.g. tacet during this system).
      // The id is opaque — real engrave-mode mints a UUID v7 and tags it
      // with `_x.viritura.derived: true`. For story readability we use a
      // short hand-written id here, with the same vendor flag so the GC
      // would treat it as derived if this story round-tripped through the
      // editor.
      id: "Lx-0001",
      _x: { viritura: { derived: true } },
      content: [
        { type: "staff", labelref: "shortName", sources: [{ part: "vn" }] },
        { type: "staff", labelref: "shortName", sources: [{ part: "vc" }] },
      ],
    },
    {
      // Derived: only cello (both upper voices tacet).
      id: "Lx-0002",
      _x: { viritura: { derived: true } },
      content: [{ type: "staff", labelref: "shortName", sources: [{ part: "vc" }] }],
    },
  ],
};

// ───────────────────────────────────────────────────────────────────
// Story 1: Hide one staff on the second system
// ───────────────────────────────────────────────────────────────────

export const HideOneStaffOnSystem: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify(
        {
          ...trio,
          scores: [
            {
              name: "Engraved",
              layout: "L-trio",
              pages: [
                {
                  systems: [{ measure: "m1" }, { measure: "m5", layout: "Lx-0001" }],
                },
              ],
            },
          ],
        },
        null,
        2,
      )}
    />
  ),
  name: "Hide one staff on second system",
};

// ───────────────────────────────────────────────────────────────────
// Story 2: Progressive reveal — solo cello, add violin, add flute
// ───────────────────────────────────────────────────────────────────

export const ProgressiveReveal: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify(
        {
          ...trio,
          scores: [
            {
              name: "Engraved",
              layout: "L-trio",
              pages: [
                {
                  systems: [
                    { measure: "m1", layout: "Lx-0002" },
                    { measure: "m4", layout: "Lx-0001" },
                    { measure: "m7" },
                  ],
                },
              ],
            },
          ],
        },
        null,
        2,
      )}
    />
  ),
  name: "Progressive reveal across systems",
};
