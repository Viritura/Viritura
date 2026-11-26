import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import rehearsals from "../../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import { ClickView } from "../../click";
import { AppShell } from "../../components/AppShell";
import { ScoreCanvas, type ScoreCanvasHandle } from "../../components/ScoreCanvas";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../../store/DocumentContext";
import { useClickCanvasConfig } from "../../store/clickCanvasStore";

const ROOT_STYLE: CSSProperties = { height: "100vh", width: "100%", position: "relative" };

function ClickStoryContent() {
  const { loadScore } = useDocumentActions();
  const loaded = useDocumentStore((state) => state.score !== null);
  const canvasRef = useRef<ScoreCanvasHandle | null>(null);
  const config = useClickCanvasConfig();
  const [canvasZoom, setCanvasZoom] = useState(1);

  useEffect(() => {
    loadScore(parseMnx(JSON.parse(rehearsals)), "click-session.mnx");
  }, [loadScore]);

  return (
    <AppShell>
      <div style={ROOT_STYLE}>
        {loaded && (
          <ScoreCanvas
            ref={canvasRef}
            keepLayoutBackendAlive
            viewMode={config.viewMode}
            interactionMode="click"
            selectedScoreIndex={config.selectedScoreIndex}
            selectedPartIds={config.selectedPartIds}
            onClickMeasure={config.onSelectMeasure}
            pageSetupOverride={config.pageSetup}
            fitToView={config.fitToView}
            fitRequest={config.fitRequest}
            useWrittenOverride={config.useWritten}
            onViewportChange={({ zoom }) => setCanvasZoom(zoom)}
          />
        )}
      </div>
      <ClickView mnx={rehearsals} canvasRef={canvasRef} canvasZoom={canvasZoom} />
    </AppShell>
  );
}

function ClickViewStory() {
  return (
    <DocumentProvider>
      <ClickStoryContent />
    </DocumentProvider>
  );
}

const meta: Meta<typeof ClickViewStory> = {
  title: "App/Click",
  component: ClickViewStory,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ClickViewStory>;

export const ScoreAndFloatingTransport: Story = {};
