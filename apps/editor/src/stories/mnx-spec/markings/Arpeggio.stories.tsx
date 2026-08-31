import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Arpeggios",
  component: ScorePreview,
};

export default meta;

const chord = (prefix: string, duration: string, notes: Array<{ step: string; octave: number }>) => ({
  duration,
  notes: notes.map((note, index) => ({ ...note, id: `${prefix}n${index + 1}` })),
});

const arpeggio = (prefix: string, fraction: number[], direction?: "up" | "down" | "auto", arrow?: boolean) => ({
  position: { fraction },
  span: { start: `${prefix}n1`, end: `${prefix}n4` },
  ...(direction ? { direction } : {}),
  ...(arrow !== undefined ? { arrow } : {}),
});

const nonArpeggio = (prefix: string, fraction: number[]) => ({
  position: { fraction },
  span: { start: `${prefix}n1`, end: `${prefix}n4` },
});

export const ArpeggioDirections: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        chord("up", "quarter", [
          { step: "C", octave: 4 },
          { step: "E", octave: 4 },
          { step: "G", octave: 4 },
          { step: "C", octave: 5 },
        ]),
        chord("down", "quarter", [
          { step: "D", octave: 4 },
          { step: "F", octave: 4 },
          { step: "A", octave: 4 },
          { step: "D", octave: 5 },
        ]),
        chord("plain", "quarter", [
          { step: "E", octave: 4 },
          { step: "G", octave: 4 },
          { step: "B", octave: 4 },
          { step: "E", octave: 5 },
        ]),
        chord("auto", "quarter", [
          { step: "F", octave: 4 },
          { step: "A", octave: 4 },
          { step: "C", octave: 5 },
          { step: "F", octave: 5 },
        ]),
      ],
      {
        arpeggios: [
          arpeggio("up", [0, 1], "up", true),
          arpeggio("down", [1, 4], "down", true),
          arpeggio("plain", [1, 2], "up", false),
          arpeggio("auto", [3, 4], "auto", false),
        ],
      },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Arpeggio directions and arrows",
};

export const WideSpreadArpeggio: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        chord("wide", "whole", [
          { step: "C", octave: 3 },
          { step: "G", octave: 3 },
          { step: "E", octave: 4 },
          { step: "C", octave: 5 },
        ]),
      ],
      { arpeggios: [arpeggio("wide", [0, 1], "up", true)] },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Wide-spread arpeggio",
};

export const NonArpeggioBracket: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        chord("non", "whole", [
          { step: "C", octave: 4 },
          { step: "E", octave: 4 },
          { step: "G", octave: 4 },
          { step: "C", octave: 5 },
        ]),
      ],
      { nonArpeggios: [nonArpeggio("non", [0, 1])] },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Non-arpeggio bracket",
};

export const MixedArpeggioAndNonArpeggio: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              chord("m1a", "half", [
                { step: "C", octave: 4 },
                { step: "E", octave: 4 },
                { step: "G", octave: 4 },
                { step: "C", octave: 5 },
              ]),
              chord("m1n", "half", [
                { step: "D", octave: 4 },
                { step: "F", octave: 4 },
                { step: "A", octave: 4 },
                { step: "D", octave: 5 },
              ]),
            ],
          ],
          arpeggios: [arpeggio("m1a", [0, 1], "up", true)],
          nonArpeggios: [nonArpeggio("m1n", [1, 2])],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Arpeggio and non-arpeggio",
};
