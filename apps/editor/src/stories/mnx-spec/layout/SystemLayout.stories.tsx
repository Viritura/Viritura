import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Layout & Scores/System Layout",
  component: ScorePreview,
};

export default meta;

// ---------------------------------------------------------------------------
// Note helpers
// ---------------------------------------------------------------------------

function q(step: string, octave: number) {
  return { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}
function h(step: string, octave: number) {
  return { type: "event", duration: { base: "half" }, notes: [{ pitch: { step, octave } }] };
}
function w(step: string, octave: number) {
  return { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step, octave } }] };
}

// ---------------------------------------------------------------------------
// Story 1: Brackets and Braces
//   • String section — outer square bracket
//   • Piano grand staff — brace (one part, staves: 2)
// ---------------------------------------------------------------------------

function bracketsBracesMnx(showGroupName = false): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
      parts: [
        {
          id: "vn1",
          name: "Violin I",
          shortName: "Vn. I",
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [q("E", 5), q("F", 5), q("G", 5), q("A", 5)] }],
            },
          ],
        },
        {
          id: "vn2",
          name: "Violin II",
          shortName: "Vn. II",
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: [{ content: [q("C", 5), q("D", 5), q("E", 5), q("F", 5)] }],
            },
          ],
        },
        {
          id: "pno",
          name: "Piano",
          shortName: "Pno.",
          staves: 2,
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
              sequences: [
                { staff: 1, content: [q("G", 4), q("A", 4), q("B", 4), q("C", 5)] },
                { staff: 2, content: [q("C", 3), q("D", 3), q("E", 3), q("F", 3)] },
              ],
            },
          ],
        },
      ],
      layouts: [
        {
          id: "L",
          content: [
            {
              type: "group",
              symbol: "bracket",
              label: "Strings",
              _x: { viritura: { showGroupName } },
              barlineStyle: "unified",
              content: [
                { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "vn1" }] },
                { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "vn2" }] },
              ],
            },
            {
              type: "group",
              symbol: "brace",
              label: "Piano",
              barlineStyle: "unified",
              content: [
                { type: "staff", sources: [{ part: "pno", staff: 1 }] },
                { type: "staff", sources: [{ part: "pno", staff: 2 }] },
              ],
            },
          ],
        },
      ],
      scores: [{ name: "Score", layout: "L" }],
    },
    null,
    2,
  );
}

/**
 * Square bracket for the string section; piano brace spanning both grand-staff staves.
 * The piano is a single part with `staves: 2` and sequences targeting each staff.
 */
export const BracketsAndBraces: StoryObj = {
  render: () => <ScorePreview mnxJson={bracketsBracesMnx()} />,
  name: "Brackets and braces",
};

export const VerticalSectionName: StoryObj = {
  render: () => <ScorePreview mnxJson={bracketsBracesMnx(true)} />,
  name: "Vertical section name (bottom to top)",
};

// ---------------------------------------------------------------------------
// Story 2: Nested Sub-Groups
//   Woodwinds outer bracket → inner square sub-brackets per instrument family
//   (Flutes, Oboes, Clarinets) — same pattern as a real orchestral score.
// ---------------------------------------------------------------------------

const nestedGroupsMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}] },
    parts: [
      {
        id: "fl1",
        name: "Flute 1",
        shortName: "Fl. 1",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [q("C", 5), q("D", 5), q("E", 5), q("F", 5)] }],
          },
          { sequences: [{ content: [w("G", 5)] }] },
        ],
      },
      {
        id: "fl2",
        name: "Flute 2",
        shortName: "Fl. 2",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [q("G", 5), q("A", 5), q("B", 5), q("C", 6)] }],
          },
          { sequences: [{ content: [w("E", 5)] }] },
        ],
      },
      {
        id: "ob1",
        name: "Oboe 1",
        shortName: "Ob. 1",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [q("E", 5), q("F", 5), q("G", 5), q("A", 5)] }],
          },
          { sequences: [{ content: [w("F", 5)] }] },
        ],
      },
      {
        id: "ob2",
        name: "Oboe 2",
        shortName: "Ob. 2",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [q("C", 5), q("D", 5), q("E", 5), q("D", 5)] }],
          },
          { sequences: [{ content: [w("C", 5)] }] },
        ],
      },
      {
        id: "cl1",
        name: "Clarinet 1",
        shortName: "Cl. 1",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [q("D", 5), q("E", 5), q("F", 5), q("G", 5)] }],
          },
          { sequences: [{ content: [w("E", 5)] }] },
        ],
      },
      {
        id: "cl2",
        name: "Clarinet 2",
        shortName: "Cl. 2",
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [q("B", 4), q("C", 5), q("D", 5), q("C", 5)] }],
          },
          { sequences: [{ content: [w("C", 5)] }] },
        ],
      },
    ],
    layouts: [
      {
        id: "L",
        content: [
          {
            // Outer bracket — labels the whole family "Woodwinds"
            type: "group",
            symbol: "bracket",
            label: "Woodwinds",
            barlineStyle: "unified",
            content: [
              {
                // Inner square sub-bracket, drawn outside the family bracket
                type: "group",
                symbol: "square",
                content: [
                  { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "fl1" }] },
                  { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "fl2" }] },
                ],
              },
              {
                type: "group",
                symbol: "square",
                content: [
                  { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "ob1" }] },
                  { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "ob2" }] },
                ],
              },
              {
                type: "group",
                symbol: "square",
                content: [
                  { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "cl1" }] },
                  { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "cl2" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    scores: [{ name: "Score", layout: "L" }],
  },
  null,
  2,
);

/**
 * Orchestral sub-group pattern: the outer bracket labels the whole family
 * ("Woodwinds"); inner MNX `square` sub-brackets sit outside it and group each
 * instrument pair (Flutes, Oboes, Clarinets).
 */
export const NestedSubGroups: StoryObj = {
  render: () => <ScorePreview mnxJson={nestedGroupsMnx} />,
  name: "Nested orchestral groups",
};

/**
 * Nested MNX `bracket` groups draw as full brackets: the innermost brackets
 * stay beside the staff and the enclosing bracket steps outward.
 */
export const NestedFullBrackets: StoryObj = {
  render: () => <ScorePreview mnxJson={nestedGroupsMnx.replaceAll('"symbol": "square"', '"symbol": "bracket"')} />,
  name: "Nested full brackets",
};

// ---------------------------------------------------------------------------
// Story 3: noSymbol group
//   Two vocal parts share barlines (grouped) but have no bracket or brace.
//   Contrast with a solo piano brace below them.
// ---------------------------------------------------------------------------

const noSymbolMnx = JSON.stringify(
  {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
    parts: [
      {
        id: "sop",
        name: "Soprano",
        shortName: "S.",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [h("E", 5), h("D", 5)] }],
          },
        ],
      },
      {
        id: "alt",
        name: "Alto",
        shortName: "A.",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [h("C", 5), h("B", 4)] }],
          },
        ],
      },
      {
        id: "pno",
        name: "Piano",
        shortName: "Pno.",
        staves: 2,
        measures: [
          {
            clefs: [
              { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
              { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
            ],
            sequences: [
              { staff: 1, content: [q("G", 4), q("A", 4), q("G", 4), q("F", 4)] },
              { staff: 2, content: [h("C", 3), h("G", 2)] },
            ],
          },
        ],
      },
    ],
    layouts: [
      {
        id: "L",
        content: [
          {
            // noSymbol: staves share barlines but display no bracket/brace glyph
            type: "group",
            symbol: "noSymbol",
            barlineStyle: "unified",
            content: [
              { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "sop" }] },
              { type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "alt" }] },
            ],
          },
          {
            type: "group",
            symbol: "brace",
            label: "Piano",
            barlineStyle: "unified",
            content: [
              { type: "staff", sources: [{ part: "pno", staff: 1 }] },
              { type: "staff", sources: [{ part: "pno", staff: 2 }] },
            ],
          },
        ],
      },
    ],
    scores: [{ name: "Score", layout: "L" }],
  },
  null,
  2,
);

/**
 * `noSymbol` group: the soprano and alto staves share barlines and are treated
 * as a group, but no bracket or brace glyph is drawn. Contrast with the piano
 * brace immediately below.
 */
export const NoSymbolGroup: StoryObj = {
  render: () => <ScorePreview mnxJson={noSymbolMnx} />,
  name: "Grouped choir and piano without a bracket",
};
