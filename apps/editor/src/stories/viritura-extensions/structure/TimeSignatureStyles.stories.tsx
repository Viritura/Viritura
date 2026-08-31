import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TimeSignatureSettings } from "@viritura/core";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Time Signature Styles",
  component: ScorePreview,
};

export default meta;

/**
 * Three measures whose meter changes twice, so each style is seen doing the
 * job it exists for: marking a change of meter mid-piece.
 */
function configuredScore(settings: TimeSignatureSettings, unit = 4): string {
  const base = unit === 8 ? ("eighth" as const) : ("quarter" as const);
  const beats = (count: number, from: number) =>
    Array.from({ length: count }, (_, j) => ({
      duration: base,
      notes: [{ step: ["C", "D", "E", "F", "G", "A", "B"][(from + j) % 7], octave: 5 }],
    }));

  return buildMnx({
    virituraRoot: { timeSignatures: { score: settings } },
    measures: [
      { time: { count: 4, unit }, voices: [beats(4, 0)] },
      { voices: [beats(4, 2)] },
      { time: { count: 3, unit }, voices: [beats(3, 4)] },
    ],
  });
}

function groupedScore(settings: TimeSignatureSettings): string {
  const part = (id: string, step: string) => ({
    id,
    measures: [
      {
        clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
        sequences: [
          {
            content: [{ duration: { base: "whole" }, notes: [{ pitch: { step, octave: 5 } }] }],
          },
        ],
      },
    ],
  });
  return JSON.stringify({
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [part("flute", "C"), part("oboe", "E")],
    layouts: [
      {
        id: "winds",
        content: [
          {
            type: "group",
            symbol: "bracket",
            content: [
              { type: "staff", sources: [{ part: "flute" }] },
              { type: "staff", sources: [{ part: "oboe" }] },
            ],
          },
        ],
      },
    ],
    scores: [{ name: "Woodwinds", layout: "winds" }],
    _x: { viritura: { timeSignatures: { score: settings } } },
  });
}

/** The everyday meter: digits inside the staff at staff size. */
export const Standard: StoryObj = {
  render: () => <ScorePreview mnxJson={configuredScore({})} />,
  name: "Standard (in staff)",
};

/**
 * The film/media-score convention: the digits are enlarged until the stacked
 * pair overflows the staff at both ends, which is what keeps a meter change
 * findable on a dense page. The measure reserves the extra width it needs.
 */
export const Large: StoryObj = {
  render: () => <ScorePreview mnxJson={configuredScore({ scale: 1.5 })} />,
  name: "Large (film score)",
};

/** Condensed digits, for pages where horizontal room is scarce. */
export const Narrow: StoryObj = {
  render: () => <ScorePreview mnxJson={configuredScore({ renderStyle: "narrow" })} />,
  name: "Condensed",
};

/**
 * The meter is engraved over the top staff line and nothing is set inside the
 * staff, so the bar reserves no horizontal slot for it.
 */
export const AboveStaff: StoryObj = {
  render: () => <ScorePreview mnxJson={configuredScore({ position: "above" })} />,
  name: "Above the staff",
};

/** One scaled standard meter, centered independently on a two-staff bracket group. */
export const Spanning: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={groupedScore({
        renderStyle: "outsideStaff",
        distribution: "perGroup",
        position: "center",
        scale: 1.5,
      })}
    />
  ),
  name: "Outside-staff digits per group",
};

/** Above placement remains available when distribution is one per group. */
export const AboveGroup: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={groupedScore({
        renderStyle: "narrow",
        distribution: "perGroup",
        position: "above",
        scale: 1.2,
      })}
    />
  ),
  name: "Condensed above each group",
};

/** The beat count alone — 4 and 3 rather than 4/4 and 3/4. */
export const SingleNumber: StoryObj = {
  render: () => <ScorePreview mnxJson={configuredScore({ renderStyle: "singleNumber" })} />,
  name: "Beat count only",
};

/** The denominator drawn as the note it stands for: 6 over an eighth note. */
export const NoteValue: StoryObj = {
  render: () => <ScorePreview mnxJson={configuredScore({ renderStyle: "noteValue" }, 8)} />,
  name: "Note-value denominator",
};
