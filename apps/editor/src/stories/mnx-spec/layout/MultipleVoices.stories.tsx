import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Multiple Voices",
  component: ScorePreview,
};

export default meta;

export const TwoVoices: StoryObj = {
  render: () => {
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
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "B", octave: 4 } }] },
                    ],
                  },
                  {
                    content: [
                      { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                      { duration: { base: "half" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
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
  name: "Two voices on one staff",
};

export const OrderedRestClearance: StoryObj = {
  name: "Rests clear notes and beams in voice order",
  render: () => {
    const measures = [true, false].map((upperRest) => {
      const notes = Array.from({ length: 8 }, (_, index) => ({
        id: `${upperRest}-n${index}`,
        duration: { base: "eighth" },
        notes: [{ pitch: { step: "C", octave: upperRest ? 6 : 3 } }],
      }));
      const rests = notes.map((note, index) =>
        index === 1 ? { duration: { base: "eighth" }, rest: {} } : { ...note, id: `${upperRest}-r${index}` },
      );
      return {
        clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
        sequences: (upperRest ? [rests, notes] : [notes, rests]).map((content) => ({ content })),
        beams: [{ events: notes.map((note) => note.id) }],
      };
    });
    const mnx = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
      parts: [{ measures }],
    };
    return <ScorePreview mnxJson={JSON.stringify(mnx)} />;
  },
};
