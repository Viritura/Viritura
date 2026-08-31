import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const SYMBOLS = [
  "normal",
  "angled",
  "square",
  "doubleAngled",
  "doubleSquare",
  "doubleDot",
  "halfCurve",
  "curlew",
] as const;

const DURATIONS = ["auto", "none", "veryShort", "short", "normal", "long", "veryLong"] as const;

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Fermatas",
  component: ScorePreview,
  argTypes: {
    symbol: { control: "select", options: SYMBOLS },
    orient: { control: "select", options: ["above", "below", "auto"] },
    duration: { control: "select", options: DURATIONS },
  },
  args: { symbol: "normal", orient: "above", duration: "auto" },
};

export default meta;

type Args = { symbol: string; orient: string; duration: string };

export const Default: StoryObj<Args> = {
  render: ({ symbol, orient, duration }) => {
    const fermata: Record<string, unknown> = {};
    if (symbol !== "normal") fermata.symbol = symbol;
    if (orient !== "auto") fermata.orient = orient;
    if (duration !== "auto") fermata.duration = duration;
    const mnx = buildSingleMeasure([
      { duration: "half", fermata, notes: [{ step: "C", octave: 5 }] },
      { duration: "half", rest: true },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Single fermata",
};

export const AllSymbols: StoryObj = {
  render: () => {
    const events = SYMBOLS.map((symbol) => ({
      duration: "quarter" as const,
      fermata: symbol === "normal" ? {} : { symbol },
      notes: [{ step: "E" as const, octave: 5 }],
    }));
    const mnx = buildSingleMeasure(events, { time: { count: 8, unit: 4 } });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "All eight fermata symbols",
};

export const OrientBelow: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "half", fermata: { orient: "below" }, notes: [{ step: "G", octave: 5 }] },
      { duration: "half", fermata: { symbol: "square", orient: "below" }, notes: [{ step: "F", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Fermata below the staff",
};
