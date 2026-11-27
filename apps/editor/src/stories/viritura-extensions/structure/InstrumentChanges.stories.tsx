import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Instrument Changes",
  component: ScorePreview,
};
export default meta;

function doublingScore(useWritten: boolean, hidden = false): string {
  return JSON.stringify({
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}, {}, {}],
    },
    scores: [{ name: useWritten ? "Written pitch" : "Concert pitch", useWritten }],
    parts: [
      {
        id: "P1",
        name: "Oboe",
        shortName: "Ob.",
        _x: {
          viritura: {
            instrumentId: "wind.reed.oboe",
            initialInstrument: "ob",
            instruments: {
              ob: { instrumentId: "wind.reed.oboe", name: "Oboe", shortName: "Ob.", midiProgram: 68 },
              eh: {
                instrumentId: "wind.reed.english-horn",
                name: "English Horn",
                shortName: "E.H.",
                midiProgram: 69,
                transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
              },
            },
          },
        },
        measures: Array.from({ length: 4 }, (_, index) => ({
          ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
          sequences: [
            {
              content: [
                { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                { duration: { base: "half" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
              ],
            },
          ],
          ...(index === 1
            ? { _x: { viritura: { instrumentChanges: [{ instrument: "eh", instruction: { hidden } }] } } }
            : {}),
          ...(index === 3 ? { _x: { viritura: { instrumentChanges: [{ instrument: "ob" }] } } } : {}),
        })),
      },
    ],
  });
}

export const OboeEnglishHornWritten: StoryObj = {
  render: () => <ScorePreview mnxJson={doublingScore(true)} />,
};

export const OboeEnglishHornConcert: StoryObj = {
  render: () => <ScorePreview mnxJson={doublingScore(false)} />,
};

export const HiddenChangeInstruction: StoryObj = {
  render: () => <ScorePreview mnxJson={doublingScore(true, true)} />,
};

function automaticDoublingReminders(): string {
  const score = JSON.parse(doublingScore(true)) as {
    parts: { measures: { sequences: { content: unknown[] }[] }[] }[];
  };
  for (const index of [0, 2]) {
    score.parts[0]!.measures[index]!.sequences[0]!.content = [
      { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
      { duration: { base: "half" }, rest: {} },
    ];
  }
  return JSON.stringify(score);
}

export const AutomaticDoublingLabelsAndReminders: StoryObj = {
  render: () => <ScorePreview mnxJson={automaticDoublingReminders()} />,
};

export const PiccoloFluteDoubling: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
        scores: [{ name: "Piccolo and flute", useWritten: true }],
        parts: [
          {
            name: "Piccolo",
            shortName: "Picc.",
            transposition: { interval: { halfSteps: -12, staffDistance: -7 } },
            _x: {
              viritura: {
                initialInstrument: "picc",
                instruments: {
                  picc: {
                    instrumentId: "wind.flutes.flute.piccolo",
                    name: "Piccolo",
                    shortName: "Picc.",
                    transposition: { interval: { halfSteps: -12, staffDistance: -7 } },
                  },
                  fl: { instrumentId: "wind.flutes.flute", name: "Flute", shortName: "Fl." },
                },
              },
            },
            measures: Array.from({ length: 3 }, (_, index) => ({
              ...(index > 0
                ? { _x: { viritura: { instrumentChanges: [{ instrument: index === 1 ? "fl" : "picc" }] } } }
                : {}),
              sequences: [
                {
                  content: [
                    { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                    { duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            })),
          },
        ],
      })}
    />
  ),
};

export const SaxophoneChangeAtBlue: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: {
          measures: [
            { id: "m0", time: { count: 4, unit: 4 } },
            { id: "m1", _x: { viritura: { rehearsalMark: { text: [{ text: "I" }], style: "boxed" } } } },
            {},
            { tempos: [{ bpm: 135, value: { base: "quarter" }, _x: { viritura: { text: [{ text: "Blue" }] } } }] },
          ],
        },
        scores: [{ name: "Clarinet doubling alto saxophone", multimeasureRests: [{ start: "m1", duration: 2 }] }],
        parts: [
          {
            name: "Clarinet",
            shortName: "Cl.",
            _x: {
              viritura: {
                initialInstrument: "clarinet",
                instruments: {
                  clarinet: { instrumentId: "wind.reed.clarinet", name: "Clarinet", shortName: "Cl." },
                  sax: {
                    instrumentId: "wind.reed.saxophone.alto",
                    name: "Alto Saxophone",
                    shortName: "A. Sax.",
                    transposition: { interval: { halfSteps: 9, staffDistance: 5 } },
                  },
                },
              },
            },
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { duration: { base: "half", dots: 1 }, rest: {} },
                      { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                      { duration: { base: "eighth" }, rest: {} },
                    ],
                  },
                ],
              },
              ...Array.from({ length: 2 }, () => ({
                sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
              })),
              {
                _x: { viritura: { instrumentChanges: [{ instrument: "sax" }] } },
                sequences: [
                  { content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }] },
                ],
              },
            ],
          },
        ],
      })}
    />
  ),
};

function condensedDoublingScore(): string {
  const score = JSON.parse(doublingScore(true)) as {
    parts: {
      id: string;
      name: string;
      shortName: string;
      _x?: unknown;
      measures: {
        sequences: unknown[];
        clefs?: unknown[];
        _x?: unknown;
      }[];
    }[];
    layouts?: unknown[];
    scores: { name: string; layout: string; useWritten: boolean }[];
  };
  const doubling = score.parts[0]!;
  doubling.id = "ob2";
  score.parts.unshift({
    id: "ob1",
    name: "Oboe",
    shortName: "Ob.",
    _x: { viritura: { instrumentId: "wind.reed.oboe" } },
    measures: doubling.measures.map(({ sequences, clefs }) => ({ sequences, clefs })),
  });
  score.layouts = [
    {
      id: "condensed",
      content: [
        {
          type: "group",
          symbol: "bracket",
          content: [{ type: "staff", labelRef: { ref: "auto" }, sources: [{ part: "ob1" }, { part: "ob2" }] }],
        },
      ],
    },
  ];
  score.scores = [{ name: "Condensed oboes with English horn doubling", layout: "condensed", useWritten: true }];
  return JSON.stringify(score);
}

export const CondensedOboesWithEnglishHornDoubling: StoryObj = {
  render: () => <ScorePreview mnxJson={condensedDoublingScore()} />,
};

function reminderScore(instructionHidden: boolean, reminderHidden = false): string {
  const score = JSON.parse(doublingScore(true)) as {
    parts: {
      measures: {
        sequences: { content: unknown[] }[];
        _x?: { viritura: { instrumentChanges: unknown[] } };
      }[];
    }[];
  };
  const measures = score.parts[0]!.measures;
  measures[0]!.sequences[0]!.content = [
    { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
    { duration: { base: "half" }, rest: {} },
  ];
  measures[1]!._x = {
    viritura: {
      instrumentChanges: [
        {
          instrument: "eh",
          instruction: { hidden: instructionHidden },
          reminder: { text: "Prepare English horn", hidden: reminderHidden },
        },
      ],
    },
  };
  return JSON.stringify(score);
}

export const IndependentAdvanceReminder: StoryObj = {
  render: () => <ScorePreview mnxJson={reminderScore(false)} />,
};

export const AdvanceReminderWithHiddenChangeLabel: StoryObj = {
  render: () => <ScorePreview mnxJson={reminderScore(true)} />,
};

export const HiddenReminderWithVisibleChangeLabel: StoryObj = {
  render: () => <ScorePreview mnxJson={reminderScore(false, true)} />,
};

export const ShortClarinetTuningLabels: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}, {}, {}] },
        scores: [{ name: "Clarinet in B\u266d", useWritten: true }],
        parts: [
          {
            name: "Clarinet",
            shortName: "Cl",
            transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
            measures: Array.from({ length: 4 }, (_, index) => ({
              ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
              sequences: [
                {
                  content:
                    index === 1 || index === 2
                      ? [{ duration: { base: "whole" }, rest: {} }]
                      : [
                          { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                          { duration: { base: "half" }, rest: {} },
                        ],
                },
              ],
              ...(index === 3
                ? {
                    _x: {
                      viritura: {
                        instrumentChanges: [{ transposition: { interval: { halfSteps: 0, staffDistance: 0 } } }],
                      },
                    },
                  }
                : {}),
            })),
          },
        ],
      })}
    />
  ),
};

export const HornCrookChange: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}, {}] },
        scores: [{ name: "Written pitch", useWritten: true }],
        parts: [
          {
            name: "Horn",
            transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
            _x: { viritura: { instrumentId: "brass.french-horn", midiProgram: 60 } },
            measures: Array.from({ length: 3 }, (_, index) => ({
              ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
              sequences: [{ content: [{ duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
              ...(index === 1
                ? {
                    _x: {
                      viritura: {
                        instrumentChanges: [
                          {
                            transposition: { interval: { halfSteps: 9, staffDistance: 5 } },
                            instruction: { text: "in E-flat" },
                          },
                        ],
                      },
                    },
                  }
                : {}),
            })),
          },
        ],
      })}
    />
  ),
};
