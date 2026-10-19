import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Note Markings",
  component: ScorePreview,
};

export default meta;

const noteMarkingExamples = {
  mnx: { version: 1 },
  global: { measures: [{ number: 1 }] },
  parts: [
    {
      id: "p0",
      name: "Trumpet",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  id: "scoop",
                  duration: { base: "quarter" },
                  notes: [{ id: "n0", pitch: { step: "C", octave: 5 }, markings: { slideIn: { type: "scoop" } } }],
                },
                {
                  id: "plop",
                  duration: { base: "quarter" },
                  notes: [{ id: "n1", pitch: { step: "D", octave: 5 }, markings: { slideIn: { type: "plop" } } }],
                },
                {
                  id: "falloff",
                  duration: { base: "quarter" },
                  notes: [{ id: "n2", pitch: { step: "E", octave: 5 }, markings: { slideOut: { type: "falloff" } } }],
                },
                {
                  id: "doit",
                  duration: { base: "quarter" },
                  notes: [{ id: "n3", pitch: { step: "G", octave: 5 }, markings: { slideOut: { type: "doit" } } }],
                },
                {
                  id: "mixed-chord",
                  duration: { base: "half" },
                  notes: [
                    { id: "chord-low", pitch: { step: "C", octave: 4 }, markings: { slideIn: { type: "scoop" } } },
                    { id: "chord-high", pitch: { step: "G", octave: 4 }, markings: { slideOut: { type: "doit" } } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const AllNoteSlideTypes: StoryObj = {
  name: "All note-scoped slide types",
  render: () => <ScorePreview mnxJson={JSON.stringify(noteMarkingExamples)} />,
};
