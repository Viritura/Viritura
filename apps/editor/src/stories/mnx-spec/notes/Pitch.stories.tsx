import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { InputGhostPreview } from "../../storyFixtures/InputGhostPreview";
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

export const InputGhostRhythm: StoryObj<ComponentProps<typeof InputGhostPreview>> = {
  name: "Add Note rhythm ghost",
  render: (args) => <InputGhostPreview {...args} />,
  parameters: {
    controls: {
      include: [
        "duration",
        "dots",
        "spatium",
        "staffY",
        "staffPosition",
        "stemDirection",
        "accidental",
        "notehead",
        "isRest",
        "isGrace",
        "slash",
      ],
    },
  },
  argTypes: {
    duration: { control: "select", options: ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"] },
    dots: { control: { type: "range", min: 0, max: 4, step: 1 } },
    spatium: { control: { type: "range", min: 6, max: 24, step: 1 } },
    staffY: { control: { type: "range", min: 90, max: 180, step: 1 } },
    staffPosition: { control: { type: "range", min: -6, max: 14, step: 1 } },
    stemDirection: { control: "select", options: ["up", "down"] },
    accidental: { control: "select", options: [null, "flat", "natural", "sharp", "double-flat", "double-sharp"] },
    notehead: {
      control: "select",
      options: ["normal", "x", "circleX", "diamond", "slash", "triangleUp", "triangleDown"],
    },
    isRest: { control: "boolean" },
    isGrace: { control: "boolean" },
    slash: { control: "boolean" },
  },
  args: {
    duration: "16th",
    dots: 2,
    spatium: 16,
    staffY: 140,
    staffPosition: 4,
    stemDirection: "up",
    accidental: null,
    notehead: "normal",
    isRest: false,
    isGrace: false,
    slash: false,
  },
};
