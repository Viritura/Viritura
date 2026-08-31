import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

/**
 * Engrave Mode — oversized orchestral system respects the page boundary.
 *
 * A full orchestral score can contain more staff bodies than the printable
 * page height can physically hold. The engine keeps the configured page box
 * fixed and compresses inter-staff spacing to zero before allowing overflow.
 * The workspace reports any remaining staff-line overflow so the user can
 * choose a smaller rastral, larger page, or hide unused staves.
 */
const meta: Meta = {
  title: "App/Engrave Mode/Oversized System",
  component: ScorePreview,
};
export default meta;

function w(step: string, octave: number) {
  return { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step, octave } }] };
}

const STAFF_COUNT = 30;
const STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const step = (i: number) => STEPS[i % STEPS.length] ?? "C";

const measures = Array.from({ length: 4 }, (_, i) => ({
  id: `m${i + 1}`,
  ...(i === 0 ? { time: { count: 4, unit: 4 }, key: { fifths: 0 } } : {}),
}));

const parts = Array.from({ length: STAFF_COUNT }, (_, p) => {
  const octave = 3 + (p % 4);
  return {
    id: `p${p + 1}`,
    name: `Inst ${p + 1}`,
    shortName: `I${p + 1}`,
    measures: [
      {
        clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
        sequences: [{ content: [w(step(p), octave)] }],
      },
      ...Array.from({ length: 3 }, (_, i) => ({
        sequences: [{ content: [w(step(p + i + 1), octave)] }],
      })),
    ],
  };
});

const score = {
  mnx: { version: 1 },
  global: { measures },
  parts,
  layouts: [
    {
      id: "L",
      content: parts.map((part) => ({
        type: "staff" as const,
        labelref: "shortName",
        sources: [{ part: part.id }],
      })),
    },
  ],
};

// One tall system in page mode. Staff spacing reaches its hard zero-gap floor;
// the configured page remains A4 so the workspace can flag the print overflow.
export const ThirtyStaffSystemExceedsA4: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify(
        {
          ...score,
          scores: [
            {
              name: "Engraved",
              layout: "L",
              pages: [{ systems: [{ measure: "m1" }] }],
            },
          ],
        },
        null,
        2,
      )}
    />
  ),
  name: "30-staff system exceeds A4",
};
