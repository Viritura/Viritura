import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Beams",
  component: ScorePreview,
};

export default meta;

/**
 * All beam types in one multi-measure view:
 * Measure 1: Eighth note beams
 * Measure 2: Sixteenth note beams
 * Measure 3: Mixed durations (8th + 16th)
 * Measure 4: Beam hooks
 */
export const AllBeamTypes: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "eighth", notes: [{ step: "C", octave: 5 }] },
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
          voices: [
            [
              { duration: "16th", notes: [{ step: "C", octave: 5 }] },
              { duration: "16th", notes: [{ step: "D", octave: 5 }] },
              { duration: "16th", notes: [{ step: "E", octave: 5 }] },
              { duration: "16th", notes: [{ step: "F", octave: 5 }] },
              { duration: "16th", notes: [{ step: "G", octave: 5 }] },
              { duration: "16th", notes: [{ step: "A", octave: 5 }] },
              { duration: "16th", notes: [{ step: "B", octave: 5 }] },
              { duration: "16th", notes: [{ step: "C", octave: 6 }] },
              { duration: "16th", notes: [{ step: "B", octave: 5 }] },
              { duration: "16th", notes: [{ step: "A", octave: 5 }] },
              { duration: "16th", notes: [{ step: "G", octave: 5 }] },
              { duration: "16th", notes: [{ step: "F", octave: 5 }] },
              { duration: "16th", notes: [{ step: "E", octave: 5 }] },
              { duration: "16th", notes: [{ step: "D", octave: 5 }] },
              { duration: "16th", notes: [{ step: "C", octave: 5 }] },
              { duration: "16th", notes: [{ step: "B", octave: 4 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "eighth", notes: [{ step: "C", octave: 5 }] },
              { duration: "16th", notes: [{ step: "D", octave: 5 }] },
              { duration: "16th", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "G", octave: 5 }] },
              { duration: "eighth", notes: [{ step: "A", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "eighth", id: "e1", notes: [{ step: "C", octave: 5 }] },
              { duration: "16th", id: "e2", notes: [{ step: "D", octave: 5 }] },
              { duration: "16th", id: "e3", notes: [{ step: "E", octave: 5 }] },
              { duration: "16th", id: "e4", notes: [{ step: "F", octave: 5 }] },
              { duration: "eighth", id: "e5", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "A", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "B", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Eighth-note, sixteenth-note, mixed, and hooked beams",
};

type InteractiveArgs = { subdivision: string };

/** Pick beam subdivision level with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try beam subdivisions",
  args: { subdivision: "eighth" },
  argTypes: {
    subdivision: { control: { type: "select" }, options: ["eighth", "16th", "32nd"] },
  },
  render: ({ subdivision }) => {
    const steps = ["C", "D", "E", "F", "G", "A", "B"];
    const notesPerBeat = subdivision === "32nd" ? 8 : subdivision === "16th" ? 4 : 2;
    const totalNotes = notesPerBeat * 4;
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            Array.from({ length: totalNotes }, (_, j) => ({
              duration: subdivision,
              notes: [{ step: steps[j % 7], octave: 5 }],
            })),
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

const flagEvents = [
  { id: "ev1", duration: "eighth" as const, notes: [{ step: "C", octave: 5 }] },
  { id: "ev2", duration: "eighth" as const, notes: [{ step: "D", octave: 5 }] },
  { id: "ev3", duration: "eighth" as const, notes: [{ step: "E", octave: 5 }] },
  { id: "ev4", duration: "eighth" as const, notes: [{ step: "F", octave: 5 }] },
  { id: "ev5", duration: "eighth" as const, notes: [{ step: "G", octave: 4 }] },
  { id: "ev6", duration: "eighth" as const, notes: [{ step: "A", octave: 4 }] },
  { id: "ev7", duration: "eighth" as const, notes: [{ step: "B", octave: 4 }] },
  { id: "ev8", duration: "eighth" as const, notes: [{ step: "C", octave: 5 }] },
];

/**
 * The `support.useBeams` flag (MNX spec) tells the renderer to honor only
 * explicit `beams[]` blocks on the score and skip auto-beaming. With no
 * explicit beams declared, all flagged notes render as individual flagged
 * stems � useful for showing every eighth note as a separate flag.
 */
export const UseBeamsFlagOn: StoryObj = {
  render: () => <ScorePreview mnxJson={buildSingleMeasure(flagEvents, { support: { useBeams: true } })} />,
  name: "Use only explicitly notated beams",
};

export const UseBeamsFlagDefault: StoryObj = {
  render: () => <ScorePreview mnxJson={buildSingleMeasure(flagEvents)} />,
  name: "Beam automatically by beat",
};
