export interface PlaygroundDocument {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly examplePath?: string;
}

interface NoteSpec {
  readonly step: string;
  readonly octave: number;
  readonly alter?: number;
}

function note(duration: string, pitch: NoteSpec, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { duration: { base: duration }, notes: [{ pitch }], ...extra };
}

function documentSource(parts: readonly Record<string, unknown>[], measures = 1): string {
  return JSON.stringify(
    {
      mnx: { version: 1, support: { useBeams: true } },
      global: {
        measures: Array.from({ length: measures }, (_, index) =>
          index === 0 ? { time: { count: 4, unit: 4 }, barline: { type: "regular" } } : {},
        ),
      },
      parts,
    },
    null,
    2,
  );
}

const trebleClef = [{ clef: { sign: "G", staffPosition: -2 } }];

const samplerPitches: readonly NoteSpec[] = [
  { step: "C", octave: 5 },
  { step: "D", octave: 5 },
  { step: "E", octave: 5 },
  { step: "F", octave: 5, alter: 1 },
  { step: "G", octave: 5 },
  { step: "E", octave: 5 },
  { step: "D", octave: 5 },
  { step: "C", octave: 5 },
];

const samplerEvents = samplerPitches.map((pitch, index) => note("eighth", pitch, { id: `sampler-${index + 1}` }));

const sampler = documentSource(
  [
    {
      id: "sampler-part",
      measures: [
        {
          clefs: trebleClef,
          beams: [
            { events: ["sampler-1", "sampler-2", "sampler-3", "sampler-4"] },
            { events: ["sampler-5", "sampler-6", "sampler-7", "sampler-8"] },
          ],
          dynamics: [{ id: "sampler-dynamic-p", position: { fraction: [0, 1] }, type: "immediate", value: "p" }],
          sequences: [{ content: samplerEvents }],
        },
        {
          dynamics: [{ id: "sampler-dynamic-f", position: { fraction: [0, 1] }, type: "immediate", value: "f" }],
          sequences: [
            {
              content: [
                note("quarter", { step: "C", octave: 5 }),
                note("quarter", { step: "E", octave: 5 }),
                note("quarter", { step: "G", octave: 5 }),
                note("quarter", { step: "C", octave: 6 }),
              ],
            },
          ],
        },
      ],
    },
  ],
  2,
);

const minimal = documentSource([
  {
    id: "p1",
    measures: [{ clefs: trebleClef, sequences: [{ content: [note("whole", { step: "C", octave: 4 })] }] }],
  },
]);

const accidentals = documentSource([
  {
    id: "p1",
    measures: [
      {
        clefs: trebleClef,
        sequences: [
          {
            content: [
              note("quarter", { step: "C", octave: 4 }),
              note("quarter", { step: "F", octave: 4, alter: 1 }),
              note("quarter", { step: "B", octave: 4, alter: -1 }),
              note("quarter", { step: "C", octave: 5 }),
            ],
          },
        ],
      },
    ],
  },
]);

const tuplets = documentSource([
  {
    id: "p1",
    measures: [
      {
        beams: [{ events: ["tuplet-1", "tuplet-2", "tuplet-3"] }],
        clefs: trebleClef,
        sequences: [
          {
            content: [
              {
                type: "tuplet",
                inner: { multiple: 3, duration: { base: "eighth" } },
                outer: { multiple: 2, duration: { base: "eighth" } },
                content: [
                  note("eighth", { step: "C", octave: 5 }, { id: "tuplet-1" }),
                  note("eighth", { step: "D", octave: 5 }, { id: "tuplet-2" }),
                  note("eighth", { step: "E", octave: 5 }, { id: "tuplet-3" }),
                ],
              },
              note("half", { step: "G", octave: 4 }),
              note("quarter", { step: "C", octave: 5 }),
            ],
          },
        ],
      },
    ],
  },
]);

const piano = documentSource([
  {
    id: "piano",
    staves: 2,
    measures: [
      {
        clefs: [
          { clef: { sign: "G", staffPosition: -2 }, staff: 1 },
          { clef: { sign: "F", staffPosition: 2 }, staff: 2 },
        ],
        sequences: [
          { staff: 1, content: [note("whole", { step: "E", octave: 5 })] },
          { staff: 2, content: [note("whole", { step: "C", octave: 3 })] },
        ],
      },
    ],
  },
]);

const caesura = documentSource([
  {
    id: "p1",
    measures: [
      {
        clefs: trebleClef,
        sequences: [
          {
            content: [
              note("half", { step: "C", octave: 5 }),
              note("half", { step: "G", octave: 4 }, { markings: { _x: { viritura: { caesura: {} } } } }),
            ],
          },
        ],
      },
    ],
  },
]);

export const playgroundDocuments: readonly PlaygroundDocument[] = [
  {
    id: "sampler",
    title: "Engraving sampler",
    description: "Two measures with beams, accidentals, dynamics, and melodic spacing.",
    source: sampler,
  },
  {
    id: "minimal",
    title: "Minimal score",
    description: "A single whole note on one treble staff.",
    source: minimal,
    examplePath: "/mnx/examples/?path=/story/mnx-spec-basic-hello-world--default",
  },
  {
    id: "accidentals",
    title: "Pitch and accidentals",
    description: "Chromatic pitches and altered notes.",
    source: accidentals,
  },
  {
    id: "tuplets",
    title: "Beams and tuplets",
    description: "A compact triplet followed by simple rhythm.",
    source: tuplets,
  },
  { id: "piano", title: "Piano staves", description: "Treble and bass staves in one part.", source: piano },
  {
    id: "caesura",
    title: "Viritura caesura extension",
    description: "A documented _x.viritura event marking.",
    source: caesura,
    examplePath: "/mnx/examples/?path=/story/viritura-extensions-breaks-pauses-caesuras--default-caesura",
  },
];

export function findPlaygroundDocument(id: string): PlaygroundDocument {
  return playgroundDocuments.find((document) => document.id === id) ?? playgroundDocuments[0]!;
}
