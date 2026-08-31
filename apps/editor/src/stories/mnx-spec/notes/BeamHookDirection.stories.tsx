import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Beam Hooks",
  component: ScorePreview,
};

export default meta;

/** Build a single-measure score with a given hook direction on the outer 16ths. */
function buildHookFixture(direction: "left" | "right" | "auto"): string {
  return JSON.stringify(
    {
      mnx: { support: { useBeams: true }, version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              beams: [
                {
                  events: ["ev1", "ev2", "ev3"],
                  beams: [
                    { direction, events: ["ev1"] },
                    { direction, events: ["ev3"] },
                  ],
                },
              ],
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    { id: "ev1", duration: { base: "16th" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                    { id: "ev2", duration: { base: "eighth" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                    { id: "ev3", duration: { base: "16th" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                    { duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    null,
    2,
  );
}

/**
 * MNX `beam.direction` of `"auto"` lets the engraver decide which side the
 * fractional beam (hook) points to, based on the surrounding rhythmic context.
 *
 * For a 16th–8th–16th group the engraver picks Right for the leading 16th
 * and Left for the trailing 16th — same visual result as the explicit
 * `right` / `left` rows below.
 */
export const HookDirectionRight: StoryObj = {
  render: () => <ScorePreview mnxJson={buildHookFixture("right")} />,
  name: "Hook direction: explicit right",
};

type InteractiveArgs = { direction: "left" | "right" | "auto" };

/** Pick the hook direction with a Storybook control. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try beam-hook directions",
  args: { direction: "auto" },
  argTypes: {
    direction: { control: { type: "radio" }, options: ["left", "right", "auto"] },
  },
  render: ({ direction }) => <ScorePreview mnxJson={buildHookFixture(direction)} />,
};
