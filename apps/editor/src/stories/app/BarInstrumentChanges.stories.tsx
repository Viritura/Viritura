import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, TooltipPrimitives } from "@viritura/ui";
import type { Score } from "@viritura/core";
import { BarInstrumentChangeDialogHost } from "../../instrumentChanges";
import { createDocumentStore } from "../../store/documentStore";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }, {}, {}] },
  parts: [
    {
      id: "P1",
      name: "Flute",
      _x: { viritura: { instrumentId: "wind.flutes.flute", midiProgram: 73 } },
      measures: Array.from({ length: 3 }, () => ({ sequences: [{ content: [] }] })),
    },
  ],
};
const SELECTION = {
  kind: "measure",
  startPartIndex: 0,
  endPartIndex: 0,
  startStaffIndex: 0,
  endStaffIndex: 0,
  startMeasure: 1,
  endMeasure: 1,
} as const;

const HORN_SCORE: Score = {
  ...SCORE,
  parts: [
    {
      ...SCORE.parts[0]!,
      name: "Horn",
      transposition: { interval: { halfSteps: 7, staffDistance: 4 } },
      _x: { viritura: { instrumentId: "brass.french-horn", midiProgram: 60 } },
      measures: SCORE.parts[0]!.measures.map((measure, index) =>
        index === 1
          ? {
              ...measure,
              instrumentChanges: [
                {
                  transposition: { interval: { halfSteps: 14, staffDistance: 8 } },
                  instruction: { text: "in B-flat basso" },
                  reminder: { text: "Prepare B-flat basso" },
                },
              ],
            }
          : measure,
      ),
    },
  ],
};

function BarChangeStory({ initialScore = SCORE }: { initialScore?: Score }) {
  const [store] = useState(() => {
    const document = createDocumentStore();
    document.setState({ score: structuredClone(initialScore), workingScore: structuredClone(initialScore) });
    return document;
  });
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState("");
  return (
    <TooltipPrimitives.Provider>
      <Button onClick={() => setOpen(true)}>Change instrument or tuning in bar 2</Button>
      <BarInstrumentChangeDialogHost
        open={open}
        store={store}
        selection={SELECTION}
        onClose={() => setOpen(false)}
        updateScore={(score) => {
          store.setState({ score, workingScore: score });
          setSaved(JSON.stringify(score.parts[0]!.measures[1]!.instrumentChanges, null, 2));
        }}
      />
      <pre aria-label="Saved bar change">{saved}</pre>
    </TooltipPrimitives.Provider>
  );
}

const meta: Meta = { title: "App/Notation/Bar Instrument Changes", component: BarChangeStory };
export default meta;

export const ChangeInstrumentOrTuning: StoryObj = { render: () => <BarChangeStory /> };
export const HornTuningAndReminders: StoryObj = {
  render: () => <BarChangeStory initialScore={HORN_SCORE} />,
};
export const HouseStyleHiddenLabels: StoryObj = {
  render: () => (
    <BarChangeStory
      initialScore={{
        ...HORN_SCORE,
        instrumentChangeStyle: { showChangeLabel: false, showAdvanceReminder: false },
      }}
    />
  ),
};
