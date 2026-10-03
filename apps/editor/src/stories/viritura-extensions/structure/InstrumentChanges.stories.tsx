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
