import { useEffect, useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP } from "@viritura/core";
import { FormField, Select } from "@viritura/ui";

import { EngraveLeftPanel } from "../../components/modes/engrave/EngraveLeftPanel";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../../score/ScoreBuilder";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../../store/DocumentContext";
import { createPlayer } from "../../score/InstrumentCatalog";
import { ProjectPageSetup } from "../../pageSetup";
import { useEngraveContextRefs, usePageSetupEditor } from "../../components/modes/engrave/hooks";

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
function HouseStyleHarness() {
  const { loadScore } = useDocumentActions();
  useEffect(() => {
    const json = buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, title: "House Style Demo" });
    loadScore(parseMnx(JSON.parse(json)));
  }, [loadScore]);
  return (
    <div style={FRAME_STYLE}>
      <EngraveLeftPanel
        score={parseMnx(JSON.parse(buildBlankScore({ ...DEFAULT_NEW_SCORE_SETTINGS, title: "House Style Demo" })))}
        activeScoreIndex={0}
        onApplyPageSetup={() => {}}
        onResetPageSetup={() => {}}
        onInstrumentNameDisplayChange={() => {}}
        onAutoHideEmptyPartsChange={() => {}}
        selectedBreakKind={null}
        hasLayoutOverrides={false}
        onRemoveSelectedBreak={() => {}}
        onResetAll={() => {}}
      />
    </div>
  );
}

function HouseStyleStory() {
  return (
    <DocumentProvider>
      <HouseStyleHarness />
    </DocumentProvider>
  );
}

const meta: Meta<typeof HouseStyleStory> = {
  title: "App/Engrave/Panel Tabs",
  component: HouseStyleStory,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof HouseStyleStory>;

export const HouseStyleAndLayouts: Story = {};

function PageDefaultsHarness() {
  const { loadScore, updateScore } = useDocumentActions();
  const score = useDocumentStore((state) => state.score);
  const [scoreIndex, setScoreIndex] = useState(0);
  const refs = useEngraveContextRefs(score, scoreIndex, updateScore);
  const { handleApplyPageSetup, handleResetPageSetup } = usePageSetupEditor(refs);
  useEffect(() => {
    const initial = parseMnx(
      JSON.parse(
        buildBlankScore({
          ...DEFAULT_NEW_SCORE_SETTINGS,
          players: [createPlayer("strings.violin"), createPlayer("strings.cello")],
        }),
      ),
    );
    initial.pageSetupDefaults = {
      score: { ...DEFAULT_PAGE_SETUP, width: 228.6, height: 304.8 },
      part: { ...DEFAULT_PART_PAGE_SETUP, width: 215.9, height: 279.4 },
    };
    const cello = initial.scores?.[2];
    if (cello) cello.pageSetup = { ...DEFAULT_PART_PAGE_SETUP, width: 250, height: 353 };
    loadScore(initial);
  }, [loadScore]);
  return (
    <div style={FRAME_STYLE}>
      {score && (
        <ProjectPageSetup
          score={score}
          scoreIndex={scoreIndex}
          onApply={handleApplyPageSetup}
          onReset={handleResetPageSetup}
          preamble={
            <FormField label="Active layout">
              <Select
                aria-label="Active layout"
                value={String(scoreIndex)}
                options={(score.scores ?? []).map((definition, index) => ({
                  value: String(index),
                  label: definition.name ?? `Layout ${index + 1}`,
                }))}
                onValueChange={(value) => setScoreIndex(Number(value))}
              />
            </FormField>
          }
        />
      )}
    </div>
  );
}

export const ScoreAndPartPageDefaults: Story = {
  render: () => (
    <DocumentProvider>
      <PageDefaultsHarness />
    </DocumentProvider>
  ),
};
