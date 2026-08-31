import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Slurs/Chord Slurs",
  component: ScorePreview,
};

export default meta;

/**
 * Demonstrates slur.startNote/endNote targeting specific notes within chords.
 * Here the slur connects the bottom note of the first chord (C4) to the bottom
 * note of the second chord (D4), leaving the top notes unslurred. The slur
 * naturally renders below the chord, hugging the slurred noteheads.
 */
export const ChordSpecificSlurs: StoryObj = {
  render: () => {
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      id: "ev1",
                      duration: { base: "half" },
                      notes: [
                        { id: "n1-top", pitch: { step: "G", octave: 4 } },
                        { id: "n1-bot", pitch: { step: "C", octave: 4 } },
                      ],
                      slurs: [{ target: "ev2", startNote: "n1-bot", endNote: "n2-bot" }],
                    },
                    {
                      id: "ev2",
                      duration: { base: "half" },
                      notes: [
                        { id: "n2-top", pitch: { step: "A", octave: 4 } },
                        { id: "n2-bot", pitch: { step: "D", octave: 4 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Slurs attached to specific chord notes",
};

/**
 * Two slurs on a chord: one connecting top notes and one connecting bottom notes.
 */
export const DualChordSlurs: StoryObj = {
  render: () => {
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [
                {
                  content: [
                    {
                      id: "ev1",
                      duration: { base: "half" },
                      notes: [
                        { id: "n1-top", pitch: { step: "G", octave: 4 } },
                        { id: "n1-bot", pitch: { step: "C", octave: 4 } },
                      ],
                      slurs: [
                        { target: "ev2", startNote: "n1-top", endNote: "n2-top", side: "up" },
                        { target: "ev2", startNote: "n1-bot", endNote: "n2-bot", side: "down" },
                      ],
                    },
                    {
                      id: "ev2",
                      duration: { base: "half" },
                      notes: [
                        { id: "n2-top", pitch: { step: "A", octave: 4 } },
                        { id: "n2-bot", pitch: { step: "D", octave: 4 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Slurs above and below the same chords",
};
