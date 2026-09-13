import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Grouping Display",
  component: ScorePreview,
};

export default meta;

/**
 * A single measure of the given meter, optionally with an authored
 * beatStructure and a per-occurrence groupingDisplay override, under a
 * document house style. Demonstrates the full cascade: staff occurrence >
 * time occurrence > score house style (non-default only) > standard.
 */
function groupingScoreJson(options: {
  count: number;
  unit: number;
  beatStructure?: number[];
  occurrenceGroupingDisplay?: "standard" | "additive" | "annotation";
  houseStyle?: "standard" | "additive" | "annotation";
  staffOverrides?: { staff: number; groupingDisplay: "standard" | "additive" | "annotation" }[];
  staves?: number;
}): string {
  const timeExt: Record<string, unknown> = {};
  if (options.beatStructure) timeExt["beatStructure"] = options.beatStructure;
  if (options.occurrenceGroupingDisplay) timeExt["groupingDisplay"] = options.occurrenceGroupingDisplay;

  const partMeasureExt: Record<string, unknown> = {};
  if (options.staffOverrides && options.staffOverrides.length > 0) {
    partMeasureExt["groupingDisplayOverrides"] = options.staffOverrides;
  }

  const staves = options.staves ?? 1;
  const clefs =
    staves === 2
      ? [
          { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
          { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
        ]
      : [{ clef: { sign: "G", staffPosition: -2 } }];
  const sequences =
    staves === 2
      ? [
          { staff: 1, content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] },
          { staff: 2, content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 3 } }] }] },
        ]
      : [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] }];

  return JSON.stringify({
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: {
            count: options.count,
            unit: options.unit,
            ...(Object.keys(timeExt).length > 0 ? { _x: { viritura: timeExt } } : {}),
          },
        },
      ],
    },
    parts: [
      {
        name: "Piano",
        staves,
        measures: [
          {
            clefs,
            sequences,
            ...(Object.keys(partMeasureExt).length > 0 ? { _x: { viritura: partMeasureExt } } : {}),
          },
        ],
      },
    ],
    ...(options.houseStyle
      ? { _x: { viritura: { timeSignatures: { score: { nonDefaultGroupingDisplay: options.houseStyle } } } } }
      : {}),
  });
}

/** An ordinary 7/8 with no authored grouping: standard digits, nothing decorated. */
export const Standard: StoryObj = {
  render: () => <ScorePreview mnxJson={groupingScoreJson({ count: 7, unit: 8 })} />,
  name: "Standard (no grouping decoration)",
};

/**
 * A structurally non-default 7/8 (grouped 3+2+2 instead of the automatic
 * 2+2+3) under an "additive" house style: the numerator is written as its
 * beat groups joined by "+".
 */
export const HouseStyleAdditive: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={groupingScoreJson({
        count: 7,
        unit: 8,
        beatStructure: [3, 2, 2],
        houseStyle: "additive",
      })}
    />
  ),
  name: "House style: additive numerator",
};

/**
 * The same non-default 7/8 under an "annotation" house style: the ordinary
 * "7/8" numeral is unchanged, with a generated "3+2+2" grouping annotation
 * engraved above it.
 */
export const HouseStyleAnnotation: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={groupingScoreJson({
        count: 7,
        unit: 8,
        beatStructure: [3, 2, 2],
        houseStyle: "annotation",
      })}
    />
  ),
  name: "House style: grouping annotation",
};

/**
 * Default-group suppression: an ordinary 4/4 with no authored beatStructure
 * never engraves additive/annotation glyphs, even under an "additive" house
 * style — a plain meter never turns into "1+1+1+1".
 */
export const DefaultMeterStaysStandard: StoryObj = {
  render: () => <ScorePreview mnxJson={groupingScoreJson({ count: 4, unit: 4, houseStyle: "additive" })} />,
  name: "Default meter suppresses the house style",
};

/**
 * An explicit per-occurrence override (`time._x.viritura.groupingDisplay`)
 * forces the grouping annotation even with no house style set at all.
 */
export const OccurrenceOverride: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={groupingScoreJson({
        count: 7,
        unit: 8,
        beatStructure: [3, 2, 2],
        occurrenceGroupingDisplay: "annotation",
      })}
    />
  ),
  name: "Per-occurrence override (no house style)",
};

/**
 * A two-staff part where staff 1's per-staff override forces standard
 * while staff 2 reads the time signature's own "additive" occurrence
 * override — the document's house style never gets a chance to apply,
 * demonstrating the full staff > time occurrence > house style precedence.
 */
export const PerStaffOverridePrecedence: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={groupingScoreJson({
        count: 7,
        unit: 8,
        beatStructure: [3, 2, 2],
        occurrenceGroupingDisplay: "additive",
        houseStyle: "annotation",
        staves: 2,
        staffOverrides: [{ staff: 1, groupingDisplay: "standard" }],
      })}
    />
  ),
  name: "Per-staff override wins the cascade",
};
