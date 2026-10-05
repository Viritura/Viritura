import { useEffect, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import { PalettePanel } from "../../../components/PalettePanel";
import { ScoreCanvas } from "../../../components/ScoreCanvas";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../../../store/DocumentContext";
import { TEXT_FRAME_MNX } from "../../storyFixtures/textFrameScore";

const ROOT_STYLE: CSSProperties = { display: "flex", height: "100vh", width: "100%" };
const PANEL_STYLE: CSSProperties = { width: 340, flexShrink: 0, overflow: "auto" };
const CANVAS_STYLE: CSSProperties = { flex: 1, minWidth: 0, position: "relative", overflow: "hidden" };
const TEXT_SECTION = { id: "text", requestId: 1 };

function WriteTextFrameHarness() {
  const { loadScore } = useDocumentActions();
  const loaded = useDocumentStore((state) => state.score !== null);
  useEffect(() => {
    loadScore(parseMnx(structuredClone(TEXT_FRAME_MNX)), "text-frames.mnx");
  }, [loadScore]);
  return (
    <div style={ROOT_STYLE}>
      <div style={PANEL_STYLE}>{loaded && <PalettePanel openSectionRequest={TEXT_SECTION} />}</div>
      <div style={CANVAS_STYLE}>{loaded && <ScoreCanvas keepLayoutBackendAlive viewMode="page" initialZoom={1} />}</div>
    </div>
  );
}

function WriteTextFrameStory() {
  return (
    <DocumentProvider>
      <WriteTextFrameHarness />
    </DocumentProvider>
  );
}

const meta: Meta<typeof WriteTextFrameStory> = {
  title: "App/Write Mode/Text Frames",
  component: WriteTextFrameStory,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof WriteTextFrameStory>;

export const TextPaletteCreation: Story = { name: "Create page frames from Text palette" };
