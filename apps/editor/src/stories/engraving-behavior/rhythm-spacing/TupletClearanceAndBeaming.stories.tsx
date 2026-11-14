import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Rhythm & Spacing/Tuplet Clearance and Beaming",
  component: ScorePreview,
};

export default meta;

export const AdjacentTripletsBreakBeam: StoryObj = {
  render: () => {
    // Half note followed by two separate eighth-note triplets (Rhapsody m20
    // string pattern). Both triplets sit in the second half-measure, where
    // plain eighths would normally beam together. Standard engraving practice
    // separates these triplets at their intervening quarter-note beat.
    const triplet = (steps: string[]) => ({
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: steps.map((step) => ({
        duration: { base: "eighth" },
        notes: [{ pitch: { step, octave: 5 } }],
      })),
    });
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      { duration: { base: "half" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                      triplet(["E", "D", "E"]),
                      triplet(["D", "E", "D"]),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Adjacent triplets break the beam",
};

export const SixteenthTripletsShareBeat: StoryObj = {
  name: "Sixteenth triplets share a quarter-note beam",
  render: () => {
    const triplet = (steps: (string | null)[]) => ({
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "16th" } },
      outer: { multiple: 2, duration: { base: "16th" } },
      content: steps.map((step) => ({
        duration: { base: "16th" },
        ...(step ? { notes: [{ pitch: { step, octave: 5 } }] } : { rest: {} }),
      })),
    });
    const mnx = JSON.stringify({
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    { duration: { base: "half" }, rest: {} },
                    triplet([null, "G", "A"]),
                    triplet(["B", "C", "D"]),
                    triplet(["E", "F", "G"]),
                    { duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const TripletBracketClearsArticulations: StoryObj = {
  render: () => {
    // Stems-up eighth-note triplet with an accent on every note in a
    // two-voice measure (so articulations sit on the stem/bracket side).
    // Standard engraving practice keeps the tuplet bracket clear of the
    // articulations on its side, so the bracket must move out past the
    // accents rather than overlap them.
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      {
                        type: "tuplet",
                        inner: { multiple: 3, duration: { base: "eighth" } },
                        outer: { multiple: 2, duration: { base: "eighth" } },
                        content: [
                          {
                            duration: { base: "eighth" },
                            stemDirection: "up",
                            markings: { accent: {} },
                            notes: [{ pitch: { step: "C", octave: 5 } }],
                          },
                          {
                            duration: { base: "eighth" },
                            stemDirection: "up",
                            markings: { accent: {} },
                            notes: [{ pitch: { step: "D", octave: 5 } }],
                          },
                          {
                            duration: { base: "eighth" },
                            stemDirection: "up",
                            markings: { accent: {} },
                            notes: [{ pitch: { step: "E", octave: 5 } }],
                          },
                        ],
                      },
                      { duration: { base: "half" }, stemDirection: "up", notes: [{ pitch: { step: "F", octave: 5 } }] },
                    ],
                  },
                  {
                    content: [
                      {
                        duration: { base: "whole" },
                        stemDirection: "down",
                        notes: [{ pitch: { step: "F", octave: 4 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Triplet bracket clears articulations",
};

export const TripletBracketClearsInnerSlur: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    voice: "v1",
                    content: [
                      {
                        type: "tuplet",
                        inner: { multiple: 3, duration: { base: "quarter" } },
                        outer: { multiple: 2, duration: { base: "quarter" } },
                        content: [
                          {
                            id: "slur-start",
                            duration: { base: "quarter" },
                            notes: [{ pitch: { step: "C", octave: 4 } }],
                            slurs: [{ side: "up", target: "slur-end" }],
                          },
                          {
                            duration: { base: "quarter" },
                            notes: [{ pitch: { step: "D", octave: 4 } }],
                          },
                          {
                            id: "slur-end",
                            duration: { base: "quarter" },
                            notes: [{ pitch: { step: "E", octave: 4 } }],
                          },
                        ],
                      },
                      { duration: { base: "half" }, rest: {} },
                    ],
                  },
                  {
                    voice: "v2",
                    content: [
                      {
                        duration: { base: "whole" },
                        notes: [{ pitch: { step: "C", octave: 3 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Triplet bracket clears an inner slur",
};
