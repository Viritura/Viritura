import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Hairpins",
  component: ScorePreview,
  argTypes: {
    type: {
      control: "select",
      options: ["crescendo", "decrescendo"],
      description: "Gradual dynamic wedge direction",
    },
  },
  args: {
    type: "crescendo",
  },
};

export default meta;

type HairpinArgs = { type: string };

export const Default: StoryObj<HairpinArgs> = {
  render: (args) => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
          dynamics: [
            {
              type: "gradual",
              position: { fraction: [0, 1] },
              end: { measure: "m1", position: { fraction: [3, 4] } },
              wedgeType: args.type === "crescendo" ? "increasing" : "decreasing",
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Single hairpin",
};

export const CrescendoDecrescendo: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
          dynamics: [
            {
              type: "gradual",
              position: { fraction: [0, 1] },
              end: { measure: "m1", position: { fraction: [1, 2] } },
              wedgeType: "increasing",
            },
          ],
        },
        {
          id: "m2",
          voices: [
            [
              { duration: "quarter", notes: [{ step: "G", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
            ],
          ],
          dynamics: [
            {
              type: "gradual",
              position: { fraction: [0, 1] },
              end: { measure: "m2", position: { fraction: [3, 4] } },
              wedgeType: "decreasing",
            },
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Crescendo and decrescendo",
};

export const EndsAtMeasureEnd: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "half", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
          dynamics: [
            { value: "p", position: { fraction: [1, 2] } },
            {
              type: "gradual",
              position: { fraction: [1, 2] },
              end: { measure: "m1", position: { fraction: [1, 1] } },
              wedgeType: "increasing",
            },
          ],
        },
        {
          id: "m2",
          voices: [[{ duration: "whole", notes: [{ step: "F", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Ends at the barline",
};

/**
 * Harp glissando + cross-staff hairpin.
 *
 * Bar 1 holds a whole-note C3 in the bass staff whose wavy glissando climbs to
 * the quarter-note C5 that opens bar 2 on the treble staff — the way a harp
 * gliss is normally notated, with the line crossing the gap between staves.
 *
 * `staffEnd` angles the gradual dynamic from its start staff to another staff
 * in the same part: the crescendo opens under the bass staff and lands under
 * the treble staff, following the gliss upward. The group is authored only on
 * staff 2; it is not duplicated onto both staves.
 */
export const CrossStaff: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }],
        },
        parts: [
          {
            id: "P1",
            name: "Harp",
            staves: 2,
            measures: [
              {
                clefs: [
                  { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                  { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
                ],
                sequences: [
                  { staff: 1, content: [{ duration: { base: "whole" }, rest: {} }] },
                  {
                    staff: 2,
                    content: [
                      {
                        id: "harp-gliss-start",
                        duration: { base: "whole" },
                        notes: [{ pitch: { step: "C", octave: 3 } }],
                        _x: {
                          viritura: {
                            glissandos: [{ target: "harp-gliss-end", style: "wavy" }],
                          },
                        },
                      },
                    ],
                  },
                ],
                dynamics: [
                  {
                    id: "cross-staff-crescendo",
                    type: "gradual",
                    staff: 2,
                    staffEnd: 1,
                    position: { fraction: [0, 1] },
                    end: { measure: "m2", position: { fraction: [0, 1] } },
                    wedgeType: "increasing",
                  },
                ],
              },
              {
                sequences: [
                  {
                    staff: 1,
                    content: [
                      {
                        id: "harp-gliss-end",
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
                      },
                      { duration: { base: "quarter" }, rest: {} },
                      { duration: { base: "half" }, rest: {} },
                    ],
                  },
                  { staff: 2, content: [{ duration: { base: "whole" }, rest: {} }] },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} height={500} />;
  },
  name: "Cross-staff hairpin (harp gliss, staff 2 → staff 1)",
};
