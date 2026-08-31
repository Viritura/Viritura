import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure, buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Breath Marks",
  component: ScorePreview,
};

export default meta;

export const DefaultBreath: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
      { duration: "quarter", markings: { breath: {} }, notes: [{ step: "D", octave: 5 }] },
      { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
      { duration: "quarter", notes: [{ step: "B", octave: 4 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default breath mark",
};

export const AllBreathSymbols: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", markings: { breath: {} }, notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", markings: { breath: { symbol: "tick" } }, notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", markings: { breath: { symbol: "upbow" } }, notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", markings: { breath: { symbol: "salzedo" } }, notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Breath symbols (automatic, tick, up-bow, and Salzedo)",
};
