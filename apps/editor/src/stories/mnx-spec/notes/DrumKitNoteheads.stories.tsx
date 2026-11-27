import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Percussion/Drum Kit Noteheads",
  component: ScorePreview,
};
export default meta;
type Story = StoryObj;

const noteheadShowcaseMnx = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 7, unit: 4 } }],
    sounds: { "snd-x": { midiNumber: 38, name: "Snare" } },
  },
  parts: [
    {
      id: "p1",
      name: "Notehead Shapes",
      kit: {
        n: { name: "normal", sound: "snd-x", staffPosition: 0 },
        x: { name: "x", sound: "snd-x", staffPosition: 0, notehead: { shape: "x" } },
        d: { name: "diamond", sound: "snd-x", staffPosition: 0, notehead: { shape: "diamond" } },
        cx: { name: "circleX", sound: "snd-x", staffPosition: 0, notehead: { shape: "circleX" } },
        sl: { name: "slash", sound: "snd-x", staffPosition: 0, notehead: { shape: "slash" } },
        tu: { name: "triangleUp", sound: "snd-x", staffPosition: 0, notehead: { shape: "triangle" } },
        td: { name: "triangleDown", sound: "snd-x", staffPosition: 0, notehead: { shape: "triangleDown" } },
      },
      measures: [
        {
          clefs: [{ clef: { sign: "P", staffPosition: 0 } }],
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "n" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "x" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "d" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "cx" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "sl" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "tu" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "td" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
});

export const AllNoteheadShapes: Story = { args: { mnxJson: noteheadShowcaseMnx } };
