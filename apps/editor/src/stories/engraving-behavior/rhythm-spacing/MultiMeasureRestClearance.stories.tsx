import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Rhythm & Spacing/Multi-Measure Rest Clearance",
  component: ScorePreview,
};

export default meta;

/**
 * Build MNX JSON with a multimeasure rest spanning `duration` bars.
 * Creates measures before/after the rest region with notes, and empty
 * measures in between that are collapsed by the multimeasureRests directive.
 */
const makeMultimeasureRestMnx = (duration: number) => {
  // First measure has notes, then `duration` empty measures, then a final measure with notes
  const globalMeasures: Record<string, unknown>[] = [{ id: "m1", time: { count: 4, unit: 4 } }];

  // Empty measures for the rest region
  for (let i = 0; i < duration; i++) {
    globalMeasures.push({ id: `mr${i + 1}` });
  }

  // Final measure with notes
  globalMeasures.push({ id: "mEnd" });

  const partMeasures: Record<string, unknown>[] = [
    {
      clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
      sequences: [
        {
          content: [
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "C", octave: 5 } }],
            },
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "D", octave: 5 } }],
            },
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "E", octave: 5 } }],
            },
            {
              duration: { base: "quarter" },
              notes: [{ pitch: { step: "F", octave: 5 } }],
            },
          ],
        },
      ],
    },
  ];

  // Empty measures (whole rests)
  for (let i = 0; i < duration; i++) {
    partMeasures.push({
      sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
    });
  }

  // Final measure
  partMeasures.push({
    sequences: [
      {
        content: [
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "G", octave: 5 } }],
          },
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "A", octave: 5 } }],
          },
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "B", octave: 5 } }],
          },
          {
            duration: { base: "quarter" },
            notes: [{ pitch: { step: "C", octave: 6 } }],
          },
        ],
      },
    ],
  });

  return JSON.stringify(
    {
      mnx: { version: 1 },
      layouts: [{ id: "L1", content: [{ type: "staff", sources: [{ part: "P1" }] }] }],
      scores: [
        {
          name: "Score",
          layout: "L1",
          multimeasureRests: [{ start: "mr1", duration }],
        },
      ],
      global: { measures: globalMeasures },
      parts: [{ id: "P1", measures: partMeasures }],
    },
    null,
    2,
  );
};

/**
 * Build a multimeasure rest whose first bar carries a tempo marking, so the
 * tempo text must rise above the big count number instead of overlapping it.
 */
const makeMultimeasureRestWithTempo = (duration: number) => {
  const json = JSON.parse(makeMultimeasureRestMnx(duration)) as {
    global: { measures: Record<string, unknown>[] };
  };
  // mr1 is the first collapsed (empty) bar — index 1 in global measures.
  const mr1 = json.global.measures[1];
  if (mr1) {
    mr1.tempos = [
      {
        bpm: 120,
        value: { base: "quarter" },
        _x: { viritura: { text: "Allegro molto vivace" } },
      },
    ];
  }
  return JSON.stringify(json, null, 2);
};

/**
 * Build a multimeasure rest whose first collapsed bar carries a time-signature
 * change. The H-bar and the (multi-digit) count number must start after the
 * time signature instead of overlapping it.
 */
const makeMultimeasureRestWithTimeChange = (duration: number) => {
  const json = JSON.parse(makeMultimeasureRestMnx(duration)) as {
    global: { measures: Record<string, unknown>[] };
  };
  // mr1 is the first collapsed bar — index 1 in global measures.
  const mr1 = json.global.measures[1];
  if (mr1) {
    mr1.time = { count: 3, unit: 4 };
  }
  return JSON.stringify(json, null, 2);
};

/**
 * A wide tempo at the START of a system that overhangs a following
 * multimeasure rest slides LEFT over the clef/key prefix — empty space above
 * the staff — rather than rising over the count number. Leftward motion at a
 * system start does not misrepresent the rhythmic position (the marking still
 * anchors to the measure start), so it is preferred to a vertical lift. The
 * two-sharp key signature widens the prefix, giving the marking room to slide.
 */
const makeSystemStartTempoDodge = () =>
  JSON.stringify(
    {
      mnx: { version: 1 },
      layouts: [{ id: "L1", content: [{ type: "staff", sources: [{ part: "P1" }] }] }],
      scores: [
        {
          name: "Score",
          layout: "L1",
          multimeasureRests: [{ start: "mr1", duration: 4 }],
        },
      ],
      global: {
        measures: [
          {
            id: "m1",
            time: { count: 4, unit: 4 },
            key: { fifths: 2 },
            tempos: [
              {
                bpm: 100,
                value: { base: "quarter" },
                _x: { viritura: { text: "Scherzando vivace", showMetronomeMark: false } },
              },
            ],
          },
          { id: "mr1" },
          { id: "mr2" },
          { id: "mr3" },
          { id: "mr4" },
        ],
      },
      parts: [
        {
          id: "P1",
          measures: [
            {
              clefs: [{ clef: { sign: "F", staffPosition: 2 } }],
              sequences: [
                {
                  content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 3 } }] }],
                },
              ],
            },
            { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
            { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
            { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
            { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
          ],
        },
      ],
    },
    null,
    2,
  );

/** Tempo text on a multimeasure rest hops above the count number. */
export const WithTempoOverNumber: StoryObj = {
  render: () => <ScorePreview mnxJson={makeMultimeasureRestWithTempo(4)} />,
  name: "Tempo sits above the rest count",
};

/**
 * Multimeasure rest beginning with a time-signature change and a two-digit
 * count: the H-bar and number clear the time signature and the wide count is
 * reserved horizontal space.
 */
export const WithTimeSignatureChange: StoryObj = {
  render: () => <ScorePreview mnxJson={makeMultimeasureRestWithTimeChange(24)} />,
  name: "Rest count and bar clear a time-signature change",
};

/**
 * System-start tempo dodges left over the clef/key prefix instead of lifting
 * over the following multimeasure-rest count number.
 */
export const SystemStartTempoDodgesLeft: StoryObj = {
  render: () => <ScorePreview mnxJson={makeSystemStartTempoDodge()} />,
  name: "System-start tempo shifts left over the prefix",
};
