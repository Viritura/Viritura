import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";
import accidentalDisplayMnx from "../../../../../../packages/format/fixtures/mnx/accidental-display.mnx?raw";

const meta: Meta = {
  title: "MNX Spec/Notes & Rests/Accidentals",
  component: ScorePreview,
};

export default meta;

/** All four display modes in one measure: parentheses, brackets, force, hidden. */
export const AllDisplayModes: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        {
          duration: "quarter",
          notes: [
            { step: "F", octave: 4, alter: 1, accidentalDisplay: { show: true, enclosure: { symbol: "parentheses" } } },
          ],
        },
        {
          duration: "quarter",
          notes: [
            { step: "B", octave: 4, alter: -1, accidentalDisplay: { show: true, enclosure: { symbol: "brackets" } } },
          ],
        },
        {
          duration: "quarter",
          notes: [{ step: "C", octave: 5, alter: 1, accidentalDisplay: { show: true, force: true } }],
        },
        { duration: "quarter", notes: [{ step: "F", octave: 4, alter: 1, accidentalDisplay: { show: false } }] },
      ],
      { support: { useAccidentalDisplay: true } },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Parenthesized, bracketed, courtesy, and hidden accidentals",
};

type InteractiveArgs = {
  show: boolean;
  force: boolean;
  enclosure: "none" | "parentheses" | "brackets";
};

/** Control show, force, and enclosure with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try accidental display modes",
  args: {
    show: true,
    force: false,
    enclosure: "none",
  },
  argTypes: {
    show: { control: "boolean" },
    force: { control: "boolean" },
    enclosure: {
      control: { type: "select" },
      options: ["none", "parentheses", "brackets"],
    },
  },
  render: ({ show, force, enclosure }) => {
    const ad: { show: boolean; force?: boolean; enclosure?: { symbol: string } } = { show };
    if (force) ad.force = true;
    if (enclosure !== "none") ad.enclosure = { symbol: enclosure };
    const mnx = buildSingleMeasure(
      [
        { duration: "quarter", notes: [{ step: "F", octave: 4, alter: 1, accidentalDisplay: ad }] },
        { duration: "quarter", notes: [{ step: "B", octave: 4, alter: -1, accidentalDisplay: ad }] },
        { duration: "quarter", notes: [{ step: "E", octave: 5, alter: 0, accidentalDisplay: ad }] },
        { duration: "quarter", notes: [{ step: "G", octave: 4, alter: 2, accidentalDisplay: ad }] },
      ],
      { support: { useAccidentalDisplay: true } },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const MnxFile: StoryObj = {
  render: () => <ScorePreview mnxJson={accidentalDisplayMnx} />,
  name: "Accidental display reference example",
};
