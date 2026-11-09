import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Score } from "@viritura/core";
import { Panel } from "@viritura/ui";
import { TempoRampInspector } from "../../tempoRamps";

const meta: Meta = { title: "App/Inspectors/Tempo Ramps", component: TempoRampInspector };
export default meta;

const SCORE: Score = {
  mnx: { version: 1 },
  global: {
    measures: [
      { id: "m0", time: { count: 4, unit: 4 }, tempos: [{ bpm: 100, value: { base: "quarter" } }] },
      { id: "m1" },
      { id: "m2" },
    ],
  },
  parts: [{ name: "Piano", measures: [0, 1, 2].map(() => ({ sequences: [{ content: [] }] })) }],
};

function Preview({ width = 360 }: { width?: number }) {
  const [score, setScore] = useState(SCORE);
  return (
    <Panel side="right" width={width} title="Notation Properties" subtitle="Selected: bars 1-2" scrollBody>
      <TempoRampInspector
        score={score}
        selection={{
          kind: "measure",
          startPartIndex: 0,
          endPartIndex: 0,
          startStaffIndex: 0,
          endStaffIndex: 0,
          startMeasure: 0,
          endMeasure: 1,
        }}
        updateScore={setScore}
      />
    </Panel>
  );
}

export const CreateAndEdit: StoryObj = { render: () => <Preview /> };
export const NarrowPanel: StoryObj = { render: () => <Preview width={280} /> };
