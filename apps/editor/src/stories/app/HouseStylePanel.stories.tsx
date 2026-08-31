import { useEffect, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";

import { EngraveLeftPanel } from "../../components/modes/engrave/EngraveLeftPanel";
import { buildBlankScore, DEFAULT_NEW_SCORE_SETTINGS } from "../../score/ScoreBuilder";
import { DocumentProvider, useDocumentActions } from "../../store/DocumentContext";

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
