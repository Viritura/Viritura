import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Instruments & Parts/Percussion",
  component: ScorePreview,
};
export default meta;
type Story = StoryObj;

/** A 5-piece kit playing a basic rock pattern over one bar in 4/4. */
const basicKitMnx = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 4, unit: 4 } }],
    sounds: {
      "snd-kick": { midiNumber: 36, name: "Bass Drum 1" },
      "snd-snare": { midiNumber: 38, name: "Acoustic Snare" },
      "snd-hh": { midiNumber: 42, name: "Closed Hi-Hat" },
      "snd-crash": { midiNumber: 49, name: "Crash Cymbal 1" },
    },
  },
  parts: [
    {
      id: "p1",
      name: "Drum Kit",
      kit: {
        crash: { name: "Crash", sound: "snd-crash", staffPosition: 6, _x: { viritura: { notehead: "x" } } },
        hh: { name: "Hi-Hat", sound: "snd-hh", staffPosition: 5, _x: { viritura: { notehead: "x" } } },
        snare: { name: "Snare", sound: "snd-snare", staffPosition: 1 },
        kick: { name: "Kick", sound: "snd-kick", staffPosition: -3 },
      },
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" } }],
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "kick" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "snare" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "kick" }] },
                { duration: { base: "quarter" }, kitNotes: [{ kitComponent: "snare" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
});

export const BasicKit: Story = { args: { mnxJson: basicKitMnx } };
