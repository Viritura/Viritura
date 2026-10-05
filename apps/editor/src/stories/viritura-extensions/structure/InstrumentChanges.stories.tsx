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
