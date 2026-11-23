import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Staves, Systems & Scores/Condensing",
  component: ScorePreview,
};

export default meta;

// ═══════════════════════════════════════════════════
// A2 (Unison) — both parts identical → single voice, "a 2" label
// ═══════════════════════════════════════════════════

const a2Mnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}],
    },
    parts: [
      {
        id: "fl1",
        name: "Flute",
        shortName: "Fl.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "F" } }] },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "G" } }] },
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "A" } }] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "fl2",
        name: "Flute",
        shortName: "Fl.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "F" } }] },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "G" } }] },
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "A" } }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    layouts: [
      {
        id: "cond",
        content: [
          {
            type: "staff",
            label: "Fl. 1, 2",
            sources: [{ part: "fl1" }, { part: "fl2" }],
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
  },
  null,
  2,
);

export const A2Unison: StoryObj = {
  render: () => <ScorePreview mnxJson={a2Mnx} />,
  name: "A2 unison with identical notes merged",
};

// ═══════════════════════════════════════════════════
// Amalgamate — same rhythm, different pitches → combined chords
// ═══════════════════════════════════════════════════

const amalgMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }],
    },
    parts: [
      {
        id: "ob1",
        name: "Oboe",
        shortName: "Ob.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "F" } }] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "ob2",
        name: "Oboe",
        shortName: "Ob.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "G" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "A" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "B" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    layouts: [
      {
        id: "cond",
        content: [
          {
            type: "staff",
            label: "Ob. 1, 2",
            sources: [{ part: "ob1" }, { part: "ob2" }],
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
  },
  null,
  2,
);

export const Amalgamate: StoryObj = {
  render: () => <ScorePreview mnxJson={amalgMnx} />,
  name: "Amalgamate — same rhythm, different pitches",
};

// ═══════════════════════════════════════════════════
// Divisi — different rhythms → separate voices
// ═══════════════════════════════════════════════════

const divisiMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }],
    },
    parts: [
      {
        id: "cl1",
        name: "Clarinet",
        shortName: "Cl.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "cl2",
        name: "Clarinet",
        shortName: "Cl.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "F" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "G" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "A" } }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    layouts: [
      {
        id: "cond",
        content: [
          {
            type: "staff",
            label: "Cl. 1, 2",
            sources: [{ part: "cl1" }, { part: "cl2" }],
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
  },
  null,
  2,
);

export const Divisi: StoryObj = {
  render: () => <ScorePreview mnxJson={divisiMnx} />,
  name: "Divisi — different rhythms, separate voices",
};

const tripletHandoffMnx = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [{ id: "m1", time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
  parts: [5, 4].map((octave, index) => {
    const run = Array.from({ length: 4 }, (_, group) => ({
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "16th" } },
      outer: { multiple: 2, duration: { base: "16th" } },
      content: ["C", "D", "E"].map((step) => ({
        id: `cl${index + 1}-triplet${group}-${step}`,
        duration: { base: "16th" },
        notes: [{ pitch: { step, octave } }],
      })),
    }));
    const rest = { duration: { base: "half" }, rest: {} };
    return {
      id: `cl${index + 1}`,
      name: "Clarinet",
      measures: [{ sequences: [{ content: index === 0 ? [...run, rest] : [rest, ...run] }] }],
    };
  }),
  layouts: [
    {
      id: "cond",
      content: [{ type: "staff", label: "Cl. 1, 2", sources: [{ part: "cl1" }, { part: "cl2" }] }],
    },
  ],
  scores: [{ name: "Condensed", layout: "cond" }],
});

export const TripletHandoff: StoryObj = {
  render: () => <ScorePreview mnxJson={tripletHandoffMnx} />,
  name: "Divisi triplet handoff with leading and trailing rests",
};

// ═══════════════════════════════════════════════════
// Solo — one part rests
// ═══════════════════════════════════════════════════

const soloMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }],
    },
    parts: [
      {
        id: "hn1",
        name: "Horn",
        shortName: "Hn.",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "F" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "G" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "A" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "B" } }] },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "hn2",
        name: "Horn",
        shortName: "Hn.",
        measures: [{ sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }] }],
      },
    ],
    layouts: [
      {
        id: "cond",
        content: [
          {
            type: "staff",
            label: "Hn. 1, 2",
            sources: [{ part: "hn1" }, { part: "hn2" }],
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
  },
  null,
  2,
);

export const Solo: StoryObj = {
  render: () => <ScorePreview mnxJson={soloMnx} />,
  name: "Solo — one part rests, '1.' label",
};

export const DelayedPlayerEntry: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [0, 1].map((index) => ({
          id: `fl${index + 1}`,
          name: "Flute",
          measures: [
            {
              sequences: [
                {
                  content:
                    index === 0
                      ? [
                          { duration: { base: "quarter" }, rest: {} },
                          {
                            type: "tuplet",
                            inner: { multiple: 6, duration: { base: "16th" } },
                            outer: { multiple: 4, duration: { base: "16th" } },
                            content: ["G", "F", "E", "D", "C", "B"].map((step) => ({
                              duration: { base: "16th" },
                              notes: [{ pitch: { step, octave: 5 } }],
                            })),
                          },
                          { duration: { base: "half" }, rest: {} },
                        ]
                      : [{ duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
          ],
        })),
        layouts: [
          {
            id: "cond",
            content: [{ type: "staff", label: "Fl. 1, 2", sources: [{ part: "fl1" }, { part: "fl2" }] }],
          },
        ],
        scores: [{ name: "Condensed", layout: "cond" }],
      })}
    />
  ),
  name: "Player label follows a rest to the first tuplet note",
};

// ═══════════════════════════════════════════════════
// Mode Transitions — A2 → Divisi → Solo across measures
// ═══════════════════════════════════════════════════

const transitionsMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}, {}, {}],
    },
    parts: [
      {
        id: "fl1",
        name: "Flute",
        shortName: "Fl.",
        measures: [
          // m0: A2 (identical)
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "F" } }] },
                ],
              },
            ],
          },
          // m1: Divisi (different rhythm)
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "G" } }] },
                  { type: "event", duration: { base: "half" }, notes: [{ pitch: { octave: 5, step: "A" } }] },
                ],
              },
            ],
          },
          // m2: Solo (Fl.2 rests)
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "F" } }] },
                ],
              },
            ],
          },
          // m3: Amalgamate (same rhythm, different pitches)
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { octave: 5, step: "C" } }] }],
              },
            ],
          },
        ],
      },
      {
        id: "fl2",
        name: "Flute",
        shortName: "Fl.",
        measures: [
          // m0: A2 (identical)
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "C" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "D" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 5, step: "F" } }] },
                ],
              },
            ],
          },
          // m1: Divisi (different rhythm)
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "E" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "F" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "G" } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "A" } }] },
                ],
              },
            ],
          },
          // m2: Solo (resting)
          { sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }] },
          // m3: Amalgamate (same rhythm, different pitch)
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { octave: 4, step: "G" } }] }],
              },
            ],
          },
        ],
      },
    ],
    layouts: [
      {
        id: "cond",
        content: [
          {
            type: "staff",
            label: "Fl. 1, 2",
            sources: [{ part: "fl1" }, { part: "fl2" }],
          },
        ],
      },
    ],
    scores: [{ name: "Condensed", pages: [{ systems: [{ measure: "0", layout: "cond" }] }] }],
  },
  null,
  2,
);

export const ModeTransitions: StoryObj = {
  render: () => <ScorePreview mnxJson={transitionsMnx} />,
  name: "Mode transitions from A2 through divisi, solo, and amalgamate",
};
