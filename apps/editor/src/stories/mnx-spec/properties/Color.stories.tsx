import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Appearance/Color",
  component: ScorePreview,
};

export default meta;

/** All six colorable element types in one multi-measure view. */
export const AllColoredElements: StoryObj = {
  render: () => {
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, key: { fifths: 3, color: "#00aa00" } },
          { segno: { location: { fraction: [0, 1] }, color: "#9900cc" } },
          {
            ending: { duration: 1, numbers: [1], color: "#0000ff" },
            repeatEnd: {},
          },
          {},
          { fine: { location: { fraction: [1, 1] }, color: "#cc0000" } },
        ],
      },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2, color: "#ff0000" } }],
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "A", octave: 4 } }] }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] }],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "D", octave: 5 } }] }] }],
            },
            {
              sequences: [
                {
                  content: [
                    {
                      type: "grace",
                      color: "#0000ff",
                      content: [{ duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 5 } }] }],
                    },
                    { duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                  ],
                },
              ],
            },
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "E", octave: 5 } }] }] }],
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All colored elements",
};

const elementTypes = ["clef", "keySignature", "ending", "grace", "segno", "fine"] as const;

type InteractiveArgs = {
  element: (typeof elementTypes)[number];
  color: string;
};

/** Pick which element to color and what color to use. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try notation colors",
  args: {
    element: "clef",
    color: "#ff0000",
  },
  argTypes: {
    element: {
      control: { type: "select" },
      options: [...elementTypes],
    },
    color: { control: "color" },
  },
  render: ({ element, color }) => {
    const globalMeasures: Record<string, unknown>[] = [{ time: { count: 4, unit: 4 } }, {}];
    const partMeasures: Record<string, unknown>[] = [
      {
        clefs: [{ clef: { sign: "G", staffPosition: -2, ...(element === "clef" ? { color } : {}) } }],
        sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] }],
      },
      {
        sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "D", octave: 5 } }] }] }],
      },
    ];

    if (element === "keySignature") {
      globalMeasures[0] = { ...globalMeasures[0], key: { fifths: 3, color } };
    } else if (element === "ending") {
      globalMeasures[0] = { ...globalMeasures[0], ending: { duration: 1, numbers: [1], color }, repeatEnd: {} };
    } else if (element === "segno") {
      globalMeasures[0] = { ...globalMeasures[0], segno: { location: { fraction: [0, 1] }, color } };
    } else if (element === "fine") {
      globalMeasures[1] = { ...globalMeasures[1], fine: { location: { fraction: [1, 1] }, color } };
    } else if (element === "grace") {
      partMeasures[0] = {
        clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
        sequences: [
          {
            content: [
              {
                type: "grace",
                color,
                content: [{ duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 5 } }] }],
              },
              { duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
            ],
          },
        ],
      };
    }

    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: globalMeasures },
      parts: [{ measures: partMeasures }],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
