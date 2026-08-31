import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Dynamics & Tempo/Dynamics",
  component: ScorePreview,
};

export default meta;

const ALL_DYNAMICS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"] as const;

export const AllDynamicLevels: StoryObj = {
  render: () => {
    // One whole note per measure, each with a different dynamic
    const mnx = buildMnx({
      measures: ALL_DYNAMICS.map((value, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
        voices: [[{ duration: "whole", notes: [{ step: "E", octave: 4 }] }]],
        dynamics: [{ value, position: { fraction: [0, 1] } }],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All eight dynamic levels",
};

export const AllDynamicGroupTypes: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
          dynamics: [
            {
              type: "accent",
              accentPrefix: "",
              value: "f",
              residualValue: "p",
              accentSuffix: "",
              position: { fraction: [0, 1] },
            },
          ],
        },
        {
          id: "m2",
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 4 }] }]],
          dynamics: [
            {
              type: "gradual",
              position: { fraction: [0, 1] },
              end: { measure: "m2", position: { fraction: [3, 4] } },
              wedgeType: "increasing",
            },
          ],
        },
        {
          id: "m3",
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 4 }] }]],
          dynamics: [
            {
              type: "relative",
              relativeValue: "louder",
              prefix: "più",
              position: { fraction: [0, 1] },
            },
          ],
        },
        {
          id: "m4",
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 4 }] }]],
          dynamics: [
            {
              type: "accent",
              value: "f",
              accentSuffix: "",
              suffix: "subito",
              position: { fraction: [0, 1] },
            },
          ],
        },
        {
          id: "m5",
          voices: [[{ duration: "whole", notes: [{ step: "G", octave: 4 }] }]],
          dynamics: [{ type: "immediate", value: "n", prefix: "al", suffix: "niente", position: { fraction: [0, 1] } }],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Dynamic groups, affixes, and niente",
};

type DynamicArgs = {
  dynamic: (typeof ALL_DYNAMICS)[number];
};

export const Interactive: StoryObj<DynamicArgs> = {
  args: {
    dynamic: "mf",
  },
  argTypes: {
    dynamic: {
      control: { type: "select" },
      options: [...ALL_DYNAMICS],
      description: "The dynamic marking to display",
    },
  },
  render: ({ dynamic }) => {
    const mnx = buildSingleMeasure(
      [
        { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "E", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
      ],
      {
        dynamics: [{ value: dynamic, position: { fraction: [0, 1] } }],
      },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Try dynamic markings",
};

export const FortePiano: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "E", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
      ],
      {
        dynamics: [
          { value: "ff", position: { fraction: [0, 1] } },
          { value: "ppp", position: { fraction: [3, 4] } },
        ],
      },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Multiple dynamics (ff \u2192 ppp)",
};

export const VoiceLinkedDynamics: StoryObj = {
  render: () => {
    const upperVoice = [
      { duration: "eighth", rest: true },
      { duration: "eighth", notes: [{ step: "G", octave: 5 }] },
      { duration: "eighth", notes: [{ step: "F", octave: 5 }] },
      { duration: "eighth", notes: [{ step: "E", octave: 5 }] },
      { duration: "eighth", notes: [{ step: "D", octave: 5 }] },
      { duration: "eighth", notes: [{ step: "C", octave: 5 }] },
      { duration: "eighth", notes: [{ step: "B", octave: 4 }] },
      { duration: "eighth", notes: [{ step: "A", octave: 4 }] },
    ];
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [upperVoice, [{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
          dynamics: [
            {
              type: "accent",
              accentPrefix: "",
              value: "f",
              residualValue: "p",
              accentSuffix: "",
              voice: "v2",
              position: { fraction: [0, 1] },
            },
            { type: "immediate", value: "f", voice: "v1", position: { fraction: [1, 8] } },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Voice-linked dynamics (upper f / lower fp)",
};

/**
 * MNX 27 encodes an accent structurally: `accentPrefix` defaults to `s`,
 * `accentSuffix` to `z`, and `value` is the attack level — so a bare accent
 * spells `sfz`. Mirrors the spec's "Dynamic accents" example.
 */
export const AccentSpellings: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
      ],
      {
        dynamics: [
          { type: "accent", value: "f", position: { fraction: [0, 1] } },
          { type: "accent", accentPrefix: "r", value: "f", position: { fraction: [1, 4] } },
          { type: "accent", accentPrefix: "", value: "f", position: { fraction: [1, 2] } },
          { type: "accent", value: "f", accentSuffix: "", position: { fraction: [3, 4] } },
        ],
      },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Accent spellings (sfz, rfz, fz, sf)",
};

/**
 * `residualValue` is the level that persists after the attack, which is how
 * MNX 27 encodes `fp` and its `sfp` / `sfpp` relatives.
 */
export const AccentResidualValues: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
          dynamics: [
            {
              type: "accent",
              accentPrefix: "",
              value: "f",
              residualValue: "p",
              accentSuffix: "",
              position: { fraction: [0, 1] },
            },
          ],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
          dynamics: [
            { type: "accent", value: "f", residualValue: "p", accentSuffix: "", position: { fraction: [0, 1] } },
          ],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
          dynamics: [
            { type: "accent", value: "f", residualValue: "pp", accentSuffix: "", position: { fraction: [0, 1] } },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Accent residual values (fp, sfp, sfpp)",
};

/** MNX 27 widened the dynamic scale out to six p's and six f's. */
export const ExtremeDynamicLevels: StoryObj = {
  render: () => {
    const levels = ["pppppp", "ppppp", "pppp", "ffff", "fffff", "ffffff"] as const;
    const mnx = buildMnx({
      measures: levels.map((value, index) => ({
        ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
        voices: [[{ duration: "whole", notes: [{ step: "E", octave: 4 }] }]],
        dynamics: [{ type: "immediate", value, position: { fraction: [0, 1] } }],
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Extreme levels (pppppp \u2026 ffffff)",
};
