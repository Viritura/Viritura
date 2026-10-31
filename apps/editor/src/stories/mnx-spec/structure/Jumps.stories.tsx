import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Jump } from "@viritura/core";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";
import { JUMP_LABELS } from "../../../commands/navigationMarkers";

const meta: Meta = {
  title: "MNX Spec/Barlines, Repeats & Navigation/Navigation Jumps",
  component: ScorePreview,
};
export default meta;

const jumps = Object.keys(JUMP_LABELS) as Jump["type"][];
const voices = [
  [
    { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
    { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
    { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
    { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
  ],
];

/** A notation gallery, not a combined playback route. */
export const AllJumps: StoryObj = {
  name: "All seven native v46 instructions",
  render: () => (
    <ScorePreview
      mnxJson={buildMnx({
        measures: jumps.map((type, index) => ({
          ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
          jump: { type, location: { fraction: [1, 1] } },
          voices,
        })),
      })}
    />
  ),
};

export const AuthoredMarkerText: StoryObj = {
  name: "Native destinations, rhythmic positions, authored text",
  render: () => (
    <ScorePreview
      mnxJson={buildMnx({
        measures: [
          {
            time: { count: 4, unit: 4 },
            segno: { location: { fraction: [1, 4] }, glyph: "segnoSerpent1", color: "#008800" },
            virituraGlobal: { markerText: { segno: { content: [{ text: "from here" }], placement: "after" } } },
            voices,
          },
          {
            jump: { type: "toCoda", location: { fraction: [3, 4] } },
            virituraGlobal: { markerText: { jump: { content: [{ text: "second time" }], placement: "after" } } },
            voices,
          },
          { jump: { type: "dsAlCoda", location: { fraction: [1, 1] } }, voices },
          {
            coda: { location: { fraction: [1, 2] }, glyph: "codaSquare", color: "#cc0000" },
            virituraGlobal: { markerText: { coda: { content: [{ text: "ending" }], placement: "after" } } },
            voices,
          },
          { fine: { location: { fraction: [3, 4] }, color: "#0044bb" }, voices },
        ],
      })}
    />
  ),
};

interface InteractiveArgs {
  jumpType: Jump["type"];
}

export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try native navigation jumps",
  args: { jumpType: "dsAlFine" },
  argTypes: { jumpType: { control: { type: "select" }, options: jumps } },
  render: ({ jumpType }) => (
    <ScorePreview
      mnxJson={buildMnx({
        measures: [
          { time: { count: 4, unit: 4 }, segno: { location: { fraction: [0, 1] } }, voices },
          { fine: { location: { fraction: [1, 1] } }, voices },
          { jump: { type: "toCoda", location: { fraction: [3, 4] } }, voices },
          { jump: { type: jumpType, location: { fraction: [1, 1] } }, voices },
          { coda: { location: { fraction: [0, 1] } }, voices },
        ],
      })}
    />
  ),
};
