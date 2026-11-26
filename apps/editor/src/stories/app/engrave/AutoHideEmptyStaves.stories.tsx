import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorScorePreview } from "../../storyFixtures/EditorScorePreview";

const rest = { duration: { base: "whole" }, rest: {} };
const note = { duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] };
const MEASURES = 12;

function autoHideScore(policy: Record<string, unknown> = {}) {
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
    layouts: [
      {
        id: "L",
        content: [
          { type: "staff", sources: [{ part: "flute" }] },
          { type: "staff", sources: [{ part: "oboe" }] },
          {
            type: "group",
            symbol: "brace",
            content: [
              { type: "staff", sources: [{ part: "piano", staff: 1 }] },
              { type: "staff", sources: [{ part: "piano", staff: 2 }] },
            ],
          },
        ],
      },
    ],
    scores: [
      {
        name: "Auto-hide example",
        layout: "L",
        _x: {
          viritura: {
            autoHideEmptyParts: ["oboe", "piano"],
            layoutBreaks: [
              { measure: "m4", kind: "system" },
              { measure: "m8", kind: "system" },
            ],
            ...policy,
          },
        },
      },
    ],
  };
}

const meta: Meta<typeof EditorScorePreview> = {
  title: "App/Engrave Mode/Auto-hide Empty Staves",
  component: EditorScorePreview,
  args: { mnxJson: JSON.stringify(autoHideScore()), showEditor: true, viewMode: "page" },
};
export default meta;
type Story = StoryObj<typeof EditorScorePreview>;

/** Oboe and piano hide on rest-only systems; piano returns with music on either staff. */
export const SelectedInstruments: Story = {};

/** A full-score opening: every staff stays on the first system. */
export const FirstSystemShown: Story = {
  args: { mnxJson: JSON.stringify(autoHideScore({ autoHideEmptyStaves: { firstSystem: "show" } })) },
};

/** The oboe is kept on the empty last system, as after clicking its ghost rail. */
export const KeptVisibleOnSystem: Story = {
  args: {
    mnxJson: JSON.stringify(
      autoHideScore({ autoHideEmptyStaves: { keepVisible: [{ measure: "m8", parts: ["oboe"] }] } }),
    ),
  },
};
