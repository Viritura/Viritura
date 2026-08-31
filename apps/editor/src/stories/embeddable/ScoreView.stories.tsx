/**
 * Standalone <ScoreView> Storybook story.
 *
 * Demonstrates the publishable @viritura/score-viewer-react package
 * end-to-end: loads a staged MNX fixture from /scores, renders it
 * with a configurable zoom + page width, and shows the <ScoreView>
 * composition slots (.Page and .Playhead).
 *
 * This is the "consumer-facing" story — it imports nothing from the
 * editor's stores or chrome, so the rendering you see here is exactly
 * what an external consumer would get.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState, type CSSProperties } from "react";
import { ScoreView } from "@viritura/score-viewer-react";

const SCOREVIEW_ERROR_STYLE: CSSProperties = { color: "#b00", padding: 16 };
const SCOREVIEW_LOADING_STYLE: CSSProperties = { padding: 16, color: "#666" };
const SCOREVIEW_PAGE_STYLE: CSSProperties = { padding: 16, background: "#f5f5f5", minHeight: "100vh" };
const SCOREVIEW_CAPTION_STYLE: CSSProperties = {
  marginBottom: 12,
  fontFamily: "system-ui",
  fontSize: "var(--type-small-size)",
  color: "#444",
};
const SCOREVIEW_TRANSPARENT_STYLE: CSSProperties = { background: "transparent" };
const SCOREVIEW_PLAYHEAD_STYLE: CSSProperties = { color: "#e34935" };

interface ScoreViewDemoProps {
  scoreFile: string;
  pageWidth: number;
  zoom: number;
  pagesPerRow: number;
  showPlayhead: boolean;
  playheadBeat: number;
}

function ScoreViewDemo({ scoreFile, pageWidth, zoom, pagesPerRow, showPlayhead, playheadBeat }: ScoreViewDemoProps) {
  const [mnx, setMnx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setMnx(null);
    setErr(null);
    fetch(scoreFile)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setMnx)
      .catch((e) => setErr(String(e)));
  }, [scoreFile]);

  if (err) return <div style={SCOREVIEW_ERROR_STYLE}>Failed to load: {err}</div>;
  if (!mnx) return <div style={SCOREVIEW_LOADING_STYLE}>Loading {scoreFile}…</div>;

  return (
    <div style={SCOREVIEW_PAGE_STYLE}>
      <div style={SCOREVIEW_CAPTION_STYLE}>
        Rendered by <code>@viritura/score-viewer-react</code> — zero dependency on the editor.
      </div>
      <ScoreView
        mnx={mnx}
        pageWidth={pageWidth}
        zoom={zoom}
        pagesPerRow={pagesPerRow}
        style={SCOREVIEW_TRANSPARENT_STYLE}
      >
        {showPlayhead && <ScoreView.Playhead beat={playheadBeat} style={SCOREVIEW_PLAYHEAD_STYLE} />}
      </ScoreView>
    </div>
  );
}

const meta: Meta<typeof ScoreViewDemo> = {
  title: "Embeddable/ScoreView (publishable package)",
  component: ScoreViewDemo,
  argTypes: {
    scoreFile: {
      control: "select",
      options: ["/scores/twinkle.mnx", "/scores/bach-prelude.mnx", "/scores/scale.mnx"],
    },
    pageWidth: { control: { type: "number", min: 400, max: 1600, step: 50 } },
    zoom: { control: { type: "number", min: 0.25, max: 3, step: 0.05 } },
    pagesPerRow: { control: { type: "number", min: 1, max: 4, step: 1 } },
    showPlayhead: { control: "boolean" },
    playheadBeat: { control: { type: "number", min: 0, max: 64, step: 0.5 } },
  },
};
export default meta;

type Story = StoryObj<typeof ScoreViewDemo>;

export const Default: Story = {
  args: {
    scoreFile: "/scores/twinkle.mnx",
    pageWidth: 800,
    zoom: 1,
    pagesPerRow: 1,
    showPlayhead: false,
    playheadBeat: 0,
  },
};

export const WithPlayhead: Story = {
  args: {
    scoreFile: "/scores/twinkle.mnx",
    pageWidth: 800,
    zoom: 1,
    pagesPerRow: 1,
    showPlayhead: true,
    playheadBeat: 4,
  },
};

export const ZoomedIn: Story = {
  args: {
    scoreFile: "/scores/twinkle.mnx",
    pageWidth: 800,
    zoom: 1.5,
    pagesPerRow: 1,
    showPlayhead: false,
    playheadBeat: 0,
  },
};

export const TwoUp: Story = {
  args: {
    scoreFile: "/scores/twinkle.mnx",
    pageWidth: 600,
    zoom: 0.7,
    pagesPerRow: 2,
    showPlayhead: false,
    playheadBeat: 0,
  },
};
