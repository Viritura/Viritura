import { useEffect, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP, type Score } from "@viritura/core";
import { FormField, Select } from "@viritura/ui";

import { EngraveLeftPanel } from "../../components/modes/engrave/EngraveLeftPanel";
import { useStyleEditorStore } from "../../components/modes/engrave/StyleEditor";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../../score/ScoreBuilder";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../../store/DocumentContext";
import { useViewStateStore } from "../../store/viewStateStore";
import { createPlayer } from "../../score/InstrumentCatalog";

const FRAME_STYLE: CSSProperties = {
  width: 380,
  height: 720,
  display: "flex",
  flexDirection: "column",
  background: "var(--surface)",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "var(--elevation-1)",
};

/** Score, violin, and cello layouts with project profiles, a named study-score profile, and one custom part. */
function demoScore(): Score {
  const score = parseMnx(
    JSON.parse(
      buildBlankScore({
        ...DEFAULT_NEW_SCORE_SETTINGS,
        title: "House Style Demo",
        players: [createPlayer("strings.violin"), createPlayer("strings.cello")],
      }),
    ),
  );
  score.pageSetupDefaults = {
    score: { ...DEFAULT_PAGE_SETUP, width: 228.6, height: 304.8 },
    part: { ...DEFAULT_PART_PAGE_SETUP, width: 215.9, height: 279.4 },
  };
  score.layoutProfiles = [{ id: "profile-study", name: "Study score", role: "score", pageSetup: { spatiumMm: 1.2 } }];
  const cello = score.scores?.[2];
  if (cello) cello.pageSetup = { width: 250, height: 353 };
  return score;
}

function Harness({ mode }: { mode: "layout" | "house" }) {
  const { loadScore } = useDocumentActions();
  const score = useDocumentStore((state) => state.workingScore ?? state.score);
  const scoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const setScoreIndex = useViewStateStore((state) => state.setSelectedScoreIndex);
  useEffect(() => {
    loadScore(demoScore());
    if (mode === "house") useStyleEditorStore.getState().openHouse({ kind: "profile", role: "part" });
    else useStyleEditorStore.getState().openLayout();
  }, [loadScore, mode]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <FormField label="Layout (stands in for the top-nav switcher)">
        <Select
          aria-label="Layout"
          value={String(scoreIndex)}
          options={(score?.scores ?? []).map((definition, index) => ({
            value: String(index),
            label: definition.name ?? `Layout ${index + 1}`,
          }))}
          onValueChange={(value) => setScoreIndex(Number(value))}
        />
      </FormField>
      <div style={FRAME_STYLE}>
        <EngraveLeftPanel
          score={score}
          activeScoreIndex={scoreIndex}
          onInstrumentNameDisplayChange={() => {}}
          onAutoHideEmptyPartsChange={() => {}}
          selectedBreakKind={null}
          hasLayoutOverrides={false}
          onRemoveSelectedBreak={() => {}}
          onResetAll={() => {}}
        />
      </div>
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "App/Engrave/Style Panel",
  component: Harness,
  parameters: { layout: "centered" },
  render: (args) => (
    <DocumentProvider>
      <Harness {...args} />
    </DocumentProvider>
  ),
};

export default meta;
type Story = StoryObj<typeof Harness>;

export const LayoutSettings: Story = { args: { mode: "layout" } };

export const HouseStyle: Story = { args: { mode: "house" } };
