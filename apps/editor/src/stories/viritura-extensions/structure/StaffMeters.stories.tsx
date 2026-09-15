import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Staff Meters",
  component: ScorePreview,
};

export default meta;

/**
 * A two-staff (piano-like) part where the global measure carries `count`/
 * `unit`, and staff 2 authors a `_x.viritura.staffMeters` declaration from
 * measure 1 (`declareAtMeasure`) — a local `staffMeter` with the given
 * `synchronization`. Barlines always stay synchronized to the global grid;
 * only the notated meter and (for `fitMeasure`) the note-to-note mapping
 * differ. Pass `resetAtMeasure` to add a second measure that resets staff 2
 * back to following the global meter.
 */
function staffMeterScoreJson(options: {
  count: number;
  unit: number;
  staffMeter: { count: number; unit: number; beatStructure?: number[] };
  synchronization: "sharedDuration" | "fitMeasure";
  /** Staff 2's written content for the declaration measure. */
  staffContent: unknown[];
  /** Staff 2's written content for a following, unchanged measure. */
  followingContent?: unknown[];
  /** Add a third measure resetting staff 2 back to the global meter. */
  resetContent?: unknown[];
}): string {
  const clefs = [
    { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
    { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
  ];
  const staff1Content = [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }];

  const measures: Record<string, unknown>[] = [
    {
      clefs,
      sequences: [
        { staff: 1, content: staff1Content },
        { staff: 2, content: options.staffContent },
      ],
      _x: {
        viritura: {
          staffMeters: [
            {
              staff: 2,
              meter: {
                count: options.staffMeter.count,
                unit: options.staffMeter.unit,
                ...(options.staffMeter.beatStructure ? { beatStructure: options.staffMeter.beatStructure } : {}),
              },
              synchronization: options.synchronization,
            },
          ],
        },
      },
    },
  ];

  if (options.followingContent) {
    measures.push({
      sequences: [
        { staff: 1, content: staff1Content },
        { staff: 2, content: options.followingContent },
      ],
    });
  }

  if (options.resetContent) {
    measures.push({
      sequences: [
        { staff: 1, content: staff1Content },
        { staff: 2, content: options.resetContent },
      ],
      _x: { viritura: { staffMeters: [{ staff: 2, useGlobal: true }] } },
    });
  }

  return JSON.stringify({
    mnx: { version: 1 },
    global: {
      measures: measures.map((_, index) => ({
        ...(index === 0 ? { time: { count: options.count, unit: options.unit } } : {}),
      })),
    },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures,
      },
    ],
  });
}

function note(step: string, octave: number, duration: { base: string; dots?: number }) {
  return { duration, notes: [{ pitch: { step, octave } }] };
}

/**
 * Global 3/4 with staff 2 (bass clef) declaring a synchronous `sharedDuration`
 * 6/8: both meters share the same 3-quarter-note-beat measure duration, so
 * staff 2's ordinary 6/8 written durations (two dotted-quarter pulses) need
 * no scaling — the barline lands at the same place for both staves. Staff 2
 * prints its own "6/8" time signature while staff 1 keeps "3/4".
 */
export const SharedDurationSixEightOverThreeFour: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={staffMeterScoreJson({
        count: 3,
        unit: 4,
        staffMeter: { count: 6, unit: 8 },
        synchronization: "sharedDuration",
        staffContent: [note("C", 3, { base: "quarter", dots: 1 }), note("G", 2, { base: "quarter", dots: 1 })],
        followingContent: [note("C", 3, { base: "quarter", dots: 1 }), note("G", 2, { base: "quarter", dots: 1 })],
      })}
    />
  ),
  name: "3/4 vs. shared-duration 6/8",
};

/**
 * Global 2/4 with staff 2 declaring a `fitMeasure` 6/8: the local measure's
 * two dotted-quarter pulses (3 written quarter-note-equivalent beats) map
 * onto the global measure's two quarter-note pulses (2 beats) by a derived
 * exact 2/3 ratio. Staff 2's dotted quarters play and space as if compressed
 * to 2/3 their written value, so its second pulse still lands under staff
 * 1's second quarter-note beat.
 */
export const FitMeasureSixEightOverTwoFour: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={staffMeterScoreJson({
        count: 2,
        unit: 4,
        staffMeter: { count: 6, unit: 8 },
        synchronization: "fitMeasure",
        staffContent: [note("C", 3, { base: "quarter", dots: 1 }), note("G", 2, { base: "quarter", dots: 1 })],
      })}
    />
  ),
  name: "2/4 vs. fit-measure 6/8",
};

/**
 * Global 4/4 with staff 2 declaring a `fitMeasure` 12/8: four dotted-quarter
 * pulses (6 written quarter-note-equivalent beats) mapped onto the global
 * measure's four quarter-note pulses (4 beats) — the same derived 2/3 ratio
 * as the 6/8-over-2/4 case, since both are "compound meter over its simple
 * counterpart at the same pulse count".
 */
export const FitMeasureTwelveEightOverFourFour: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={staffMeterScoreJson({
        count: 4,
        unit: 4,
        staffMeter: { count: 12, unit: 8, beatStructure: [3, 3, 3, 3] },
        synchronization: "fitMeasure",
        staffContent: [
          note("C", 3, { base: "quarter", dots: 1 }),
          note("G", 2, { base: "quarter", dots: 1 }),
          note("C", 3, { base: "quarter", dots: 1 }),
          note("G", 2, { base: "quarter", dots: 1 }),
        ],
      })}
    />
  ),
  name: "4/4 vs. fit-measure 12/8",
};

/**
 * A third measure resets staff 2 back to following the global meter
 * (`_x.viritura.staffMeters: [{ staff, useGlobal: true }]`). Staff 2 shows
 * its own fitMeasure 6/8 for the first two measures, then reprints the
 * shared 2/4 once it returns to the global meter.
 */
export const ResetToGlobal: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={staffMeterScoreJson({
        count: 2,
        unit: 4,
        staffMeter: { count: 6, unit: 8 },
        synchronization: "fitMeasure",
        staffContent: [note("C", 3, { base: "quarter", dots: 1 }), note("G", 2, { base: "quarter", dots: 1 })],
        followingContent: [note("C", 3, { base: "quarter", dots: 1 }), note("G", 2, { base: "quarter", dots: 1 })],
        resetContent: [note("C", 3, { base: "quarter" }), note("G", 2, { base: "quarter" })],
      })}
    />
  ),
  name: "Reset to global meter",
};
