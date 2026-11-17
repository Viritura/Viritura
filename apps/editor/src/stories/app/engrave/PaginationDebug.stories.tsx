import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaginationDebugPanel, usePaginationDebugStore } from "../../../debug/pagination";
import { EditorScorePreview } from "../../storyFixtures/EditorScorePreview";

const score = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: Array.from({ length: 48 }, (_, index) => ({
      id: `m${index}`,
      ...(index === 0
        ? {
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" } }],
          }
        : {}),
    })),
  },
  parts: [
    {
      id: "p",
      name: "Flute",
      measures: Array.from({ length: 48 }, (_, index) => ({
        sequences: [
          {
            content:
              index % 8 >= 5
                ? [{ duration: { base: "whole" } }]
                : Array.from({ length: 4 }, () => ({
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 5 } }],
                  })),
          },
        ],
      })),
    },
  ],
  layouts: [{ id: "l", content: [{ type: "staff", sources: [{ part: "p" }] }] }],
  scores: [
    {
      name: "Flute",
      layout: "l",
      _x: {
        viritura: {
          pageSetup: {
            width: 150,
            height: 110,
            orientation: "portrait",
            margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
            spatiumMm: 1.75,
            pageTurns: { enabled: true, titlePage: "never" },
          },
        },
      },
    },
  ],
});

function PaginationDebugExample() {
  useEffect(() => {
    const previous = usePaginationDebugStore.getState().enabled;
    usePaginationDebugStore.getState().setEnabled(true);
    return () => usePaginationDebugStore.getState().setEnabled(previous);
  }, []);
  return (
    <>
      <PaginationDebugPanel />
      <EditorScorePreview mnxJson={score} viewMode="spread" height={650} showEditor={false} scrollAnchor="start" />
    </>
  );
}

const meta: Meta = {
  title: "App/Engrave Mode/Page & System Debug",
  component: PaginationDebugExample,
};
export default meta;
export const IndependentOverlay: StoryObj<typeof meta> = {};
