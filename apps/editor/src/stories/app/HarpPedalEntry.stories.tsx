import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Pitch, Score } from "@viritura/core";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { HarpPedalPopover } from "../../harpPedals";
import { createDocumentStore } from "../../store/documentStore";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [
    {
      id: "harp",
      name: "Harp",
      staves: 2,
      _x: { viritura: { instrumentId: "pluck.harp" } },
      measures: [
        {
          sequences: [
            { staff: 1, content: [] },
            { staff: 2, content: [] },
          ],
        },
      ],
    },
  ],
};

const SELECTION = {
  kind: "measure",
  startPartIndex: 0,
  endPartIndex: 0,
  startStaffIndex: 0,
  endStaffIndex: 0,
  startMeasure: 0,
  endMeasure: 0,
} as const;

function rankedExample(): Score {
  const score = structuredClone(SCORE);
  const pitches: Pitch[] = [
    { step: "C", octave: 4 },
    { step: "C", alter: 1, octave: 4 },
    { step: "F", octave: 4 },
    { step: "F", alter: 1, octave: 4 },
  ];
  score.parts[0]!.measures[0]!.sequences[0]!.content = pitches.map((pitch, index) => ({
    type: "event",
    id: `event-${index}`,
    duration: { base: "quarter" },
    notes: [{ id: `note-${index}`, pitch }],
  }));
  return score;
}

const RANKED_SCORE = rankedExample();

function HarpPedalEntryStory({ existing = false, initialScore = SCORE }: { existing?: boolean; initialScore?: Score }) {
  const [store] = useState(() => {
    const score = structuredClone(initialScore);
    if (existing) {
      score.parts[0]!.measures[0]!.harpPedals = [
        {
          id: "setting",
          position: { fraction: [0, 1] },
          tuning: { D: -1, C: 0, B: 0, E: 0, F: 0, G: 1, A: -1 },
          display: "names",
          placement: "between",
        },
      ];
    }
    const document = createDocumentStore();
    document.setState({ score, workingScore: score });
    return document;
  });
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState("");
  return (
    <TooltipPrimitives.Provider>
      <Button onClick={() => setOpen(true)}>Set harp pedals</Button>
      <HarpPedalPopover
        open={open}
        onClose={() => setOpen(false)}
        position={{ x: window.innerWidth / 2, y: 100 }}
        store={store}
        selection={SELECTION}
        updateScore={(score) => {
          store.setState({ score, workingScore: score });
          setSaved(JSON.stringify(score.parts[0]!.measures[0]!.harpPedals, null, 2));
        }}
      />
      <pre aria-label="Saved harp pedals">{saved}</pre>
    </TooltipPrimitives.Provider>
  );
}

const meta: Meta = { title: "App/Notation/Harp Pedal Entry", component: HarpPedalEntryStory };
export default meta;

export const NewSetting: StoryObj = { render: () => <HarpPedalEntryStory /> };
export const EditExisting: StoryObj = { render: () => <HarpPedalEntryStory existing /> };
export const RankedSolutions: StoryObj = { render: () => <HarpPedalEntryStory initialScore={RANKED_SCORE} /> };
