import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Articulations",
  component: ScorePreview,
};

export default meta;

const articulationTypes = [
  "accent",
  "strongAccent",
  "staccato",
  "staccatissimo",
  "tenuto",
  "spiccato",
  "stress",
  "unstress",
  "softAccent",
] as const;

/** One note per articulation type � all 9 at a glance. */
export const AllArticulations: StoryObj = {
  render: () => {
    const steps = ["C", "D", "E", "F", "G", "A", "B", "C", "D"];
    const notes = articulationTypes.map((art, i) => ({
      duration: "eighth" as const,
      markings: { [art]: {} },
      notes: [{ step: steps[i], octave: i >= 7 ? 6 : 5 }],
    }));
    const mnx = buildSingleMeasure(notes, { time: { count: 9, unit: 8 } });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All nine standard articulations",
};

type InteractiveArgs = {
  articulation: (typeof articulationTypes)[number];
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  octave: number;
};

/** Pick any articulation, pitch step, and octave with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try articulation marks",
  args: {
    articulation: "accent",
    step: "E",
    octave: 5,
  },
  argTypes: {
    articulation: {
      control: { type: "select" },
      options: [...articulationTypes],
    },
    step: {
      control: { type: "select" },
      options: ["C", "D", "E", "F", "G", "A", "B"],
    },
    octave: {
      control: { type: "range", min: 1, max: 7, step: 1 },
    },
  },
  render: ({ articulation, step, octave }) => {
    const mnx = buildSingleMeasure([
      { duration: "quarter", markings: { [articulation]: {} }, notes: [{ step, octave }] },
      { duration: "quarter", markings: { [articulation]: {} }, notes: [{ step, octave }] },
      { duration: "quarter", markings: { [articulation]: {} }, notes: [{ step, octave }] },
      { duration: "quarter", markings: { [articulation]: {} }, notes: [{ step, octave }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
};

/** Multiple articulations stacked on single notes. */
export const Combinations: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "quarter", markings: { staccato: {}, accent: {} }, notes: [{ step: "C", octave: 5 }] },
      { duration: "quarter", markings: { tenuto: {}, accent: {} }, notes: [{ step: "D", octave: 5 }] },
      { duration: "quarter", markings: { staccato: {}, tenuto: {} }, notes: [{ step: "E", octave: 5 }] },
      { duration: "quarter", markings: { staccatissimo: {}, accent: {} }, notes: [{ step: "F", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Articulation combinations",
};
