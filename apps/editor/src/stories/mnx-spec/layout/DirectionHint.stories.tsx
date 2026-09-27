import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Voice Direction Hint",
  component: ScorePreview,
};

export default meta;

type Hint = "upper" | "lower" | "auto";

interface VoiceSpec {
  /** Omit for an unhinted sequence, which MNX resolves as `auto`. */
  hint?: Hint;
  /** Sequence content, already MNX-shaped. */
  content: unknown[];
}

/** A whole-note on the given pitch. */
function note(step: string, octave: number): unknown {
  return { duration: { base: "whole" }, notes: [{ pitch: { step, octave } }] };
}

/** A visible whole-measure rest: real notation that contests the bar. */
const visibleRest = { duration: { base: "whole" }, rest: {} };

/** Silent time. MNX has no way to hide a rest, so `space` is the encoding. */
const hiddenRest = { type: "space", duration: [1, 1] };

function buildScore(voices: VoiceSpec[]): string {
  return JSON.stringify(
    {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
              sequences: voices.map(({ hint, content }) => (hint ? { directionHint: hint, content } : { content })),
            },
          ],
        },
      ],
    },
    null,
    2,
  );
}

/**
 * `sequence.directionHint` states which side of the staff a voice occupies.
 * When two or more voices contest the same part measure the hint is
 * authoritative, so the hinted voice keeps its side no matter where it sits
 * in the `sequences` array — here the `lower` voice is written first.
 */
export const HintOutranksArrayOrder: StoryObj = {
  name: "Hint outranks array order",
  render: () => (
    <ScorePreview
      mnxJson={buildScore([
        { hint: "lower", content: [note("C", 4)] },
        { hint: "upper", content: [note("A", 5)] },
      ])}
    />
  ),
};

/**
 * With no hints at all, array order breaks the tie: the first sequence takes
 * the upper side. This is the legacy behaviour, retained because MNX allows
 * several sequences in one part measure to share a hint, so a hint can never
 * impose a total ordering on its own.
 */
export const ArrayOrderBreaksTies: StoryObj = {
  name: "Array order breaks ties when unhinted",
  render: () => <ScorePreview mnxJson={buildScore([{ content: [note("A", 5)] }, { content: [note("C", 4)] }])} />,
};

/**
 * A hint is a hint, not a force. When a voice is the only notation in its part
 * measure there is nothing for it to sit above or below, so the hint decays and
 * the stem is chosen from pitch — this `upper` voice sits below the middle line
 * and therefore stems up, while a high voice would stem down.
 */
export const HintDecaysWhenUncontested: StoryObj = {
  name: "Hint decays to auto when uncontested",
  render: () => (
    <ScorePreview mnxJson={buildScore([{ hint: "upper", content: [note("C", 4)] }, { content: [hiddenRest] }])} />
  ),
};

/**
 * A *visible* rest is real notation, so it contests the bar and keeps the other
 * voice's hint authoritative. Contrast with the `space` case above: MNX has no
 * `rest.hide`, so a hidden rest is encoded as `space`, and that distinction is
 * exactly what decides whether the hint survives.
 */
export const VisibleRestContests: StoryObj = {
  name: "A visible rest contests the measure",
  render: () => (
    <ScorePreview mnxJson={buildScore([{ hint: "upper", content: [note("C", 4)] }, { content: [visibleRest] }])} />
  ),
};

/**
 * MNX places no cap on sequences per part measure and does not require hints to
 * be unique, so three voices can share two sides. The two `upper` voices both
 * stem up and array order simply orders them.
 */
export const ThreeVoicesSharingHints: StoryObj = {
  name: "Three voices sharing hints",
  render: () => (
    <ScorePreview
      mnxJson={buildScore([
        { hint: "upper", content: [note("A", 5)] },
        { hint: "upper", content: [note("E", 5)] },
        { hint: "lower", content: [note("C", 4)] },
      ])}
    />
  ),
};

type InteractiveArgs = { hint: Hint; other: "space" | "rest" | "notes" };

/** Vary the hint and what the second voice contains. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try direction hints",
  args: { hint: "upper", other: "notes" },
  argTypes: {
    hint: { control: { type: "radio" }, options: ["upper", "lower", "auto"] },
    other: { control: { type: "radio" }, options: ["space", "rest", "notes"] },
  },
  render: ({ hint, other }) => {
    const second = other === "notes" ? note("G", 3) : other === "rest" ? visibleRest : hiddenRest;
    return <ScorePreview mnxJson={buildScore([{ hint, content: [note("C", 4)] }, { content: [second] }])} />;
  },
};
