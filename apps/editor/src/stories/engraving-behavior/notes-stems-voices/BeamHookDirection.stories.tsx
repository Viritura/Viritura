import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Notes, Stems & Voices/Beam-Hook Direction",
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

export const HookDirectionAuto: StoryObj = {
  render: () => <ScorePreview mnxJson={buildHookFixture("auto")} />,
  name: "Hook direction: auto",
};
