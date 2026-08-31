import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Notes, Stems & Voices/Cross-Staff Notation",
  component: ScorePreview,
};

export default meta;

/**
 * Cross-staff voice flip: when a cross-staff voice arrives on a staff, the
 * native voice flips to stems-up to make room (standard engraving practice).
 *
 * RH has half notes that would normally render stems-down (high pitches near
 * the top of the staff); LH cross-staffs into the treble staff on beats 2 & 4.
 * The RH stems flip up to clear space for the arriving cross-staff stems.
 */
function buildVoiceFlipMnx(): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          staves: 2,
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
              sequences: [
                {
                  staff: 1,
                  content: [
                    { duration: { base: "half" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                    { duration: { base: "half" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                  ],
                },
                {
                  staff: 2,
                  content: [
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                    { duration: { base: "quarter" }, staff: 1, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
                    { duration: { base: "quarter" }, staff: 1, notes: [{ pitch: { step: "F", octave: 4 } }] },
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
}

/**
 * Cross-staff suppresses home-staff rests.
 *
 * RH has rests on beats 2 & 4; LH cross-staffs notes up to the treble staff
 * on those exact beats. Per standard engraving, the redundant rests are omitted — the
 * arriving cross-staff voice fills that visual space.
 */
function buildSuppressedRestsMnx(): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          staves: 2,
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
              sequences: [
                {
                  staff: 1,
                  content: [
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                    { duration: { base: "quarter" }, rest: {} },
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                    { duration: { base: "quarter" }, rest: {} },
                  ],
                },
                {
                  staff: 2,
                  content: [
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                    { duration: { base: "quarter" }, staff: 1, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
                    { duration: { base: "quarter" }, staff: 1, notes: [{ pitch: { step: "G", octave: 4 } }] },
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
}

/**
 * Cross-staff tie: a note ties from the LH (bass) staff to a cross-staff note
 * on the treble staff. The tie curve threads through the gap between staves.
 */
function buildCrossStaffTiesMnx(): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          staves: 2,
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
              sequences: [
                {
                  staff: 1,
                  content: [{ duration: { base: "whole" }, rest: {} }],
                },
                {
                  staff: 2,
                  content: [
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 4 }, id: "n1", ties: [{ target: "n2" }] }],
                      staff: 1,
                    },
                    {
                      duration: { base: "half" },
                      notes: [{ pitch: { step: "E", octave: 4 }, id: "n2" }],
                      staff: 1,
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
}

/**
 * Cross-staff with accidentals: an LH cross-staff note carries an accidental.
 * The accidental glyph should position relative to the target staff (treble),
 * not the home staff (bass).
 */
function buildCrossStaffAccidentalsMnx(): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          staves: 2,
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
                { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
              ],
              sequences: [
                {
                  staff: 1,
                  content: [{ duration: { base: "whole" }, rest: {} }],
                },
                {
                  staff: 2,
                  content: [
                    { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 3 } }] },
                    {
                      duration: { base: "quarter" },
                      staff: 1,
                      notes: [{ pitch: { step: "F", octave: 4, alter: 1 } }],
                    },
                    {
                      duration: { base: "quarter" },
                      staff: 1,
                      notes: [{ pitch: { step: "B", octave: 4, alter: -1 } }],
                    },
                    {
                      duration: { base: "quarter" },
                      staff: 1,
                      notes: [{ pitch: { step: "C", octave: 5, alter: 1 } }],
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
}

export const VoiceFlip: StoryObj = {
  name: "Cross-staff voices flip native stems",
  render: () => <ScorePreview mnxJson={buildVoiceFlipMnx()} height={500} />,
};

export const SuppressedRests: StoryObj = {
  name: "Cross-staff voices suppress redundant rests",
  render: () => <ScorePreview mnxJson={buildSuppressedRestsMnx()} height={500} />,
};

export const CrossStaffTies: StoryObj = {
  name: "Ties between staves",
  render: () => <ScorePreview mnxJson={buildCrossStaffTiesMnx()} height={500} />,
};

export const CrossStaffAccidentals: StoryObj = {
  name: "Accidentals follow the target staff",
  render: () => <ScorePreview mnxJson={buildCrossStaffAccidentalsMnx()} height={500} />,
};
