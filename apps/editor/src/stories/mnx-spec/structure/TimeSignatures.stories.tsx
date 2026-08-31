import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Clefs, Keys & Meter/Time Signatures",
  component: ScorePreview,
};

export default meta;

/**
 * All common time signatures in one multi-measure view:
 * 4/4, 3/4, 6/8, 2/4, 5/4
 */
export const AllTimeSignatures: StoryObj = {
  render: () => {
    const sigs: [number, number][] = [
      [4, 4],
      [3, 4],
      [6, 8],
      [2, 4],
      [5, 4],
    ];
    const steps = ["C", "D", "E", "F", "G", "A", "B"];
    const mnx = buildMnx({
      measures: sigs.map(([count, unit], i) => ({
        time: { count, unit },
        voices: [
          [
            ...Array.from({ length: count }, (_, j) => ({
              duration: unit === 8 ? ("eighth" as const) : ("quarter" as const),
              notes: [{ step: steps[(i * 2 + j) % 7], octave: 5 }],
            })),
          ],
        ],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Common time-signature examples",
};

type InteractiveArgs = { count: number; unit: number };

/** Pick time signature count and unit with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try time signatures",
  args: { count: 4, unit: 4 },
  argTypes: {
    count: { control: { type: "number", min: 1, max: 12, step: 1 } },
    unit: { control: { type: "select" }, options: [2, 4, 8, 16] },
  },
  render: ({ count, unit }) => {
    const steps = ["C", "D", "E", "F", "G", "A", "B"];
    const base = unit === 2 ? "half" : unit === 8 ? "eighth" : unit === 16 ? "16th" : "quarter";
    const mnx = buildMnx({
      measures: [
        {
          time: { count, unit },
          voices: [
            [
              ...Array.from({ length: count }, (_, j) => ({
                duration: base,
                notes: [{ step: steps[j % 7], octave: 5 }],
              })),
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const TimeSignatureChange: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
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
          time: { count: 3, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 5 }] },
            ],
          ],
        },
        {
          time: { count: 2, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 6 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Changes from 4/4 to 3/4 to 2/4",
};

/**
 * Common time (??) � 4/4 displayed with the common-time symbol.
 */
export const CommonTime: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ time: { count: 4, unit: 4, display: "common" } }],
        },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Common time symbol",
};

/**
 * Cut time (??) � 2/2 displayed with the cut-time symbol.
 */
export const CutTime: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ time: { count: 2, unit: 2, display: "cut" } }],
        },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                      { duration: { base: "half" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Cut time symbol",
};
