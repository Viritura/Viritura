import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { mountScore, type ScoreViewMode } from "@viritura/score-viewer";
import score from "../../../../../packages/format/fixtures/mnx/c-major-scale.mnx?raw";

interface ViewerDemoProps {
  viewMode: ScoreViewMode;
  zoom: number;
  ink: string;
  paper: string;
}

function ViewerDemo({ viewMode, zoom, ink, paper }: ViewerDemoProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    const viewer = mountScore(root.current, score, {
      viewMode,
      zoom,
      ink,
      pageBackground: paper,
      background: "#252a34",
    });
    return () => viewer.destroy();
  }, [viewMode, zoom, ink, paper]);
  return <div ref={root} style={{ width: "100%", height: "85vh" }} />;
}

const meta: Meta<typeof ViewerDemo> = {
  title: "App/Framework-free score viewer",
  component: ViewerDemo,
  parameters: { layout: "fullscreen" },
  argTypes: {
    viewMode: { control: "select", options: ["page", "horizontal", "spread", "spread-horizontal", "horizon"] },
    zoom: { control: { type: "range", min: 0.25, max: 2, step: 0.05 } },
    ink: { control: "color" },
    paper: { control: "color" },
  },
};

export default meta;

export const DarkPaper: StoryObj<typeof ViewerDemo> = {
  args: { viewMode: "page", zoom: 1, ink: "#edf1f7", paper: "#252a34" },
};
