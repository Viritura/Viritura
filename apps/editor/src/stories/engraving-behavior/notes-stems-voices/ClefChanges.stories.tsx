import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Notes, Stems & Voices/Clef Changes",
  component: ScorePreview,
};

export default meta;

/** Mid-bar clef changes must clear dense chord ink on both sides. */
export const MidBarDenseChords: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      support: { useBeams: true, useAccidentalDisplay: true },
      measures: [
        {
          time: { count: 4, unit: 4 },
          clefs: [
            { clef: { sign: "G", staffPosition: -2 } },
            { clef: { sign: "F", staffPosition: 2 }, position: { fraction: [1, 8] } },
          ],
          voices: [
            [
              {
                id: "dense-0",
                duration: "eighth",
                notes: [
                  { step: "B", octave: 4, alter: -1 },
                  { step: "G", octave: 4, alter: -1 },
                  { step: "D", octave: 4, alter: -1 },
                ],
              },
              {
                id: "dense-1",
                duration: "eighth",
                notes: [
                  { step: "G", octave: 4, alter: -1, accidentalDisplay: { show: true } },
                  { step: "D", octave: 4, alter: -1 },
                  { step: "B", octave: 3, alter: -1 },
                ],
              },
              {
                duration: "eighth",
                notes: [
                  { step: "D", octave: 4, alter: -1 },
                  { step: "B", octave: 3, alter: -1 },
                  { step: "G", octave: 3, alter: -1, accidentalDisplay: { show: true } },
                ],
              },
              {
                duration: "eighth",
                notes: [
                  {
                    id: "tie-source-c",
                    step: "C",
                    octave: 4,
                    alter: -1,
                    accidentalDisplay: { show: true },
                    ties: [{ target: "tie-target-c" }],
                  },
                  { id: "tie-source-f", step: "F", octave: 3, ties: [{ target: "tie-target-f" }] },
                  {
                    id: "tie-source-e",
                    step: "E",
                    octave: 3,
                    accidentalDisplay: { show: true },
                    ties: [{ target: "tie-target-e" }],
                  },
                ],
              },
              {
                duration: "eighth",
                notes: [
                  { id: "tie-target-c", step: "C", octave: 4, alter: -1 },
                  { id: "tie-target-f", step: "F", octave: 3 },
                  { id: "tie-target-e", step: "E", octave: 3 },
                ],
              },
              {
                duration: "eighth",
                notes: [{ step: "E", octave: 3, alter: -2, accidentalDisplay: { show: true } }],
              },
              {
                duration: "quarter",
                notes: [{ step: "D", octave: 3, alter: -1 }],
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Mid-bar clef between dense chords",
};
