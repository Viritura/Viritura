import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Fretboard, FretboardNote, Part } from "@viritura/core";
import { parseChordSymbolText } from "@viritura/core";
import { assertRawScore, type RawScore } from "@viritura/format";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, type EventArgs } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Expressions & Labels/Chord Diagrams",
  component: ScorePreview,
};

export default meta;

/** Diagrams are compact by design; enlarge the preview so their details are reviewable. */
const DIAGRAM_ZOOM = 3;

type Shape = Omit<Fretboard, "partId">;

interface DiagramChord {
  text: string;
  /** Measure-relative position as a fraction of a whole note. */
  at?: [number, number];
  /** Diagrams keyed by source part ID. */
  frames: Record<string, Shape>;
}

interface DiagramSource extends Pick<Part, "name" | "transposition"> {
  id: string;
  instrumentId?: string;
  visibility?: Part["chordSymbolVisibility"];
}

interface DiagramMeasure {
  chords: DiagramChord[];
  voice?: EventArgs[];
}

const WHOLE_REST: EventArgs[] = [{ duration: "whole", rest: true }];

function six(notes: FretboardNote[], first = 1, frets = 4): Shape {
  return {
    frameStrings: 6,
    frameFrets: frets,
    ...(first > 1 ? { firstFret: { fret: first, text: `${first}fr` } } : {}),
    frameNotes: notes,
  };
}

/** Builds a fretted string list from a low-to-high tab such as "x32010". */
function tab(shape: string, fingers = "", first = 1, frets = 4): Shape {
  const cells = [...shape];
  const notes: FretboardNote[] = [];
  cells.forEach((cell, index) => {
    if (cell === "x") return;
    const fingering = fingers[index];
    notes.push({
      string: cells.length - index,
      fret: Number.parseInt(cell, 36),
      ...(fingering && fingering !== "-" ? { fingering } : {}),
    });
  });
  return {
    frameStrings: cells.length,
    frameFrets: frets,
    ...(first > 1 ? { firstFret: { fret: first, text: `${first}fr` } } : {}),
    frameNotes: notes,
  };
}

function buildDiagramScore(sources: DiagramSource[], measures: DiagramMeasure[], useWritten = false): string {
  const base: RawScore = JSON.parse(
    buildMnx({
      partId: sources[0]!.id,
      measures: measures.map((measure, index) => ({
        ...(index === 0 ? { time: { count: 4, unit: 4 }, key: { fifths: 0 } } : {}),
        voices: [measure.voice ?? WHOLE_REST],
        virituraGlobal: {
          chordSymbols: measure.chords.map((chord) => ({
            ...parseChordSymbolText(chord.text, { fraction: chord.at ?? [0, 1] }),
            fretboards: Object.entries(chord.frames).map(([partId, frame]) => ({ partId, ...frame })),
          })),
        },
      })),
    }),
  );
  const partMeasures = base.parts[0]!.measures;
  const mnx = {
    ...base,
    parts: sources.map(({ id, name, instrumentId, visibility, transposition }) => ({
      id,
      ...(name ? { name } : {}),
      measures: structuredClone(partMeasures),
      ...(transposition ? { transposition } : {}),
      _x: {
        viritura: {
          ...(instrumentId ? { instrumentId } : {}),
          chordSymbolVisibility: visibility ?? "show",
        },
      },
    })),
    ...(sources.length > 1 || useWritten
      ? {
          layouts: [{ id: "diagrams", content: sources.map(({ id }) => ({ type: "staff", sources: [{ part: id }] })) }],
          scores: [{ name: useWritten ? "Written" : "Concert", layout: "diagrams", useWritten }],
        }
      : {}),
  };
  assertRawScore(mnx);
  return JSON.stringify(mnx, null, 2);
}

const GUITAR: DiagramSource = { id: "gtr", name: "Guitar", instrumentId: "pluck.guitar" };

function guitarRow(chords: Array<[string, Shape]>): string {
  return buildDiagramScore(
    [GUITAR],
    chords.map(([text, frame]) => ({ chords: [{ text, frames: { gtr: frame } }] })),
  );
}

export const OpenPositionGuitar: StoryObj = {
  name: "Open-position guitar chords",
  parameters: {
    docs: {
      description: {
        story:
          "Eight common open shapes on a six-string frame. Expect a thick nut, open circles above " +
          "open strings, x above muted strings, and left-hand fingerings below the grid.",
      },
    },
  },
  render: () => (
    <ScorePreview
      maxZoom={DIAGRAM_ZOOM}
      mnxJson={guitarRow([
        ["C", tab("x32010", "-32-1-")],
        ["A", tab("x02220", "--123-")],
        ["G", tab("320003", "21---3")],
        ["E", tab("022100", "-231--")],
        ["D", tab("xx0232", "---132")],
        ["Am", tab("x02210", "--231-")],
        ["Em", tab("022000", "-23---")],
        ["Dm", tab("xx0231", "---231")],
      ])}
    />
  ),
};

export const BarreShapes: StoryObj = {
  name: "Barre chords and position labels",
  parameters: {
    docs: {
      description: {
        story:
          "F is a full first-fret barre with the nut drawn. Bm is a partial barre from string 5. " +
          "A (5fr) and Cm (8fr) are shifted shapes: the nut is replaced by a position label beside " +
          "the first displayed fret. The last diagram places a roman-numeral label on the right.",
      },
    },
  },
  render: () => (
    <ScorePreview
      maxZoom={DIAGRAM_ZOOM}
      mnxJson={guitarRow([
        [
          "F",
          six([
            { string: 6, fret: 1, fingering: "1", barre: "start" },
            { string: 5, fret: 3, fingering: "3" },
            { string: 4, fret: 3, fingering: "4" },
            { string: 3, fret: 2, fingering: "2" },
            { string: 2, fret: 1 },
            { string: 1, fret: 1, barre: "stop" },
          ]),
        ],
        [
          "Bm",
          six([
            { string: 5, fret: 2, fingering: "1", barre: "start" },
            { string: 4, fret: 4, fingering: "3" },
            { string: 3, fret: 4, fingering: "4" },
            { string: 2, fret: 3, fingering: "2" },
            { string: 1, fret: 2, barre: "stop" },
          ]),
        ],
        [
          "A",
          six(
            [
              { string: 6, fret: 5, fingering: "1", barre: "start" },
              { string: 5, fret: 7, fingering: "3" },
              { string: 4, fret: 7, fingering: "4" },
              { string: 3, fret: 6, fingering: "2" },
              { string: 2, fret: 5 },
              { string: 1, fret: 5, barre: "stop" },
            ],
            5,
          ),
        ],
        [
          "Cm",
          six(
            [
              { string: 5, fret: 8, fingering: "1", barre: "start" },
              { string: 4, fret: 10, fingering: "3" },
              { string: 3, fret: 10, fingering: "4" },
              { string: 2, fret: 9, fingering: "2" },
              { string: 1, fret: 8, barre: "stop" },
            ],
            8,
          ),
        ],
        [
          "D",
          {
            frameStrings: 6,
            frameFrets: 4,
            firstFret: { fret: 10, text: "X", location: "right" },
            frameNotes: [
              { string: 5, fret: 10, fingering: "1", barre: "start" },
              { string: 4, fret: 12, fingering: "3" },
              { string: 3, fret: 12, fingering: "4" },
              { string: 2, fret: 12, fingering: "4" },
              { string: 1, fret: 10, barre: "stop" },
            ],
          },
        ],
      ])}
    />
  ),
};

export const MarkersAndFrameSizes: StoryObj = {
  name: "Markers, fingerings and frame sizes",
  parameters: {
    docs: {
      description: {
        story:
          "Shows the authored markers that vary between publishers: thumb fingering (T), " +
          "no muted-string marker (unplayed = empty), a five-fret stretch voicing, a compact " +
          "three-fret frame, and a diagram with no fingerings at all.",
      },
    },
  },
  render: () => (
    <ScorePreview
      maxZoom={DIAGRAM_ZOOM}
      mnxJson={guitarRow([
        ["F/A", tab("x03211", "--3211")],
        ["D/F#", tab("2x0232", "T--132")],
        ["Cadd9", { ...tab("x32033", "-21-34"), unplayed: "" }],
        ["Gmaj7", tab("3x4432", "1-3421", 1, 5)],
        ["E5", tab("079xxx", "-13---", 7, 3)],
        ["C7", tab("x32310")],
      ])}
    />
  ),
};

export const OtherStringCounts: StoryObj = {
  name: "Ukulele, bass, banjo and 7-string",
  parameters: {
    docs: {
      description: {
        story:
          "The frame string count is authored, so the same rendering handles four-string ukulele " +
          "and bass, five-string banjo, and seven-string guitar. String 1 is always the rightmost line.",
      },
    },
  },
  render: () => (
    <ScorePreview
      maxZoom={DIAGRAM_ZOOM}
      mnxJson={guitarRow([
        ["C", tab("0003", "---3")],
        ["Am", tab("2000", "2---")],
        ["G", tab("355x", "134-", 3)],
        ["G", tab("00000")],
        ["D", tab("x0234", "--123")],
        ["Em", tab("x022000", "--23---")],
      ])}
    />
  ),
};

export const DenseProgression: StoryObj = {
  name: "Dense progression: four diagrams per measure",
  parameters: {
    docs: {
      description: {
        story:
          "Four quarter-note changes per bar stress horizontal spacing. Diagrams must not overlap " +
          "each other or their labels, and the measure should widen to fit them.",
      },
    },
  },
  render: () => {
    const quarters: EventArgs[] = ["E", "G", "C", "D"].map((step) => ({
      duration: "quarter",
      notes: [{ step, octave: 4 }],
    }));
    const bar = (chords: Array<[string, Shape]>): DiagramMeasure => ({
      voice: quarters,
      chords: chords.map(([text, frame], beat) => ({ text, at: [beat, 4], frames: { gtr: frame } })),
    });
    return (
      <ScorePreview
        maxZoom={DIAGRAM_ZOOM}
        mnxJson={buildDiagramScore(
          [GUITAR],
          [
            bar([
              ["C", tab("x32010", "-32-1-")],
              ["Am", tab("x02210", "--231-")],
              ["F", tab("xx3211", "--3211")],
              ["G", tab("320003", "21---3")],
            ]),
            bar([
              ["Em", tab("022000", "-23---")],
              ["Am", tab("x02210", "--231-")],
              ["Dm", tab("xx0231", "---231")],
              ["G7", tab("320001", "32---1")],
            ]),
          ],
        )}
      />
    );
  },
};

export const DiagramsAboveHighNotes: StoryObj = {
  name: "Diagrams above notes with ledger lines",
  parameters: {
    docs: {
      description: {
        story:
          "High notes and ledger lines push the chord label upward; each diagram should stay above its " +
          "label and clear the notes, with consistent vertical alignment across the system.",
      },
    },
  },
  render: () => {
    const melody = (steps: Array<[string, number]>): EventArgs[] =>
      steps.map(([step, octave]) => ({ duration: "half", notes: [{ step, octave }] }));
    return (
      <ScorePreview
        maxZoom={DIAGRAM_ZOOM}
        mnxJson={buildDiagramScore(
          [GUITAR],
          [
            {
              voice: melody([
                ["C", 6],
                ["E", 6],
              ]),
              chords: [
                { text: "C", frames: { gtr: tab("x32010", "-32-1-") } },
                { text: "Am", at: [1, 2], frames: { gtr: tab("x02210", "--231-") } },
              ],
            },
            {
              voice: melody([
                ["A", 5],
                ["G", 4],
              ]),
              chords: [
                { text: "Dm7", frames: { gtr: tab("xx0211", "---211") } },
                { text: "G7", at: [1, 2], frames: { gtr: tab("320001", "32---1") } },
              ],
            },
          ],
        )}
      />
    );
  },
};

export const PerInstrumentDiagrams: StoryObj = {
  name: "One chord, a diagram per instrument",
  parameters: {
    docs: {
      description: {
        story:
          "The shared global progression stores harmony once. Guitar, ukulele, and bass each own a " +
          "different voicing on the same chord occurrence. Piano has no diagram, so it shows the label only.",
      },
    },
  },
  render: () => (
    <ScorePreview
      maxZoom={DIAGRAM_ZOOM}
      mnxJson={buildDiagramScore(
        [
          GUITAR,
          { id: "uke", name: "Ukulele", instrumentId: "pluck.ukulele" },
          { id: "bass", name: "Bass Guitar", instrumentId: "pluck.bass.electric" },
          { id: "pno", name: "Piano", instrumentId: "keyboard.piano" },
        ],
        [
          {
            chords: [
              {
                text: "C",
                frames: { gtr: tab("x32010", "-32-1-"), uke: tab("0003", "---3"), bass: tab("x3x2", "-2-1") },
              },
            ],
          },
          {
            chords: [
              {
                text: "Am",
                frames: { gtr: tab("x02210", "--231-"), uke: tab("2000", "2---"), bass: tab("x0x2", "---1") },
              },
            ],
          },
          { chords: [{ text: "F", frames: { gtr: tab("xx3211", "--3211"), uke: tab("2010", "2-1-") } }] },
          {
            chords: [
              {
                text: "G",
                frames: { gtr: tab("320003", "21---3"), uke: tab("0232", "-132"), bass: tab("3xxx", "2---") },
              },
            ],
          },
        ],
      )}
    />
  ),
};

const BB_GUITAR: DiagramSource = {
  id: "gtr",
  name: "Guitar (B♭ written view)",
  instrumentId: "pluck.guitar",
  transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
};

const TRANSPOSED: DiagramMeasure[] = [
  { chords: [{ text: "C", frames: { gtr: tab("x32010", "-32-1-") } }] },
  { chords: [{ text: "G7", frames: { gtr: tab("320001", "32---1") } }] },
];

export const ConcertView: StoryObj = {
  name: "Transposition: concert view",
  parameters: {
    docs: {
      description: {
        story: "Concert view of a transposing source. Labels read C and G7 above their authored shapes.",
      },
    },
  },
  render: () => <ScorePreview maxZoom={DIAGRAM_ZOOM} mnxJson={buildDiagramScore([BB_GUITAR], TRANSPOSED)} />,
};

export const WrittenView: StoryObj = {
  name: "Transposition: written view keeps frets",
  parameters: {
    docs: {
      description: {
        story:
          "Written view of the same source. Labels transpose to D and A7, but diagrams describe " +
          "physical hand positions, so the frets are unchanged. Authors re-voice diagrams themselves.",
      },
    },
  },
  render: () => <ScorePreview maxZoom={DIAGRAM_ZOOM} mnxJson={buildDiagramScore([BB_GUITAR], TRANSPOSED, true)} />,
};
