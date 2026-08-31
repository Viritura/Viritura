import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

/**
 * Engrave Mode — forced page/system breaks via `pages[].systems[]`.
 *
 * These stories exercise the engine path that honors authored pagination
 * (added in `compute_page_breaks_with_forced`). Compare against
 * Storybook story `MNX Spec/Layout/System Layout` which uses per-system
 * layout overrides without forced page breaks.
 */
const meta: Meta = {
  title: "App/Engrave Mode/Forced Breaks",
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

const score = {
  mnx: { version: 1 },
  global: { measures },
  parts: [
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
      id: "L",
      content: [
        { type: "staff", labelref: "shortName", sources: [{ part: "vn" }] },
        { type: "staff", labelref: "shortName", sources: [{ part: "vc" }] },
      ],
    },
  ],
};

// ───────────────────────────────────────────────────────────────────
// Story 1: System breaks every 2 measures
// ───────────────────────────────────────────────────────────────────

export const SystemBreaksEveryTwoMeasures: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify(
        {
          ...score,
          scores: [
            {
              name: "Engraved",
              layout: "L",
              pages: [
                {
                  systems: [{ measure: "m1" }, { measure: "m3" }, { measure: "m5" }, { measure: "m7" }],
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
  name: "System breaks every 2 measures",
};

// ───────────────────────────────────────────────────────────────────
// Story 2: Page break in the middle
// ───────────────────────────────────────────────────────────────────

export const PageBreakAtMidpoint: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify(
        {
          ...score,
          scores: [
            {
              name: "Engraved",
              layout: "L",
              pages: [
                {
                  systems: [{ measure: "m1" }, { measure: "m3" }],
                },
                {
                  systems: [{ measure: "m5" }, { measure: "m7" }],
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
  name: "Page break at midpoint",
};
