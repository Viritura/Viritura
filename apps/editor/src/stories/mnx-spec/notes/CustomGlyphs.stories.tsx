import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure, buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Custom Note Glyphs",
  component: ScorePreview,
};

export default meta;

const glyphOptions = [
  { label: "G Clef 8vb", type: "clef", sign: "G", staffPosition: -2, glyph: "gClef8vb", dynValue: "", dynGlyph: "" },
  { label: "F Clef 8va", type: "clef", sign: "F", staffPosition: 2, glyph: "fClef8va", dynValue: "", dynGlyph: "" },
  {
    label: "Sforzando (sfz)",
    type: "dynamic",
    sign: "G",
    staffPosition: -2,
    glyph: "",
    dynValue: "sfz",
    dynGlyph: "dynamicSforzando1",
  },
  {
    label: "Forte Piano (fp)",
    type: "dynamic",
    sign: "G",
    staffPosition: -2,
    glyph: "",
    dynValue: "fp",
    dynGlyph: "dynamicFortePiano",
  },
] as const;

/** All four custom glyphs: two clef variants and two dynamics. */
export const AllCustomGlyphs: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          clef: { sign: "G", staffPosition: -2, glyph: "gClef8vb" },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        },
        {
          clef: { sign: "F", staffPosition: 2, glyph: "fClef8va" },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 3 }] }]],
        },
        {
          clef: { sign: "G", staffPosition: -2 },
          dynamics: [{ value: "sfz", position: { fraction: [0, 1] }, glyph: "dynamicSforzando1" }],
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 4 }] }]],
        },
        {
          dynamics: [{ value: "fp", position: { fraction: [0, 1] }, glyph: "dynamicFortePiano" }],
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 4 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All custom note glyphs",
};

type InteractiveArgs = {
  glyphType: string;
};

/** Pick a custom glyph type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try custom note glyphs",
  args: {
    glyphType: "G Clef 8vb",
  },
  argTypes: {
    glyphType: {
      control: { type: "select" },
      options: glyphOptions.map((g) => g.label),
    },
  },
  render: ({ glyphType }) => {
    const opt = glyphOptions.find((g) => g.label === glyphType) ?? glyphOptions[0];
    if (opt.type === "clef") {
      const mnx = buildSingleMeasure([{ duration: "whole", notes: [{ step: "C", octave: 4 }] }], {
        clef: { sign: opt.sign, staffPosition: opt.staffPosition, glyph: opt.glyph },
      });
      return <ScorePreview mnxJson={mnx} />;
    }
    const mnx = buildSingleMeasure([{ duration: "whole", notes: [{ step: "E", octave: 4 }] }], {
      dynamics: [{ value: opt.dynValue, position: { fraction: [0, 1] }, glyph: opt.dynGlyph }],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
