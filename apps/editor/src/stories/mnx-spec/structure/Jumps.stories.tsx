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
 * Measures 1–3: D.S. al Fine (segno + fine + dsalfine)
 * Measures 4–6: D.S. al Coda (segno + dsalcoda + coda)
 * Measures 7–9: D.C. al Coda (dcalcoda + coda)
 *
 * MNX only standardizes `segno` and `dsalfine` jump types. The non-standard
 * `dsalcoda` / `dcalcoda` are emitted under the `_x.viritura.jump` vendor
 * extension so the document validates against the official MNX schema.
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
          jump: { type: "dsalfine", location: { fraction: [1, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          segno: { location: { fraction: [0, 1] } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          virituraGlobal: {
            jump: { type: "dsalcoda", location: { fraction: [1, 1] } },
          },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
        {
          virituraGlobal: { coda: { location: { fraction: [0, 1] } } },
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 5 }] }]],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { coda: { location: { fraction: [0, 1] } } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          virituraGlobal: {
            jump: { type: "dcalcoda", location: { fraction: [1, 1] } },
          },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Navigation jumps (D.S. al Fine, D.S. al Coda, D.C. al Coda)",
};

type InteractiveArgs = { jumpType: "dsalfine" | "dsalcoda" | "dcalcoda" };

/** Pick jump type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try navigation jumps",
  args: { jumpType: "dsalfine" },
  argTypes: {
    jumpType: {
      control: { type: "select" },
      options: ["dsalfine", "dsalcoda", "dcalcoda"],
    },
  },
  render: ({ jumpType }) => {
    // dsalfine is the only natively-supported MNX jump type.
    // dsalcoda/dcalcoda are emitted via the _x.viritura vendor extension.
    const useExtension = jumpType !== "dsalfine";
    const needsSegno = jumpType !== "dcalcoda";
    const needsCoda = jumpType !== "dsalfine";
    const needsFine = jumpType === "dsalfine";

    const jumpField = useExtension
      ? { virituraGlobal: { jump: { type: jumpType, location: { fraction: [1, 1] as number[] } } } }
      : { jump: { type: jumpType, location: { fraction: [1, 1] as number[] } } };

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
          ...(needsCoda ? { virituraGlobal: { coda: { location: { fraction: [0, 1] } } } } : {}),
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
