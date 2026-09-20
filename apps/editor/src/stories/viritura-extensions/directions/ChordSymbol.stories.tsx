import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChordQuality, ChordRoot, ChordSymbol, Part } from "@viritura/core";
import { parseChordSymbolText } from "@viritura/core";
import { assertRawScore, type RawScore } from "@viritura/format";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Chord Symbols",
  component: ScorePreview,
  argTypes: {
    rootStep: {
      control: "select",
      options: ["C", "D", "E", "F", "G", "A", "B"],
      description: "Root note step",
    },
    rootAlter: {
      control: { type: "range", min: -1, max: 1, step: 1 },
      description: "Root alteration (-1=flat, 0=natural, 1=sharp)",
    },
    quality: {
      control: "select",
      options: [
        "major",
        "minor",
        "dominant",
        "diminished",
        "augmented",
        "half-diminished",
        "minor-major",
        "power",
        "suspended2",
        "suspended4",
      ],
      description: "Chord quality",
    },
    extension: {
      control: "select",
      options: [undefined, 6, 7, 9, 11, 13],
      description: "Chord extension (7th, 9th, etc.)",
    },
  },
  args: {
    rootStep: "C",
    rootAlter: 0,
    quality: "major",
    extension: undefined,
  },
};

export default meta;

interface ChordArgs {
  rootStep: string;
  rootAlter: number;
  quality: ChordQuality;
  extension?: ChordSymbol["extension"];
}

export const Default: StoryObj<ChordArgs> = {
  args: { rootStep: "C", rootAlter: 0, quality: "major" },
  render: (args) => {
    const root: ChordRoot = { step: args.rootStep };
    if (args.rootAlter !== 0) root.alter = args.rootAlter;

    const mnx = buildSingleMeasure([{ duration: "whole", notes: [{ step: "C", octave: 4 }] }], {
      virituraGlobal: {
        chordSymbols: [
          {
            position: { fraction: [0, 1] },
            root,
            quality: args.quality,
            ...(args.extension ? { extension: args.extension } : {}),
          },
        ],
      },
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Single chord symbol",
};

export const CommonProgression: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure(
      [
        { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "D", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
        { duration: "quarter", notes: [{ step: "C", octave: 4 }] },
      ],
      {
        virituraGlobal: {
          chordSymbols: [
            { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
            { position: { fraction: [1, 4] }, root: { step: "D" }, quality: "minor" },
            { position: { fraction: [2, 4] }, root: { step: "G" }, quality: "dominant", extension: 7 },
            { position: { fraction: [3, 4] }, root: { step: "C" }, quality: "major", extension: 7 },
          ],
        },
      },
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "I–ii–V7–Imaj7 progression",
};

export const AllQualities: StoryObj = {
  render: () => {
    const qualities: ChordQuality[] = [
      "major",
      "minor",
      "dominant",
      "diminished",
      "augmented",
      "half-diminished",
      "minor-major",
      "power",
      "suspended2",
      "suspended4",
    ];
    const mnx = buildMnx({
      measures: qualities.map((quality, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
        voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        virituraGlobal: {
          chordSymbols: [
            {
              position: { fraction: [0, 1] },
              root: { step: "C" },
              quality,
            },
          ],
        },
      })),
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All ten chord qualities",
};

export const AddedAndOmittedDegrees: StoryObj = {
  name: "Added and omitted degrees — central text grammar",
  parameters: {
    docs: {
      description: {
        story:
          "All symbols use the central chord-entry parser. Cadd6 displays as C6; Csus47 as C7sus4. " +
          "Cadd9 and Cadd13 add only the named degree, without an implied seventh. " +
          "The three add7/add9/omit5 slash spellings describe the same harmony and normalize to " +
          "Cadd7add9omit5/E. Parentheses and commas preserve authored provenance, not a display override.",
      },
    },
  },
  render: () => {
    const symbols = [
      "Cadd6",
      "Csus47",
      "Cadd9",
      "Cadd13",
      "Cmaj7add9",
      "Cadd79omit5/E",
      "C(add7,9,no5)/E",
      "Cadd(7,9)omit5/E",
      "C7(add9,omit5)",
      "Cadd791113",
    ];
    const mnx = buildMnx({
      measures: symbols.map((text, index) => ({
        ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
        voices: [[{ duration: "whole", notes: [{ step: "C", octave: 4 }] }]],
        virituraGlobal: { chordSymbols: [parseChordSymbolText(text, { fraction: [0, 1] })] },
      })),
    });
    assertRawScore(JSON.parse(mnx));
    return <ScorePreview mnxJson={mnx} />;
  },
};

const GLOBAL_PROGRESSION: ChordSymbol[] = [
  { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major", bass: { step: "E" } },
  { position: { fraction: [0, 1] }, root: { step: "D" }, quality: "minor", extension: 7, bass: { step: "F" } },
  { position: { fraction: [0, 1] }, root: { step: "G" }, quality: "dominant", extension: 7, bass: { step: "B" } },
  { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major", extension: 7, bass: { step: "E" } },
];

interface HarmonySource extends Pick<Part, "name" | "chordSymbolVisibility" | "transposition"> {
  id: string;
}

function buildGlobalProgression(sources: HarmonySource[], useWritten = false): string {
  const base: RawScore = JSON.parse(
    buildMnx({
      measures: GLOBAL_PROGRESSION.map((chord, index) => ({
        ...(index === 0 ? { time: { count: 4, unit: 4 }, key: { fifths: 0 } } : {}),
        voices: [[{ duration: "whole", notes: [{ step: chord.root?.step ?? "C", octave: 4 }] }]],
        virituraGlobal: { chordSymbols: [chord] },
      })),
    }),
  );
  const measures = base.parts[0]!.measures;
  const mnx = {
    ...base,
    parts: sources.map(({ id, name, chordSymbolVisibility, transposition }) => ({
      id,
      name,
      measures: structuredClone(measures),
      ...(transposition ? { transposition } : {}),
      ...(chordSymbolVisibility ? { _x: { viritura: { chordSymbolVisibility } } } : {}),
    })),
    layouts: [
      {
        id: "harmony",
        content: sources.map(({ id }) => ({ type: "staff", sources: [{ part: id }] })),
      },
    ],
    scores: [{ name: useWritten ? "Written harmony" : "Concert harmony", layout: "harmony", useWritten }],
  };
  assertRawScore(mnx);
  return JSON.stringify(mnx, null, 2);
}

function buildVisibilityProgression(visibility: NonNullable<Part["chordSymbolVisibility"]>): string {
  return buildGlobalProgression([
    { id: "upper", name: `Upper — ${visibility}`, chordSymbolVisibility: visibility },
    { id: "lower", name: `Lower — ${visibility}`, chordSymbolVisibility: visibility },
  ]);
}

export const GlobalProgression: StoryObj = {
  name: "Global progression shared by two source parts",
  parameters: {
    docs: {
      description: {
        story:
          "Four global measures hold C/E–Dm7/F–G7/B–Cmaj7/E once, in concert pitch. " +
          "Neither source part stores harmony. With visibility omitted, automatic placement selects the top eligible staff.",
      },
    },
  },
  render: () => (
    <ScorePreview
      mnxJson={buildGlobalProgression([
        { id: "upper", name: "Upper" },
        { id: "lower", name: "Lower" },
      ])}
    />
  ),
};

export const SourcePartVisibilityAuto: StoryObj = {
  name: "Source Part visibility — auto",
  parameters: {
    docs: {
      description: {
        story:
          "Both source Parts explicitly use _x.viritura.chordSymbolVisibility = auto. " +
          "Expect one global harmony lane above the top eligible staff, not a duplicate above every staff.",
      },
    },
  },
  render: () => <ScorePreview mnxJson={buildVisibilityProgression("auto")} />,
};

export const SourcePartVisibilityShow: StoryObj = {
  name: "Source Part visibility — show",
  parameters: {
    docs: {
      description: {
        story:
          "Both source Parts use _x.viritura.chordSymbolVisibility = show. " +
          "Expect the same global progression above both staves; the source harmony is still stored only once.",
      },
    },
  },
  render: () => <ScorePreview mnxJson={buildVisibilityProgression("show")} />,
};

export const SourcePartVisibilityHide: StoryObj = {
  name: "Source Part visibility — hide",
  parameters: {
    docs: {
      description: {
        story:
          "Both source Parts use _x.viritura.chordSymbolVisibility = hide. " +
          "Expect no chord labels on either staff. The global concert harmony remains in the MNX source.",
      },
    },
  },
  render: () => <ScorePreview mnxJson={buildVisibilityProgression("hide")} />,
};

const BB_SOURCE: HarmonySource = {
  id: "bb-clarinet",
  name: "B♭ Clarinet",
  chordSymbolVisibility: "show",
  transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
};

export const BbConcertHarmony: StoryObj = {
  name: "B♭ source — canonical concert root and bass",
  parameters: {
    docs: {
      description: {
        story:
          "Concert view (scores[0].useWritten = false): C/E–Dm7/F–G7/B–Cmaj7/E. " +
          "This is the identical source harmony used by the written-pitch story.",
      },
    },
  },
  render: () => <ScorePreview mnxJson={buildGlobalProgression([BB_SOURCE])} />,
};

export const BbWrittenHarmony: StoryObj = {
  name: "B♭ written view — transpose both root and slash bass",
  parameters: {
    docs: {
      description: {
        story:
          "Written view (scores[0].useWritten = true), with sounding→written interval " +
          "{ halfSteps: 2, staffDistance: 1 }: expect D/F♯–Em7/G–A7/C♯–Dmaj7/F♯. " +
          "Both root and slash bass transpose for display only. GlobalMeasure chordSymbols remain " +
          "C/E–Dm7/F–G7/B–Cmaj7/E in global.measures[*]._x.viritura.chordSymbols; " +
          "the canonical concert harmony and source note pitches are unchanged.",
      },
    },
  },
  render: () => <ScorePreview mnxJson={buildGlobalProgression([BB_SOURCE], true)} />,
};
