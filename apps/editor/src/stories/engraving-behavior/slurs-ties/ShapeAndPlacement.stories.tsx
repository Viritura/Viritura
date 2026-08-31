import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Shape and Placement",
  component: ScorePreview,
};

export default meta;

// ───────────────────────────────────────────────────────────────
// Direction shapes
// ───────────────────────────────────────────────────────────────

export const Ascending: StoryObj = {
  name: "Ascending phrase",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "a1", notes: [{ step: "C", octave: 4 }], slurs: [{ target: "a4" }] },
              { duration: "quarter", id: "a2", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", id: "a3", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "a4", notes: [{ step: "C", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const Descending: StoryObj = {
  name: "Descending phrase",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "d1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "d4" }] },
              { duration: "quarter", id: "d2", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "d3", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", id: "d4", notes: [{ step: "C", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const Flat: StoryObj = {
  name: "Repeated pitch",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "f1", notes: [{ step: "G", octave: 4 }], slurs: [{ target: "f4" }] },
              { duration: "quarter", id: "f2", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "f3", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "f4", notes: [{ step: "G", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const Mountain: StoryObj = {
  name: "Arch-shaped phrase",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "m1", notes: [{ step: "C", octave: 4 }], slurs: [{ target: "m4" }] },
              { duration: "quarter", id: "m2", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "m3", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", id: "m4", notes: [{ step: "C", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const Valley: StoryObj = {
  name: "Valley-shaped phrase",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "v1", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "v4" }] },
              { duration: "quarter", id: "v2", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", id: "v3", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", id: "v4", notes: [{ step: "C", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const AutoSideHighNotes: StoryObj = {
  name: "Automatic placement above high notes",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "h1", notes: [{ step: "A", octave: 5 }], slurs: [{ target: "h4" }] },
              { duration: "quarter", id: "h2", notes: [{ step: "B", octave: 5 }] },
              { duration: "quarter", id: "h3", notes: [{ step: "C", octave: 6 }] },
              { duration: "quarter", id: "h4", notes: [{ step: "D", octave: 6 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const AutoSideLowNotes: StoryObj = {
  name: "Automatic placement below low notes",
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", id: "lo1", notes: [{ step: "F", octave: 4 }], slurs: [{ target: "lo4" }] },
              { duration: "quarter", id: "lo2", notes: [{ step: "E", octave: 4 }] },
              { duration: "quarter", id: "lo3", notes: [{ step: "D", octave: 4 }] },
              { duration: "quarter", id: "lo4", notes: [{ step: "C", octave: 4 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
