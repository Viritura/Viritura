import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Percussion/Drum Kit Noteheads",
  component: ScorePreview,
};
export default meta;
type Story = StoryObj;

/**
 * All seven notehead shapes supported by the `_x.viritura.notehead` vendor
 * extension on `kit-component`. MNX has no native notehead field on kit
 * components (W3C issue #249), so Viritura extends the spec here.
 *
 * Values: "normal" | "x" | "circleX" | "diamond" | "slash" | "triangleUp" | "triangleDown"
 */
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
        x: { name: "x", sound: "snd-x", staffPosition: 0, _x: { viritura: { notehead: "x" } } },
        d: { name: "diamond", sound: "snd-x", staffPosition: 0, _x: { viritura: { notehead: "diamond" } } },
        cx: { name: "circleX", sound: "snd-x", staffPosition: 0, _x: { viritura: { notehead: "circleX" } } },
        sl: { name: "slash", sound: "snd-x", staffPosition: 0, _x: { viritura: { notehead: "slash" } } },
        tu: { name: "triangleUp", sound: "snd-x", staffPosition: 0, _x: { viritura: { notehead: "triangleUp" } } },
        td: { name: "triangleDown", sound: "snd-x", staffPosition: 0, _x: { viritura: { notehead: "triangleDown" } } },
      },
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" } }],
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
