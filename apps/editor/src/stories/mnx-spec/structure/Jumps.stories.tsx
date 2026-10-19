import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Barlines, Repeats & Navigation/Navigation Jumps",
  component: ScorePreview,
};

export default meta;

/**
 * All jump types supported by the engine in one multi-measure view:
 * Measures 1–3: D.S. al Fine (segno + fine + dsAlFine)
 * Measures 4–6: D.S. al Coda (segno + dsAlCoda + coda)
 * Measures 7–9: D.C. al Coda (dcAlCoda + coda)
 */
export const AllJumps: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          segno: { location: { fraction: [0, 1] } },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          fine: { location: { fraction: [1, 1] } },
          voices: [
            [
              { duration: "half", notes: [{ step: "G", octave: 5 }] },
              { duration: "half", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
        {
          jump: { type: "dsAlFine", location: { fraction: [1, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          segno: { location: { fraction: [0, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          jump: { type: "dsAlCoda", location: { fraction: [1, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
        {
          coda: { location: { fraction: [0, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 5 }] }]],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          coda: { location: { fraction: [0, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          jump: { type: "dcAlCoda", location: { fraction: [1, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Navigation jumps (D.S. al Fine, D.S. al Coda, D.C. al Coda)",
};

export const AuthoredMarkerText: StoryObj = {
  name: "Authored marker text (before, after, replace)",
  render: () => {
    const text = (value: string, placement: "before" | "after" | "replace") => ({
      content: [{ text: value }],
      placement,
    });
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          segno: { location: { fraction: [0, 1] } },
          virituraGlobal: { markerText: { segno: text("from here", "after") } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          fine: { location: { fraction: [1, 1] } },
          virituraGlobal: { markerText: { fine: text("last time", "after") } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          coda: { location: { fraction: [1, 1] } },
          virituraGlobal: { markerText: { coda: text("To Coda", "before") } },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
        {
          jump: { type: "dsAlFine", location: { fraction: [1, 1] } },
          virituraGlobal: { markerText: { jump: text("with repeats", "after") } },
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 5 }] }]],
        },
        {
          jump: { type: "dsAlFine", location: { fraction: [1, 1] } },
          virituraGlobal: { markerText: { jump: text("Return to the segno", "replace") } },
          voices: [[{ duration: "whole", notes: [{ step: "G", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

type InteractiveArgs = { jumpType: "dsAlFine" | "dsAlCoda" | "dcAlCoda" };

/** Pick jump type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try navigation jumps",
  args: { jumpType: "dsAlFine" },
  argTypes: {
    jumpType: {
      control: { type: "select" },
      options: ["dsAlFine", "dsAlCoda", "dcAlCoda"],
    },
  },
  render: ({ jumpType }) => {
    const needsSegno = jumpType !== "dcAlCoda";
    const needsCoda = jumpType !== "dsAlFine";
    const needsFine = jumpType === "dsAlFine";
    const jumpField = { jump: { type: jumpType, location: { fraction: [1, 1] as number[] } } };

    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
          ...(needsSegno ? { segno: { location: { fraction: [0, 1] } } } : {}),
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
          ...(needsFine ? { fine: { location: { fraction: [1, 1] } } } : {}),
          ...(needsCoda ? { coda: { location: { fraction: [0, 1] } } } : {}),
        },
        {
          ...jumpField,
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
