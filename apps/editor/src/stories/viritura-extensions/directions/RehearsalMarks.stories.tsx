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
          virituraGlobal: { rehearsalMark: { text: "A" } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: "B" } },
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
          virituraGlobal: { rehearsalMark: { text: "A" } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: "B", style: "boxed" } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: "C", style: "circled" } },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: "D", style: "plain" } },
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default, boxed, circled, and plain rehearsal marks",
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
          virituraGlobal: { rehearsalMark: { text: "A", style: "boxed" } },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: "B", style: "circled" } },
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Transparent boxed and circled marks",
};
