import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Pitch",
  component: ScorePreview,
  argTypes: {
    step: {
      control: "select",
      options: ["C", "D", "E", "F", "G", "A", "B"],
      description: "Note letter name (note.pitch.step)",
    },
    octave: {
      control: { type: "range", min: 2, max: 7, step: 1 },
      description: "Octave number (note.pitch.octave)",
    },
    alter: {
      control: { type: "range", min: -2, max: 2, step: 1 },
      description:
        "Chromatic alteration in semitones (note.pitch.alter). -1=flat, 1=sharp, -2=double-flat, 2=double-sharp",
    },
    duration: {
      control: "select",
      options: ["whole", "half", "quarter", "eighth", "16th", "32nd"],
      description: "Note duration (event.duration.base)",
    },
    dots: {
      control: { type: "range", min: 0, max: 3, step: 1 },
      description: "Number of augmentation dots",
    },
  },
  args: {
    step: "C",
    octave: 5,
    alter: 0,
    duration: "quarter",
    dots: 0,
  },
};

export default meta;

type PitchArgs = {
  step: string;
  octave: number;
  alter: number;
  duration: string;
  dots: number;
};

export const Default: StoryObj<PitchArgs> = {
  render: (args) => {
    const mnx = buildSingleMeasure([
      {
        duration: args.duration,
        dots: args.dots,
        notes: [{ step: args.step, octave: args.octave, alter: args.alter }],
      },
      { duration: "quarter", rest: true },
      { duration: "quarter", rest: true },
      { duration: "quarter", rest: true },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Single note",
};

export const AllSteps: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      ["C", "D", "E", "F", "G", "A", "B"].map((step) => ({
        duration: "eighth",
        notes: [{ step, octave: 5 }],
      })),
      { time: { count: 7, unit: 8 } },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All pitch steps (C D E F G A B)",
};

export const Accidentals: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        {
          duration: "quarter",
          notes: [{ step: "C", octave: 5, alter: -2, accidentalDisplay: { show: true, force: true } }],
        }, // double flat
        {
          duration: "quarter",
          notes: [{ step: "D", octave: 5, alter: -1, accidentalDisplay: { show: true, force: true } }],
        }, // flat
        {
          duration: "quarter",
          notes: [{ step: "E", octave: 5, alter: 0, accidentalDisplay: { show: true, force: true } }],
        }, // natural
        {
          duration: "quarter",
          notes: [{ step: "F", octave: 5, alter: 1, accidentalDisplay: { show: true, force: true } }],
        }, // sharp
        {
          duration: "quarter",
          notes: [{ step: "G", octave: 5, alter: 2, accidentalDisplay: { show: true, force: true } }],
        }, // double sharp
      ],
      { time: { count: 5, unit: 4 }, support: { useAccidentalDisplay: true } },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Double-flat, flat, natural, sharp, and double-sharp",
};
