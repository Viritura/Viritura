import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Slurs/Basics",
  component: ScorePreview,
};

export default meta;

export const SimpleSlur: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ev1",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ev4", side: "up" }],
              },
              { duration: "quarter", id: "ev2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "ev3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "ev4", notes: [{ step: "C", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Simple slur",
};

export const SlurAcrossBarlines: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "ev1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "ev5" }] },
              { duration: "quarter", id: "ev2", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", id: "ev3", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", id: "ev4", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "quarter", id: "ev5", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Slur across barlines",
};
