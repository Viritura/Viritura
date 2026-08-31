import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Ties/Placement and Laissez Vibrer",
  component: ScorePreview,
};

export default meta;

/**
 * Laissez vibrer (l.v.) tie — a trailing tie with no destination note.
 */
export const LaissezVibrer: StoryObj = {
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
                    content: [
                      {
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            pitch: { step: "E", octave: 5 },
                            ties: [{ lv: true }],
                          },
                        ],
                      },
                      {
                        duration: { base: "half" },
                        rest: {},
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
  name: "Laissez vibrer (l.v.)",
};

/**
 * Ties with explicit side control (up or down).
 */
export const TieSide: StoryObj = {
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
                    content: [
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            id: "n1",
                            pitch: { step: "E", octave: 5 },
                            ties: [{ target: "n2", side: "up" }],
                          },
                        ],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "n2", pitch: { step: "E", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            id: "n3",
                            pitch: { step: "E", octave: 5 },
                            ties: [{ target: "n4", side: "down" }],
                          },
                        ],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "n4", pitch: { step: "E", octave: 5 } }],
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
  name: "Ties above and below notes",
};

/**
 * Combined view: l.v. ties and explicit side control.
 */
export const AllVariations: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: {
          measures: [{ time: { count: 4, unit: 4 } }, {}],
        },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      // Side up tie
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            id: "a1",
                            pitch: { step: "E", octave: 5 },
                            ties: [{ target: "a2", side: "up" }],
                          },
                        ],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "a2", pitch: { step: "E", octave: 5 } }],
                      },
                      // Side down tie
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            id: "b1",
                            pitch: { step: "E", octave: 5 },
                            ties: [{ target: "b2", side: "down" }],
                          },
                        ],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "b2", pitch: { step: "E", octave: 5 } }],
                      },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [
                      // Standard tie for comparison
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            id: "c1",
                            pitch: { step: "G", octave: 5 },
                            ties: [{ target: "c2" }],
                          },
                        ],
                      },
                      {
                        duration: { base: "quarter" },
                        notes: [{ id: "c2", pitch: { step: "G", octave: 5 } }],
                      },
                      // L.V. tie
                      {
                        duration: { base: "quarter" },
                        notes: [
                          {
                            pitch: { step: "A", octave: 5 },
                            ties: [{ lv: true }],
                          },
                        ],
                      },
                      {
                        duration: { base: "quarter" },
                        rest: {},
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
  name: "Tie placement and l.v. variations",
};

type InteractiveArgs = { lv: boolean; side: string };

export const TiePropertiesInteractive: StoryObj<InteractiveArgs> = {
  name: "Try tie placement and l.v.",
  args: { lv: false, side: "auto" },
  argTypes: {
    lv: { control: "boolean" },
    side: { control: { type: "select" }, options: ["auto", "up", "down"] },
  },
  render: ({ lv, side }) => {
    const tieObj: Record<string, unknown> = {};
    if (lv) {
      tieObj.lv = true;
    } else {
      tieObj.target = "t2";
    }
    if (side !== "auto") {
      tieObj.side = side;
    }

    const content: Record<string, unknown>[] = [
      {
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 5 } }],
      },
      {
        duration: { base: "quarter" },
        notes: [
          {
            id: "t1",
            pitch: { step: "E", octave: 5 },
            ties: [tieObj],
          },
        ],
      },
    ];

    if (!lv) {
      content.push(
        {
          duration: { base: "quarter" },
          notes: [{ id: "t2", pitch: { step: "E", octave: 5 } }],
        },
        {
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "G", octave: 5 } }],
        },
      );
    } else {
      content.push({
        duration: { base: "half" },
        rest: {},
      });
    }

    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [{ content }],
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
};
