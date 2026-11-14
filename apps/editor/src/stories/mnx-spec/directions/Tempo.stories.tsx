import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Dynamics & Tempo/Tempo",
  component: ScorePreview,
};

export default meta;

export const QuarterAt120: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
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
  name: "Quarter = 120",
};

export const TempoChange: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 200, value: { base: "quarter" } }],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
        {
          tempos: [{ bpm: 80, value: { base: "half" } }],
          voices: [
            [
              { duration: "half", notes: [{ step: "C", octave: 5 }] },
              { duration: "half", notes: [{ step: "G", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Tempo change (quarter = 200 to half = 80)",
};

export const ParenthesizedMetronomeMark: StoryObj = {
  name: "Parenthesis clears the metronome note",
  render: () => {
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [
              {
                bpm: 170,
                value: { base: "quarter" },
                _x: { viritura: { text: [{ text: "Monster" }] } },
              },
            ],
          },
        ],
      },
      parts: [
        {
          measures: [
            {
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] }],
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const LateTempoAfterMultimeasureRest: StoryObj = {
  render: () => {
    const quarter = {
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 5 } }],
    };
    const rest = {
      sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
    };
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: {
        measures: Array.from({ length: 10 }, (_, index) => ({
          id: `m${index}`,
          ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
          ...(index === 8
            ? {
                tempos: [
                  {
                    bpm: 100,
                    value: { base: "quarter" },
                    location: { fraction: [3, 4] },
                    _x: { viritura: { text: [{ text: "Love Letter" }] } },
                  },
                ],
              }
            : {}),
          ...(index === 9 ? { key: { fifths: 2 } } : {}),
        })),
      },
      parts: [
        {
          id: "flute",
          name: "Flute 2",
          measures: [
            ...Array.from({ length: 6 }, () => ({
              sequences: [{ content: Array.from({ length: 4 }, () => quarter) }],
            })),
            rest,
            rest,
            { sequences: [{ content: [{ duration: { base: "half", dots: 1 }, rest: {} }, quarter] }] },
            { sequences: [{ content: Array.from({ length: 4 }, () => quarter) }] },
          ],
        },
      ],
      layouts: [{ id: "part", content: [{ type: "staff", sources: [{ part: "flute" }] }] }],
      scores: [{ name: "Flute 2", layout: "part", multimeasureRests: [{ start: "m6", duration: 2 }] }],
    });
    return <ScorePreview mnxJson={mnx} viewMode="page" />;
  },
  name: "Late tempo stays in its bar after a multimeasure rest",
};
