import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Lyrics/Lyric Extenders",
  component: ScorePreview,
};

export default meta;

export const ExplicitAndInferred: StoryObj = {
  name: "Explicit and inferred word extensions",
  render: () => {
    const mnx = buildMnx({
      support: { useLyricExtenders: false },
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                id: "explicit-start",
                duration: "quarter",
                notes: [{ step: "C", octave: 4 }],
                lyrics: { lines: { "1": { text: "Ah", extender: { show: true, target: "explicit-end" } } } },
              },
              { id: "explicit-end", duration: "quarter", notes: [{ step: "D", octave: 4 }] },
              {
                id: "inferred-start",
                duration: "quarter",
                notes: [{ step: "E", octave: 4 }],
                lyrics: { lines: { "1": { text: "Halle" } } },
              },
              { id: "inferred-target", duration: "quarter", notes: [{ step: "F", octave: 4 }] },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "quarter",
                notes: [{ step: "G", octave: 4 }],
                lyrics: { lines: { "1": { text: "lujah" } } },
              },
              { duration: "half", notes: [{ step: "A", octave: 4 }] },
              { duration: "quarter", rest: true },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const OpenMeterContinuation: StoryObj = {
  name: "Explicit endpoint after an open-meter passage",
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1, support: { useLyricExtenders: true } },
        global: {
          measures: [
            { time: { count: 4, unit: 4 }, _x: { viritura: { senzaMisura: true } } },
            { time: { count: 4, unit: 4 } },
          ],
        },
        parts: [
          {
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { duration: { base: "breve" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                      {
                        id: "open-source",
                        duration: { base: "quarter" },
                        notes: [{ pitch: { step: "D", octave: 4 } }],
                        lyrics: { lines: { "1": { text: "Ah", extender: { target: "next-measure" } } } },
                      },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [
                      { id: "next-measure", duration: { base: "whole" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })}
    />
  ),
};

export const SparseVerses: StoryObj = {
  name: "Sparse verse rows across systems",
  render: () => (
    <ScorePreview
      viewMode="page"
      mnxJson={JSON.stringify({
        mnx: { version: 1, support: { useLyricExtenders: true } },
        global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }, { id: "m2" }] },
        parts: [
          {
            id: "singer",
            measures: [["1", "2"], ["2"], ["1"]].map((verses, index) => ({
              sequences: [
                {
                  content: [
                    {
                      id: `verse-event-${index}`,
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                      lyrics: {
                        lines: Object.fromEntries(
                          verses.map((verse) => [
                            verse,
                            { text: `Verse ${verse}`, extender: { target: `verse-event-${index}` } },
                          ]),
                        ),
                      },
                    },
                  ],
                },
              ],
            })),
          },
        ],
        layouts: [{ id: "voice", content: [{ type: "staff", sources: [{ part: "singer" }] }] }],
        scores: [
          {
            name: "Singer",
            pages: [
              {
                systems: [0, 1, 2].map((index) => ({
                  measure: `m${index}`,
                  layout: "voice",
                })),
              },
            ],
          },
        ],
      })}
    />
  ),
};

export const SplitSelfTarget: StoryObj = {
  name: "Syllable on onset, endpoint on final tied fragment",
  render: () => (
    <ScorePreview
      mnxJson={JSON.stringify({
        mnx: { version: 1, support: { useLyricExtenders: true } },
        global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
        parts: [
          {
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { duration: { base: "half" }, rest: {} },
                      { duration: { base: "quarter" }, rest: {} },
                      {
                        id: "onset",
                        duration: { base: "quarter" },
                        notes: [
                          { id: "onset-note", pitch: { step: "C", octave: 4 }, ties: [{ target: "final-note" }] },
                        ],
                        lyrics: { lines: { "1": { text: "Ah", extender: { target: "final-fragment" } } } },
                      },
                    ],
                  },
                ],
              },
              {
                sequences: [
                  {
                    content: [
                      {
                        id: "final-fragment",
                        duration: { base: "quarter" },
                        notes: [{ id: "final-note", pitch: { step: "C", octave: 4 } }],
                      },
                      { duration: { base: "half", dots: 1 }, rest: {} },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })}
    />
  ),
};
