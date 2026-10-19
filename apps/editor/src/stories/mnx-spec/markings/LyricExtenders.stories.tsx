import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Lyrics/Lyric Extenders",
  component: ScorePreview,
};

export default meta;

export const ExplicitAndInferred: StoryObj = {
  name: "Explicit and inferred word extensions",
  render: () => {
    const mnx = buildMnx({
      support: { useLyricExtenders: false },
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                id: "explicit-start",
                duration: "quarter",
                notes: [{ step: "C", octave: 4 }],
                lyrics: { lines: { "1": { text: "Ah", extender: { show: true, target: "explicit-end" } } } },
              },
              { id: "explicit-end", duration: "quarter", notes: [{ step: "D", octave: 4 }] },
              {
                id: "inferred-start",
                duration: "quarter",
                notes: [{ step: "E", octave: 4 }],
                lyrics: { lines: { "1": { text: "Halle" } } },
              },
              { id: "inferred-target", duration: "quarter", notes: [{ step: "F", octave: 4 }] },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "quarter",
                notes: [{ step: "G", octave: 4 }],
                lyrics: { lines: { "1": { text: "lujah" } } },
              },
              { duration: "half", notes: [{ step: "A", octave: 4 }] },
              { duration: "quarter", rest: true },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
