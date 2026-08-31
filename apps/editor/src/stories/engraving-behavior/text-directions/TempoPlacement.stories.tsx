import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Text & Directions/Tempo Placement",
  component: ScorePreview,
};

export default meta;

export const LongTextWrapsInPageMode: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [
            {
              bpm: 132,
              value: { base: "quarter" },
              _x: {
                viritura: {
                  showMetronomeMark: false,
                  text: "Allegro molto vivace ma non troppo con brio e con molta espressione",
                },
              },
            },
          ],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} viewMode="page" />;
  },
  name: "Long text wraps in page mode",
};

// A beat-0 tempo anchors to the bar start (like a rehearsal mark), even when the
// bar is empty and holds only a centered whole-measure rest. The first bar below
// is empty; the second carries notes — the tempo text on each must line up at
// the same bar-start x, not drift to the centered rest.
export const EmptyBarAnchorsToBarStart: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 110, value: { base: "quarter" }, _x: { viritura: { text: "Scherzando" } } }],
          fullMeasure: {},
        },
        {
          tempos: [{ bpm: 110, value: { base: "quarter" }, _x: { viritura: { text: "Scherzando" } } }],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Tempo in an empty bar anchors to the bar start",
};
