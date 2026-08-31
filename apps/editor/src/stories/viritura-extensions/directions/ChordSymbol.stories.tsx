import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Chord Symbols",
  component: ScorePreview,
  argTypes: {
    rootStep: {
      control: "select",
      options: ["C", "D", "E", "F", "G", "A", "B"],
      description: "Root note step",
    },
    rootAlter: {
      control: { type: "range", min: -1, max: 1, step: 1 },
      description: "Root alteration (-1=flat, 0=natural, 1=sharp)",
    },
    quality: {
      control: "select",
      options: [
        "major",
        "minor",
        "dominant",
        "diminished",
        "augmented",
        "half-diminished",
        "minor-major",
        "power",
        "suspended2",
        "suspended4",
      ],
      description: "Chord quality",
    },
    extension: {
      control: "select",
      options: [undefined, 7, 9, 11, 13],
      description: "Chord extension (7th, 9th, etc.)",
    },
  },
  args: {
    rootStep: "C",
    rootAlter: 0,
    quality: "major",
    extension: undefined,
  },
};

export default meta;

type ChordArgs = { rootStep: string; rootAlter: number; quality: string; extension?: number };

export const Default: StoryObj<ChordArgs> = {
  render: (args) => {
    const root: Record<string, unknown> = { step: args.rootStep };
    if (args.rootAlter !== 0) root.alter = args.rootAlter;

    const mnx = buildSingleMeasure([{ duration: "whole", notes: [{ step: "C", octave: 4 }] }], {
      virituraPartMeasure: {
        chordSymbols: [
          {
            position: { fraction: [0, 1] },
            root,
            quality: args.quality,
            ...(args.extension ? { extension: args.extension } : {}),
          },
        ],
      },
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Single chord symbol",
};

export const CommonProgression: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "D", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
      ],
      {
        virituraPartMeasure: {
          chordSymbols: [
            { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
            { position: { fraction: [1, 4] }, root: { step: "D" }, quality: "minor" },
            { position: { fraction: [2, 4] }, root: { step: "G" }, quality: "dominant", extension: 7 },
            { position: { fraction: [3, 4] }, root: { step: "C" }, quality: "major", extension: 7 },
          ],
        },
      },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "I–ii–V7–Imaj7 progression",
};

export const AllQualities: StoryObj = {
  render: () => {
    const qualities = [
      "major",
      "minor",
      "dominant",
      "diminished",
      "augmented",
      "half-diminished",
      "minor-major",
      "power",
      "suspended2",
      "suspended4",
    ];
    const mnx = buildMnx({
      measures: qualities.map((quality, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
        voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        virituraPartMeasure: {
          chordSymbols: [
            {
              position: { fraction: [0, 1] },
              root: { step: "C" },
              quality,
            },
          ],
        },
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All ten chord qualities",
};
