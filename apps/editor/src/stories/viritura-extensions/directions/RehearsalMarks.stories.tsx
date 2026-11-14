import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Rehearsal Marks",
  component: ScorePreview,
};

export default meta;

export const DefaultStyle: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          virituraGlobal: { rehearsalMark: { text: [{ text: "A" }] } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "B" }] } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default rehearsal marks",
};

export const AllStyles: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          virituraGlobal: { rehearsalMark: { text: [{ text: "A" }] } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "B" }], style: "boxed" } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "C" }], style: "circled" } },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "D" }], style: "plain" } },
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default, boxed, circled, and plain rehearsal marks",
};

export const HouseStyle: StoryObj = {
  name: "House style with a per-mark override",
  render: () => {
    const mnx = buildMnx({
      virituraRoot: { textStyles: { rehearsalMark: { family: "serif", size: 3.5, italic: true } } },
      measures: [
        {
          time: { count: 4, unit: 4 },
          virituraGlobal: { rehearsalMark: { text: [{ text: "I" }] } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: {
            rehearsalMark: { text: [{ text: "J", style: { font: "sans-serif", weight: "bold" } }] },
          },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const DistinctLettersAndDescenders: StoryObj = {
  render: () => {
    const labels = [
      { text: "I" },
      { text: "J" },
      { text: "I", style: { font: "serif" } },
      { text: "J", style: { font: "serif" } },
      { text: "J", style: { font: "serif", size: 1.5 } },
    ];
    const mnx = buildMnx({
      measures: labels.map((label, index) => ({
        ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
        virituraGlobal: { rehearsalMark: { text: [label], style: "boxed" } },
        voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Distinct I/J and serif descender clearance",
};

// The rehearsal mark background is transparent — only the border (box or
// circle) is drawn, so a tinted canvas background shows through instead of an
// opaque white fill. All three border styles share this behaviour.
export const TransparentBackground: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          virituraGlobal: { rehearsalMark: { text: [{ text: "A" }], style: "boxed" } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "B" }], style: "circled" } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Transparent boxed and circled marks",
};
