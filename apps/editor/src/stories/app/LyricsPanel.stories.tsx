import { useEffect, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import { TooltipPrimitives } from "@viritura/ui";
import { PalettePanel } from "../../components/PalettePanel";
import { DocumentProvider, useDocumentActions } from "../../store/DocumentContext";
import { useOverlayStore } from "../../store/overlayStore";

const FRAME_STYLE: CSSProperties = {
  width: 360,
  height: 720,
  display: "flex",
  flexDirection: "column",
  background: "var(--surface)",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "var(--elevation-1)",
};

function LyricsPanelHarness() {
  const { loadScore } = useDocumentActions();

  useEffect(() => {
    loadScore(
      parseMnx({
        mnx: { version: 1 },
        global: {
          measures: [{ time: { count: 4, unit: 4 } }],
          lyrics: {
            lineMetadata: {
              "line-1": { label: "Lead", lang: "en-GB" },
              "line-2": { label: "Translation", lang: "fr" },
            },
            lineOrder: ["line-1", "line-2"],
          },
        },
        parts: [
          {
            name: "Voice",
            measures: [
              {
                sequences: [
                  {
                    content: [
                      {
                        id: "event-1",
                        duration: { base: "whole" },
                        notes: [{ pitch: { step: "C", octave: 4 } }],
                        lyrics: {
                          lines: {
                            "line-1": { text: "Hello" },
                            "line-2": { text: "Bonjour" },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "lyrics-panel-story.mnx",
    );
    useOverlayStore.setState({ lyricMode: false, lyricState: null, activeLyricLineId: "line-1" });
  }, [loadScore]);

  return (
    <div style={FRAME_STYLE}>
      <PalettePanel openSectionRequest={{ id: "text", requestId: 1 }} />
    </div>
  );
}

function LyricsPanelStory() {
  return (
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <LyricsPanelHarness />
      </DocumentProvider>
    </TooltipPrimitives.Provider>
  );
}

const meta: Meta<typeof LyricsPanelStory> = {
  title: "App/Write/Palettes/Text and Lyrics",
  component: LyricsPanelStory,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof LyricsPanelStory>;

export const Default: Story = {};
