import type { Meta, StoryObj } from "@storybook/react-vite";
import type { BarNumberSettings } from "@viritura/core";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Structure/Bar Numbers",
  component: ScorePreview,
};
export default meta;

function preview(barNumbers: BarNumberSettings) {
  return (
    <ScorePreview
      mnxJson={buildMnx({
        virituraRoot: { barNumbers },
        measures: Array.from({ length: 16 }, (_, index) => ({
          ...(index === 0 ? { time: { count: 4, unit: 4 } as const } : {}),
          number: index + 1,
          ...(index % 4 === 0
            ? {
                virituraGlobal: { rehearsalMark: { text: [{ text: String.fromCharCode(65 + index / 4) }] } },
              }
            : {}),
          voices: [[{ duration: "whole" as const, notes: [{ step: "C", octave: 5 }] }]],
        })),
      })}
    />
  );
}

export const EveryBarAbove: StoryObj = {
  name: "Every bar above, clearing clefs and rehearsal marks",
  render: () =>
    preview({
      frequency: "everyBar",
      showFirst: true,
      placement: "aboveSystem",
      family: "sans-serif",
      size: 1.5,
      bold: true,
      italic: false,
      enclosure: "box",
    }),
};

export const CircledBelow: StoryObj = {
  name: "Circled bar numbers below the system",
  render: () =>
    preview({
      frequency: "everyBar",
      showFirst: true,
      placement: "belowSystem",
      enclosure: "circle",
    }),
};

export const CenteredWithDistance: StoryObj = {
  name: "Centered in each bar, three staff spaces below",
  render: () =>
    preview({
      frequency: "everyBar",
      showFirst: true,
      placement: "belowSystem",
      horizontalAlignment: "center",
      distance: 3,
    }),
};

export const SingleLineStaff: StoryObj = {
  name: "Numbers centered vertically on a single-line staff",
  render: () =>
    preview({
      frequency: "everyBar",
      showFirst: true,
      placement: "aboveSystem",
      horizontalAlignment: "center",
      distance: 2,
      onStaff: true,
      italic: false,
      enclosure: "box",
    }),
};
