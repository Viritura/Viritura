import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorScorePreview } from "../../storyFixtures/EditorScorePreview";

const rest = { duration: { base: "whole" }, rest: {} };
const note = { duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] };
const score = {
  mnx: { version: 1 },
  global: {
    measures: Array.from({ length: 8 }, (_, index) => ({
      id: `m${index}`,
      ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
    })),
  },
  parts: ["flute", "oboe", "piano"].map((id) => ({
    id,
    name: id === "flute" ? "Flute" : id === "oboe" ? "Oboe" : "Piano",
    staves: id === "piano" ? 2 : 1,
    measures: Array.from({ length: 8 }, (_, index) => ({
      sequences: Array.from({ length: id === "piano" ? 2 : 1 }, (_, staff) => ({
        staff: staff + 1,
        content: [id === "flute" || (index >= 4 && (id === "oboe" || staff === 1)) ? note : rest],
      })),
    })),
  })),
  layouts: [
    {
      id: "L",
      content: [
        { type: "staff", sources: [{ part: "flute" }] },
        { type: "staff", sources: [{ part: "oboe" }] },
        {
          type: "group",
          symbol: "brace",
          content: [
            { type: "staff", sources: [{ part: "piano", staff: 1 }] },
            { type: "staff", sources: [{ part: "piano", staff: 2 }] },
          ],
        },
      ],
    },
  ],
  scores: [
    {
      name: "Auto-hide example",
      layout: "L",
      _x: {
        viritura: {
          autoHideEmptyParts: ["oboe", "piano"],
          layoutBreaks: [{ measure: "m4", kind: "system" }],
        },
      },
    },
  ],
};

const meta: Meta<typeof EditorScorePreview> = {
  title: "App/Engrave Mode/Auto-hide Empty Staves",
  component: EditorScorePreview,
  args: { mnxJson: JSON.stringify(score), showEditor: true, viewMode: "page" },
};
export default meta;
export const SelectedInstruments: StoryObj<typeof EditorScorePreview> = {};
