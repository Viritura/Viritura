import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Trills",
  component: ScorePreview,
};

export default meta;

export const SimpleTrill: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "half", virituraMarkings: { trill: {} }, notes: [{ step: "E", octave: 5 }] },
      { duration: "half", notes: [{ step: "C", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Simple trill",
};

export const TrillWithExtension: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      {
        id: "trill-start",
        duration: "quarter",
        virituraMarkings: { trill: { extension: { target: "trill-start", targetEdge: "end" } } },
        notes: [{ step: "E", octave: 5 }],
      },
      { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
      { id: "trill-end", duration: "half", notes: [{ step: "G", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Trill with extension",
};

export const ExtensionOnly: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      {
        id: "trill-start",
        duration: "quarter",
        virituraMarkings: {
          trill: {
            showSymbol: false,
            extension: { target: "trill-start", targetEdge: "end" },
          },
        },
        notes: [{ step: "E", octave: 5 }],
      },
      { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
      { id: "trill-end", duration: "half", notes: [{ step: "G", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Extension only",
};
