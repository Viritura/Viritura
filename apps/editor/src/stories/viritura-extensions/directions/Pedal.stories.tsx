import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Pedal Marks",
  component: ScorePreview,
};

export default meta;

/** All pedal types: sustain (text), sostenuto, una corda in one multi-measure view. */
export const AllPedalTypes: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
            ],
          ],
          virituraPartMeasure: {
            pedals: [
              {
                type: "sustain",
                position: { fraction: [0, 1] },
                end: { measure: "m1", position: { fraction: [3, 4] } },
              },
            ],
          },
        },
        {
          id: "m2",
          voices: [
            [
              { duration: "half", notes: [{ step: "E", octave: 4 }] },
              { duration: "half", notes: [{ step: "G", octave: 4 }] },
            ],
          ],
          virituraPartMeasure: {
            pedals: [
              {
                type: "sostenuto",
                position: { fraction: [0, 1] },
                end: { measure: "m2", position: { fraction: [1, 2] } },
              },
            ],
          },
        },
        {
          id: "m3",
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
          virituraPartMeasure: {
            pedals: [
              {
                type: "una-corda",
                position: { fraction: [0, 1] },
                end: { measure: "m3", position: { fraction: [3, 4] } },
              },
            ],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Sustain, sostenuto, and una corda",
};

type InteractiveArgs = { pedalType: string; style: string };

/** Pick pedal type and style with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try pedal types and styles",
  args: { pedalType: "sustain", style: "text" },
  argTypes: {
    pedalType: { control: { type: "select" }, options: ["sustain", "sostenuto", "una-corda"] },
    style: { control: { type: "select" }, options: ["text", "bracket"] },
  },
  render: ({ pedalType, style }) => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
            ],
          ],
          virituraPartMeasure: {
            pedals: [
              {
                type: pedalType,
                ...(style !== "text" ? { style } : {}),
                position: { fraction: [0, 1] },
                end: { measure: "m1", position: { fraction: [3, 4] } },
              },
            ],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

/**
 * Una corda pedal uses italic "una corda" / "tre corde" text labels
 * instead of SMuFL glyphs (no SMuFL una corda glyph exists).
 * Compare with sustain (Ped / *) and sostenuto (Sost / *) above.
 */
export const UnaCordaTextRendering: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
            ],
          ],
          virituraPartMeasure: {
            pedals: [
              {
                type: "una-corda",
                position: { fraction: [0, 1] },
                end: { measure: "m1", position: { fraction: [3, 4] } },
              },
            ],
          },
        },
        {
          id: "m2",
          voices: [
            [
              { duration: "quarter", notes: [{ step: "D", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
            ],
          ],
          virituraPartMeasure: {
            pedals: [
              {
                type: "una-corda",
                position: { fraction: [0, 1] },
                end: { measure: "m2", position: { fraction: [3, 4] } },
              },
            ],
          },
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Una corda (italic text)",
};
