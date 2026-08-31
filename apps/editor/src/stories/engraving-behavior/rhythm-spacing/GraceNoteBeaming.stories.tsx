import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Rhythm & Spacing/Grace-Note Beaming",
  component: ScorePreview,
};

export default meta;

export const AutoBeamedGraceNotes: StoryObj = {
  render: () => {
    // Two 16th-note grace notes with no `beams` declared. Standard engraving
    // practice beams a run of two or more eighth-or-shorter grace notes, so the
    // engine auto-beams them (suppressing the individual flags) — mirrors the
    // Rhapsody cello/bass grace pairs at m138-139.
    const mnx = JSON.stringify(
      {
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
                        type: "grace",
                        content: [
                          {
                            duration: { base: "16th" },
                            notes: [{ pitch: { step: "F", octave: 5 } }],
                          },
                          {
                            duration: { base: "16th" },
                            notes: [{ pitch: { step: "G", octave: 5, alter: -1 } }],
                          },
                        ],
                      },
                      {
                        duration: { base: "half" },
                        notes: [{ pitch: { step: "A", octave: 5, alter: -1 } }],
                      },
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
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Grace notes beamed automatically",
};
