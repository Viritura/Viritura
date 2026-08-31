import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { type EventArgs } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Tuplet Examples",
  component: ScorePreview,
  argTypes: {
    bracket: {
      control: "select",
      options: ["auto", "yes", "no"],
      description: "MNX bracket: show/hide tuplet bracket",
    },
    showNumber: {
      control: "select",
      options: ["inner", "both", "noNumber"],
      description: "MNX showNumber: which ratio numbers to display",
    },
    showValue: {
      control: "select",
      options: ["noNumber", "inner", "both"],
      description: "MNX showValue: which note values to display",
    },
  },
  args: {
    bracket: "auto",
    showNumber: "inner",
    showValue: "noNumber",
  },
};

export default meta;

type TupletArgs = { bracket: string; showNumber: string; showValue: string };

/** Build MNX JSON with a tuplet carrying display properties. */
function buildTupletMnx(bracket?: string, showNumber?: string, showValue?: string): string {
  const tupletEvents: EventArgs[] = [
    { duration: "eighth", notes: [{ step: "C", octave: 5 }] },
    { duration: "eighth", notes: [{ step: "D", octave: 5 }] },
    { duration: "eighth", notes: [{ step: "E", octave: 5 }] },
  ];

  // Build the tuplet object manually since buildMnx doesn't support tuplets yet
  const tuplet: Record<string, unknown> = {
    type: "tuplet",
    inner: { multiple: 3, duration: { base: "eighth" } },
    outer: { multiple: 2, duration: { base: "eighth" } },
    content: tupletEvents.map((e) => ({
      duration: { base: e.duration ?? "quarter" },
      notes: (e.notes ?? [{ step: "C", octave: 4 }]).map((n) => ({
        pitch: { step: n.step ?? "C", octave: n.octave ?? 4 },
      })),
    })),
  };

  if (bracket !== undefined && bracket !== "auto") {
    tuplet.bracket = bracket;
  }
  if (showNumber !== undefined && showNumber !== "inner") {
    tuplet.showNumber = showNumber;
  }
  if (showValue !== undefined && showValue !== "noNumber") {
    tuplet.showValue = showValue;
  }

  const doc = {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [
              {
                content: [
                  tuplet,
                  {
                    duration: { base: "half" },
                    notes: [{ pitch: { step: "F", octave: 5 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  return JSON.stringify(doc, null, 2);
}

export const Default: StoryObj<TupletArgs> = {
  render: (args) => {
    const mnx = buildTupletMnx(args.bracket, args.showNumber, args.showValue);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Try tuplet display options",
};

export const VariantDefault: StoryObj = {
  render: () => <ScorePreview mnxJson={buildTupletMnx()} />,
  name: "Automatic bracket with an inner number",
};

export const VariantBracketHidden: StoryObj = {
  render: () => <ScorePreview mnxJson={buildTupletMnx("no")} />,
  name: "Bracket hidden",
};

export const VariantNumberBoth: StoryObj = {
  render: () => <ScorePreview mnxJson={buildTupletMnx(undefined, "both")} />,
  name: "Ratio number (3:2)",
};

export const VariantNumberNone: StoryObj = {
  render: () => <ScorePreview mnxJson={buildTupletMnx(undefined, "noNumber")} />,
  name: "No number",
};

export const VariantBracketHiddenNumberBoth: StoryObj = {
  render: () => <ScorePreview mnxJson={buildTupletMnx("no", "both")} />,
  name: "Hidden bracket with a ratio number",
};
