import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Glissandi",
  component: ScorePreview,
};

export default meta;

/** Both glissando styles (straight + wavy) in one measure. */
export const AllGlissandoStyles: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "quarter",
                id: "ev1",
                notes: [{ step: "C", octave: 4 }],
                virituraExtensions: { glissandos: [{ target: "ev2", style: "straight", text: "gliss." }] },
              },
              { duration: "quarter", id: "ev2", notes: [{ step: "E", octave: 5 }] },
              {
                duration: "quarter",
                id: "ev3",
                notes: [{ step: "G", octave: 5 }],
                virituraExtensions: { glissandos: [{ target: "ev4", style: "wavy", text: "gliss." }] },
              },
              { duration: "quarter", id: "ev4", notes: [{ step: "C", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Straight and wavy glissandi",
};

export const SlopedLabels: StoryObj = {
  name: "Labels follow rising and falling lines",
  render: () => {
    const mnx = buildMnx({
      measures: [false, true].map((descending, index) => ({
        time: { count: 4, unit: 4 },
        voices: [
          [
            {
              duration: "quarter",
              id: `s${index}`,
              notes: [{ step: descending ? "A" : "C", octave: 5 }],
              virituraExtensions: { glissandos: [{ target: `t${index}`, style: "straight", text: "gliss." }] },
            },
            { duration: "quarter", id: `t${index}`, notes: [{ step: descending ? "C" : "A", octave: 5 }] },
            {
              duration: "quarter",
              id: `w${index}`,
              notes: [{ step: descending ? "A" : "C", octave: 5 }],
              virituraExtensions: { glissandos: [{ target: `v${index}`, style: "wavy", text: "gliss." }] },
            },
            { duration: "quarter", id: `v${index}`, notes: [{ step: descending ? "C" : "A", octave: 5 }] },
          ],
        ],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

interface InteractiveArgs {
  lineType: string;
  kind: string;
  playbackType: string;
}

/** Pick glissando line type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try glissando line types",
  args: { lineType: "straight", kind: "glissando", playbackType: "diatonic" },
  argTypes: {
    lineType: { control: { type: "select" }, options: ["straight", "wavy"] },
    kind: { control: { type: "select" }, options: ["glissando", "portamento"] },
    playbackType: { control: { type: "select" }, options: ["chromatic", "diatonic", "pitch-bend"] },
  },
  render: ({ lineType, kind, playbackType }) => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                duration: "half",
                id: "ev1",
                notes: [{ step: "C", octave: 4 }],
                virituraExtensions: { glissandos: [{ target: "ev2", style: lineType, kind, playbackType }] },
              },
              { duration: "half", id: "ev2", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
