import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Text & Directions/Rehearsal-Mark Placement",
  component: ScorePreview,
};

export default meta;

// A rehearsal mark and a measure-start tempo both anchor at the bar start.
// They flow horizontally (flexbox-style) so the tempo text begins just right
// of the mark's box instead of stacking on top of it.
export const WithTempoFlow: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          virituraGlobal: { rehearsalMark: { text: [{ text: "A" }] } },
          tempos: [{ bpm: 132, value: { base: "quarter" }, _x: { viritura: { text: [{ text: "Allegro" }] } } }],
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Rehearsal mark beside tempo text",
};

// A rehearsal mark and an above-staff performance direction both land at the
// system start. The direction ("pizz.") stays aligned with its note; the
// rehearsal mark rises above it (standard engraving practice: the rehearsal
// mark owns the topmost slot) instead of shoving the direction sideways.
export const WithAboveExpressionFlow: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          virituraGlobal: { rehearsalMark: { text: [{ text: "2" }], style: "boxed" } },
          text: [{ type: "expression", text: [{ text: "pizz." }], position: { fraction: [0, 1] }, placement: "above" }],
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Rehearsal mark with an above-staff direction",
};

// The rehearsal mark's left border aligns with the measure's left barline.
// Standard engraving practice keeps the mark closest to the barline, so the
// box edge sits on the barline rather than indenting until the inner text
// lines up with the first note (which wasted the gap after the barline).
// Use a mid-system measure (second bar) so the barline is visible and the
// box hugs it directly.
export const BoxLeftAlignsWithBarline: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "B" }] } },
          voices: [[{ duration: "whole", notes: [{ step: "E", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Box aligns left with a mid-system barline",
};

export const AboveAscendingSlur: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", notes: [{ step: "C", octave: 5 }], slurs: [{ target: "slur-end", side: "up" }] },
              { duration: "eighth", notes: [{ step: "D", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "E", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "G", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "A", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "B", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "C", octave: 6 }] },
            ],
          ],
        },
        {
          virituraGlobal: { rehearsalMark: { text: [{ text: "B" }] } },
          voices: [
            [
              { id: "slur-end", duration: "quarter", notes: [{ step: "D", octave: 6 }] },
              { duration: "half", dots: 1, rest: true },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Rehearsal mark rises above an ascending slur",
};
