import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorScorePreview } from "../../storyFixtures/EditorScorePreview";

const rest = { duration: { base: "whole" }, rest: {} };
const note = { duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] };
const MEASURES = 12;
const SYSTEM_BREAKS = [
  { measure: "m4", kind: "system" },
  { measure: "m8", kind: "system" },
];

const fluteStaff = { type: "staff", sources: [{ part: "flute" }] };
const oboeStaff = { type: "staff", sources: [{ part: "oboe" }] };
const pianoGroup = {
  type: "group",
  symbol: "brace",
  content: [
    { type: "staff", sources: [{ part: "piano", staff: 1 }] },
    { type: "staff", sources: [{ part: "piano", staff: 2 }] },
  ],
};

interface AutoHideFixture {
  /** Extra `_x.viritura` keys for the full-score view. */
  policy?: Record<string, unknown>;
  /** Extra top-level keys for the full-score view (for example `pages`). */
  fullScore?: Record<string, unknown>;
  extraLayouts?: Record<string, unknown>[];
  extraScores?: Record<string, unknown>[];
}

/**
 * Twelve bars in three systems. The flute always plays; the oboe plays only in
 * the middle system; the piano left hand enters in the middle system and keeps
 * playing to the end. The first system is therefore empty for oboe and piano.
 */
function autoHideScore({ policy = {}, fullScore = {}, extraLayouts = [], extraScores = [] }: AutoHideFixture = {}) {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: MEASURES }, (_, index) => ({
        id: `m${index}`,
        ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
      })),
    },
    parts: ["flute", "oboe", "piano"].map((id) => ({
      id,
      name: id === "flute" ? "Flute" : id === "oboe" ? "Oboe" : "Piano",
      staves: id === "piano" ? 2 : 1,
      measures: Array.from({ length: MEASURES }, (_, index) => ({
        sequences: Array.from({ length: id === "piano" ? 2 : 1 }, (_, staff) => ({
          staff: staff + 1,
          content: [id === "flute" || (index >= 4 && ((id === "oboe" && index < 8) || staff === 1)) ? note : rest],
        })),
      })),
    })),
    layouts: [{ id: "L", content: [fluteStaff, oboeStaff, pianoGroup] }, ...extraLayouts],
    scores: [
      {
        name: "Auto-hide example",
        layout: "L",
        ...fullScore,
        _x: {
          viritura: {
            autoHideEmptyParts: ["oboe", "piano"],
            layoutBreaks: SYSTEM_BREAKS,
            ...policy,
          },
        },
      },
      ...extraScores,
    ],
  };
}

/** A woodwinds part view whose own policy differs from the full score's. */
const woodwindsPartView = {
  extraLayouts: [{ id: "L-woodwinds", content: [fluteStaff, oboeStaff] }],
  extraScores: [
    {
      name: "Woodwinds",
      layout: "L-woodwinds",
      _x: {
        viritura: {
          pageSetupRole: "part",
          autoHideEmptyParts: ["oboe"],
          autoHideEmptyStaves: { firstSystem: "show" },
          layoutBreaks: SYSTEM_BREAKS,
        },
      },
    },
  ],
};

const meta: Meta<typeof EditorScorePreview> = {
  title: "App/Engrave Mode/Auto-hide Empty Staves",
  component: EditorScorePreview,
  args: { mnxJson: JSON.stringify(autoHideScore()), showEditor: true, viewMode: "page" },
};
export default meta;
type Story = StoryObj<typeof EditorScorePreview>;

/**
 * Oboe and piano hide on the empty first system; every staff shows on the
 * second system; on the last system the oboe hides while the piano stays,
 * because music on either piano staff keeps the whole instrument.
 */
export const SelectedInstruments: Story = {};

/** A full-score opening: every staff stays on the first system. */
export const FirstSystemShown: Story = {
  args: { mnxJson: JSON.stringify(autoHideScore({ policy: { autoHideEmptyStaves: { firstSystem: "show" } } })) },
};

/** The oboe is kept on the empty last system, as after clicking its ghost rail. */
export const KeptVisibleOnSystem: Story = {
  args: {
    mnxJson: JSON.stringify(
      autoHideScore({ policy: { autoHideEmptyStaves: { keepVisible: [{ measure: "m8", parts: ["oboe"] }] } } }),
    ),
  },
};

/**
 * Score/part applicability, full-score view. The document also has a
 * Woodwinds part view with its own policy (see `PartViewSetting`); that
 * setting does not affect this view, which hides oboe and piano on the first
 * system as in `SelectedInstruments`.
 */
export const ScoreViewSetting: Story = {
  args: { mnxJson: JSON.stringify(autoHideScore(woodwindsPartView)), selectedScoreIndex: 0 },
};

/**
 * Score/part applicability, part view. The same document rendered through
 * its Woodwinds part view, whose own policy auto-hides only the oboe and
 * shows every staff on the first system. The oboe therefore stays on the
 * first system and hides only on the last one, independent of the full
 * score's setting.
 */
export const PartViewSetting: Story = {
  args: { mnxJson: JSON.stringify(autoHideScore(woodwindsPartView)), selectedScoreIndex: 1 },
};

/**
 * A manual hide wins over the policy. The piano was hidden by hand on the
 * middle system (a per-system layout without it), so it stays hidden there
 * even though its left hand has music. The other systems still follow the
 * automatic policy.
 */
export const ManuallyHiddenOnSystem: Story = {
  args: {
    mnxJson: JSON.stringify(
      autoHideScore({
        policy: { layoutBreaks: undefined },
        fullScore: {
          pages: [
            {
              systems: [
                { measure: "m0", layout: "L" },
                { measure: "m4", layout: "L-no-piano" },
                { measure: "m8", layout: "L" },
              ],
            },
          ],
        },
        extraLayouts: [{ id: "L-no-piano", content: [fluteStaff, oboeStaff], _x: { viritura: { derived: true } } }],
      }),
    ),
  },
};
