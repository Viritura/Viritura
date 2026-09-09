import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Structure/Staff Lines",
  component: ScorePreview,
};
export default meta;
type Story = StoryObj;

const staffLinesMnx = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: [{ time: { count: 4, unit: 4 } }, {}, {}],
  },
  parts: [
    {
      id: "percussion",
      name: "Percussion",
      measures: [
        {
          staffConfigs: [{ config: { lines: 1 } }],
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, rest: {} },
                { duration: { base: "quarter" }, rest: {} },
                { duration: { base: "quarter" }, rest: {} },
                { duration: { base: "quarter" }, rest: {} },
              ],
            },
          ],
        },
        {
          staffConfigs: [{ position: { fraction: [1, 2] }, config: { lines: 5 } }],
          sequences: [
            {
              content: [
                { duration: { base: "quarter" }, rest: {} },
                { duration: { base: "quarter" }, rest: {} },
                { duration: { base: "quarter" }, rest: {} },
                { duration: { base: "quarter" }, rest: {} },
              ],
            },
          ],
        },
        {
          staffConfigs: [{ config: { lines: 0 } }],
          sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
        },
      ],
    },
  ],
});

/** One-line percussion, a mid-measure transition to five lines, then a zero-line staff. */
export const PositionedChanges: Story = {
  args: { mnxJson: staffLinesMnx },
};
