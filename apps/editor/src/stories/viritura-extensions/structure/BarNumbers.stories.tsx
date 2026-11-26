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

export const ReservedRowsWithoutLines: StoryObj = {
  name: "Reserved rows above and below, without staff lines",
  render: () =>
    preview({
      frequency: "everyBar",
      showFirst: true,
      placements: ["aboveSystem", "belowSystem"],
      onStaff: true,
      showStaffLine: false,
      horizontalAlignment: "center",
    }),
};

export const SystemAndStringsBracket: StoryObj = {
  name: "Above system, below system, and above Strings bracket",
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: {
          measures: Array.from({ length: 8 }, (_, index) => (index === 0 ? { time: { count: 4, unit: 4 } } : {})),
        },
        parts: ["winds", "violin", "cello"].map((id, index) => ({
          id,
          name: id,
          measures: Array.from({ length: 8 }, () => ({
            sequences: [
              {
                content: [
                  {
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: index === 2 ? 3 : 5 } }],
                  },
                ],
              },
            ],
          })),
        })),
        layouts: [
          {
            id: "L",
            content: [
              {
                type: "group",
                symbol: "bracket",
                label: "Winds",
                content: [{ type: "staff", sources: [{ part: "winds" }] }],
              },
              {
                type: "group",
                symbol: "bracket",
                label: "Strings",
                content: [
                  { type: "staff", sources: [{ part: "violin" }] },
                  { type: "staff", sources: [{ part: "cello" }] },
                ],
              },
            ],
          },
        ],
        scores: [
          { name: "Full score", layout: "L", _x: { viritura: { barNumbers: { aboveGroups: [["violin", "cello"]] } } } },
        ],
        _x: {
          viritura: {
            barNumbers: {
              frequency: "everyBar",
              showFirst: true,
              placements: ["aboveSystem", "belowSystem"],
              onStaff: true,
              showStaffLine: false,
              horizontalAlignment: "center",
            },
          },
        },
      })}
    />
  ),
};
