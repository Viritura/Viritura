import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Caesura",
  component: ScorePreview,
};

export default meta;

function globalBarlineMnx(extract: boolean): string {
  const measure = {
    sequences: [1, 2].map((staff) => ({
      staff,
      content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: staff === 1 ? 6 : 3 } }] }],
    })),
  };
  const mnx = JSON.stringify({
    mnx: { version: 1 },
    global: {
      measures: [
        { id: "first", time: { count: 4, unit: 4 }, caesura: {} },
        { id: "second", caesura: { shape: "thick", marks: 2 } },
        { id: "third", caesura: { shape: "short", marks: 1 } },
        { id: "fourth", caesura: { shape: "curved", marks: 2 }, repeatEnd: {} },
      ],
    },
    layouts: [
      {
        id: "full",
        content: [
          { type: "staff", sources: [{ part: "piano", staff: 1 }] },
          { type: "staff", sources: [{ part: "piano", staff: 2 }] },
          { type: "staff", sources: [{ part: "flute" }] },
        ],
      },
      {
        id: "extract",
        content: [
          { type: "staff", sources: [{ part: "piano", staff: 1 }] },
          { type: "staff", sources: [{ part: "piano", staff: 2 }] },
        ],
      },
    ],
    scores: [
      {
        name: extract ? "Piano" : "Full",
        layout: extract ? "extract" : "full",
        pages: [{ systems: [{ measure: "first" }, { measure: "third" }] }],
      },
    ],
    parts: [
      { id: "piano", name: "Piano", staves: 2, measures: Array.from({ length: 4 }, () => measure) },
      {
        id: "flute",
        name: "Flute",
        measures: Array.from({ length: 4 }, () => ({ sequences: [measure.sequences[0]] })),
      },
    ],
  });
  return mnx;
}

export const GlobalBarlineCaesuras: StoryObj = {
  name: "Global barline caesuras — full score and system breaks",
  render: () => <ScorePreview mnxJson={globalBarlineMnx(false)} viewMode="page" height={650} />,
};

export const GlobalPartExtract: StoryObj = {
  name: "Global barline caesuras — piano part extract",
  render: () => <ScorePreview mnxJson={globalBarlineMnx(true)} viewMode="page" height={650} />,
};

export const DefaultCaesura: StoryObj = {
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
              { duration: "quarter", notes: [{ step: "F", octave: 5 }], markings: { caesura: {} } },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "half", notes: [{ step: "G", octave: 5 }] },
              { duration: "half", notes: [{ step: "A", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default caesura",
};

export const AllStyles: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }], markings: { caesura: {} } }]],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "D", octave: 5 }],
                markings: { caesura: { shape: "thick" } },
              },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "E", octave: 5 }],
                markings: { caesura: { shape: "short" } },
              },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "F", octave: 5 }],
                markings: { caesura: { shape: "curved" } },
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default, thick, short, and curved caesuras",
};

export const AllMarksCounts: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [{ duration: "whole", notes: [{ step: "C", octave: 5 }], markings: { caesura: { shape: "normal" } } }],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "D", octave: 5 }],
                markings: { caesura: { shape: "normal", marks: 1 } },
              },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "E", octave: 5 }],
                markings: { caesura: { shape: "thick", marks: 1 } },
              },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "F", octave: 5 }],
                markings: { caesura: { shape: "curved", marks: 1 } },
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Two-mark default vs. single-mark variants (SMuFL only defines a single-stroke glyph)",
};
