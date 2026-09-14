import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Engraving Behavior/Rhythm & Spacing/Automatic Beaming",
  component: ScorePreview,
};

export default meta;

type Base = "eighth" | "16th";

function events(base: Base, count: number, prefix: string) {
  const steps = ["C", "D", "E", "F", "G", "A", "B"];
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    duration: { base },
    notes: [{ pitch: { step: steps[index % steps.length], octave: 5 } }],
  }));
}

function score(
  measures: Array<{
    count: number;
    unit: number;
    beatStructure?: number[];
    content: Array<Record<string, unknown>>;
  }>,
): string {
  return JSON.stringify({
    mnx: { version: 1 },
    global: {
      measures: measures.map(({ count, unit, beatStructure }) => ({
        time: {
          count,
          unit,
          ...(beatStructure ? { _x: { viritura: { beatStructure } } } : {}),
        },
      })),
    },
    parts: [
      {
        name: "Flute",
        measures: measures.map((measure, index) => ({
          ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
          sequences: [{ content: measure.content }],
        })),
      },
    ],
  });
}

/** Conventional defaults: 4/4 half-bars, compound 6/8, and asymmetric 5/8 and 7/8. */
export const MeterDefaults: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={score([
        { count: 4, unit: 4, content: events("eighth", 8, "four") },
        { count: 6, unit: 8, content: events("eighth", 6, "six") },
        { count: 5, unit: 8, content: events("eighth", 5, "five") },
        { count: 7, unit: 8, content: events("eighth", 7, "seven") },
      ])}
    />
  ),
  name: "Conventional meter defaults",
};

/** Authored beat structures override the conventional grouping without explicit beam objects. */
export const AuthoredIrregularGroups: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={score([
        { count: 5, unit: 8, beatStructure: [2, 3], content: events("eighth", 5, "five") },
        { count: 7, unit: 8, beatStructure: [3, 2, 2], content: events("eighth", 7, "seven") },
        { count: 9, unit: 8, beatStructure: [2, 3, 2, 2], content: events("eighth", 9, "nine") },
      ])}
    />
  ),
  name: "Authored asymmetric groupings",
};

/**
 * A sixteenth-note passage in beats 3–4 does not force the pure eighths in
 * beats 1–2 to abandon their half-measure group.
 */
export const HalfBarDurationSensitivity: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={score([
        {
          count: 4,
          unit: 4,
          content: [...events("eighth", 4, "first"), ...events("16th", 4, "third"), ...events("eighth", 2, "fourth")],
        },
      ])}
    />
  ),
  name: "Duration sensitivity by half bar",
};

/** A short rest can remain inside one authored irregular beat without joining across its boundary. */
export const RestsInsideIrregularGroups: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={score([
        {
          count: 5,
          unit: 8,
          beatStructure: [3, 2],
          content: [
            events("eighth", 1, "rest-a")[0]!,
            { duration: { base: "eighth" } },
            events("eighth", 1, "rest-b")[0]!,
            ...events("eighth", 2, "rest-c"),
          ],
        },
      ])}
    />
  ),
  name: "Beam over a rest inside an irregular beat",
};

/** Unlisted short meters retain quarter-note-equivalent fallback grouping. */
export const ShortUnitFallbacks: StoryObj = {
  render: () => (
    <ScorePreview
      mnxJson={score([
        { count: 4, unit: 8, content: events("eighth", 4, "four-eight") },
        { count: 10, unit: 8, content: events("eighth", 10, "ten-eight") },
        { count: 4, unit: 16, content: events("16th", 4, "four-sixteen") },
      ])}
    />
  ),
  name: "Short-unit fallback grouping",
};
