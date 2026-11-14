import type { Meta, StoryObj } from "@storybook/react-vite";
import { setKeySignature } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Clefs, Keys & Meter/Key Signatures",
  component: ScorePreview,
};

export default meta;

/**
 * All key signatures from C major (0) through sharps (1�7) and flats (-1 to -7)
 * in one multi-measure view (15 measures total).
 */
export const AllKeySignatures: StoryObj = {
  render: () => {
    const fifthsRange = [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];
    const mnx = buildMnx({
      measures: fifthsRange.map((fifths, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
        key: { fifths },
        voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Key signatures from seven flats to seven sharps",
};

type InteractiveArgs = { fifths: number };

/** Adjust the key signature with a fifths slider (-7 to 7). */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try key signatures",
  args: { fifths: 0 },
  argTypes: {
    fifths: { control: { type: "range", min: -7, max: 7, step: 1 } },
  },
  render: ({ fifths }) => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths },
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
};

export const KeyChange: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5, alter: 1 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 5, alter: 1 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
        {
          key: { fifths: -4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "A", octave: 4, alter: -1 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 4, alter: -1 }] },
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 4, alter: -1 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Change from E major to A-flat major",
};

export const AutomaticDoubleBarline: StoryObj = {
  name: "Automatic double barline at a key change",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths: 0 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        { voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]] },
      ],
    });
    const score = setKeySignature(parseMnx(JSON.parse(mnx)), 1, { fifths: 2 });
    return <ScorePreview mnxJson={JSON.stringify(serializeMnx(score))} />;
  },
};

export const CourtesyKeyChanges: StoryObj = {
  name: "System-end courtesy clefs, keys, meters, and unpitched staves",
  parameters: {
    docs: {
      description: {
        story:
          "Clef, key, and meter changes are announced at the preceding system end: the courtesy clef before the barline, then the courtesy key (with cancellation naturals) and meter after it on extended staff lines. The unpitched staff has no key signatures.",
      },
    },
  },
  render: () => {
    const meters = [4, 3, 3];
    const measures = [2, -3, 0].map((fifths, index) => ({
      id: `m${index}`,
      ...(index < 2 ? { time: { count: meters[index], unit: 4 } } : {}),
      key: { fifths },
    }));
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: { measures },
      parts: [
        {
          id: "pitched",
          name: "Cello",
          measures: measures.map((_, index) => ({
            ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
            ...(index === 2 ? { clefs: [{ clef: { sign: "F", staffPosition: 2 } }] } : {}),
            sequences: [
              {
                content: ["C", "D", "E", "G"].slice(0, meters[index]).map((step) => ({
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step, octave: index === 2 ? 3 : 5 } }],
                })),
              },
            ],
          })),
        },
        {
          id: "unpitched",
          name: "Percussion",
          measures: measures.map((_, index) => ({
            ...(index === 0 ? { clefs: [{ clef: { sign: "P", staffPosition: 0 } }] } : {}),
            sequences: [
              {
                content: [
                  {
                    duration: index === 0 ? { base: "whole" } : { base: "half", dots: 1 },
                    rest: {},
                  },
                ],
              },
            ],
          })),
        },
      ],
      layouts: [
        {
          id: "L",
          content: [
            { type: "staff", sources: [{ part: "pitched" }] },
            { type: "staff", sources: [{ part: "unpitched" }] },
          ],
        },
      ],
      scores: [
        {
          name: "Score",
          layout: "L",
          pages: [{ systems: measures.map((measure) => ({ measure: measure.id })) }],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} viewMode="page" />;
  },
};
