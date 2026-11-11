import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorScorePreview } from "../../storyFixtures/EditorScorePreview";

const meta: Meta = {
  title: "App/Write View/Floating Clef and Key",
  component: EditorScorePreview,
  parameters: {
    docs: {
      description: {
        component:
          "Scroll horizontally with Shift + wheel or middle-drag. The floating rail follows the current clef " +
          "and key through sharp, flat, and empty signatures, including a clef change without a key change.",
      },
    },
  },
};

export default meta;

const measureCount = 24;
const globalMeasures = Array.from({ length: measureCount }, (_, index) => ({
  ...(index === 0 ? { time: { count: 4, unit: 4 }, key: { fifths: 4 } } : {}),
  ...(index === 6 ? { key: { fifths: -4 } } : {}),
  ...(index === 12 ? { key: { fifths: 0 } } : {}),
  ...(index === 18 ? { key: { fifths: 7 } } : {}),
}));

function part(id: string, name: string, lower: boolean) {
  return {
    id,
    name,
    measures: Array.from({ length: measureCount }, (_, index) => ({
      ...(index === 0
        ? { clefs: [{ clef: lower ? { sign: "F", staffPosition: 2 } : { sign: "G", staffPosition: -2 } }] }
        : {}),
      ...(!lower && index === 8 ? { clefs: [{ clef: { sign: "F", staffPosition: 2 } }] } : {}),
      sequences: [
        {
          content: [
            {
              type: "event",
              duration: { base: "whole" },
              notes: [{ pitch: { step: "C", octave: lower || index >= 8 ? 3 : 5 } }],
            },
          ],
        },
      ],
    })),
  };
}

const mnx = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: globalMeasures },
  parts: [part("upper", "Upper staff", false), part("lower", "Lower staff", true)],
});

export const ChangingKeys: StoryObj = {
  name: "Changing keys and clefs",
  render: () => <EditorScorePreview mnxJson={mnx} showEditor={false} fitToWidth={false} />,
};
