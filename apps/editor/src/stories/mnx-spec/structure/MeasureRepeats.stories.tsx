import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Barlines, Repeats & Navigation/Measure Repeats",
  component: ScorePreview,
};

export default meta;

type Obj = Record<string, unknown>;

const whole = (step: string, octave: number): Obj => ({
  duration: { base: "whole" },
  notes: [{ pitch: { step, octave } }],
});

const half = (step: string, octave: number): Obj => ({
  duration: { base: "half" },
  notes: [{ pitch: { step, octave } }],
});

/**
 * Build a single-part 4/4 score from a list of measure bodies. The first bar
 * carries the clef; every other bar is whatever the caller supplies.
 */
const makeScore = (partMeasures: Obj[]): string =>
  JSON.stringify(
    {
      mnx: { version: 1 },
      global: {
        measures: partMeasures.map((_, index) => (index === 0 ? { time: { count: 4, unit: 4 } } : {})),
      },
      parts: [
        {
          id: "P1",
          measures: partMeasures.map((measure, index) =>
            index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }], ...measure } : measure,
          ),
        },
      ],
    },
    null,
    2,
  );

const empty: Obj = { sequences: [{ content: [] }] };

/**
 * The one-bar simile from the MNX "Measure repeats" example: each sign stands
 * for the bar immediately before it, and by convention prints no count.
 */
export const OneBar: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={makeScore([
        { sequences: [{ content: [whole("C", 5)] }] },
        { ...empty, measureRepeat: { number: 1 } },
        { sequences: [{ content: [whole("G", 4)] }] },
        { ...empty, measureRepeat: { number: 1 } },
      ])}
    />
  ),
  name: "One-bar simile",
};

/**
 * A two-bar simile repeats the preceding pair. MNX encodes it only on the
 * first bar it covers; the second bar carries nothing.
 */
export const TwoBar: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={makeScore([
        { sequences: [{ content: [whole("C", 5)] }] },
        { sequences: [{ content: [whole("G", 4)] }] },
        { ...empty, measureRepeat: { number: 2 } },
        empty,
      ])}
    />
  ),
  name: "Two-bar simile with count",
};

/**
 * The iteration counter from the MNX "Measure repeats (with counters)"
 * example: a run of one-bar similes numbered so players keep their place.
 */
export const WithCounters: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={makeScore([
        { sequences: [{ content: [half("C", 5), half("G", 4)] }] },
        { ...empty, measureRepeat: { number: 1, counter: { count: 2, orient: "above" } } },
        { ...empty, measureRepeat: { number: 1, counter: { count: 3, orient: "above" } } },
        { ...empty, measureRepeat: { number: 1, counter: { count: 4, orient: "above" } } },
      ])}
    />
  ),
  name: "One-bar similes with iteration counters",
};

/**
 * Repeated two-bar spans show both number systems together: the large SMuFL
 * span numeral remains `2`, while the regular-text counter advances for each
 * iteration of the repeated two-bar phrase.
 */
export const TwoBarWithIterationCounters: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={makeScore([
        { sequences: [{ content: [half("C", 5), half("E", 5)] }] },
        { sequences: [{ content: [half("G", 4), half("C", 5)] }] },
        { ...empty, measureRepeat: { number: 2, counter: { count: 2, orient: "above" } } },
        empty,
        { ...empty, measureRepeat: { number: 2, counter: { count: 3, orient: "above" } } },
        empty,
        { ...empty, measureRepeat: { number: 2, counter: { count: 4, orient: "above" } } },
        empty,
      ])}
    />
  ),
  name: "Two-bar repeats with spans and iteration counters",
};

/** `displayNumber` overrides the printing convention in both directions. */
export const DisplayNumberOverride: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={makeScore([
        { sequences: [{ content: [whole("C", 5)] }] },
        { ...empty, measureRepeat: { number: 1, displayNumber: "yes" } },
        { sequences: [{ content: [whole("E", 5)] }] },
        { sequences: [{ content: [whole("G", 4)] }] },
        { ...empty, measureRepeat: { number: 2, displayNumber: "no" } },
        empty,
      ])}
    />
  ),
  name: "Show and hide repeat counts explicitly",
};

type InteractiveArgs = { number: number; counter: number; displayNumber: "yes" | "no" | "auto" };

/** Vary the span, counter, and count visibility of a single simile. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try measure-repeat counts",
  args: { number: 1, counter: 0, displayNumber: "auto" },
  argTypes: {
    number: { control: { type: "inline-radio" }, options: [1, 2, 4] },
    counter: { control: { type: "number", min: 0, max: 16, step: 1 } },
    displayNumber: { control: { type: "inline-radio" }, options: ["yes", "no", "auto"] },
  },
  render: ({ number, counter, displayNumber }) => {
    const sources: Obj[] = [];
    for (let index = 0; index < number; index++) {
      sources.push({ sequences: [{ content: [whole(["C", "D", "E", "F"][index % 4]!, 5)] }] });
    }
    const covered: Obj[] = Array.from({ length: number - 1 }, () => empty);
    return (
      <ScorePreview
        mnxJson={makeScore([
          ...sources,
          {
            ...empty,
            measureRepeat: {
              number,
              displayNumber,
              ...(counter > 0 ? { counter: { count: counter, orient: "above" } } : {}),
            },
          },
          ...covered,
        ])}
      />
    );
  },
};
