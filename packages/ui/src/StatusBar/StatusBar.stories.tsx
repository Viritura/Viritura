import { useState } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBar } from "./StatusBar";
import { StatusSelect } from "./StatusSelect";
import { StatusZoomControls } from "./StatusZoomControls";
import { WriteStatusBar, type WriteStatusBarProps } from "./WriteStatusBar";
import { PreviewStatusBar, type PreviewStatusBarProps } from "./PreviewStatusBar";

const STAGE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 120,
  padding: "32px 16px",
  background: "linear-gradient(135deg, #eef0f3 0%, #d8dde6 100%)",
  borderRadius: 12,
};

const SECTION_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  color: "var(--text-muted)",
};

const GALLERY_ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
  padding: 24,
};

function formatPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

const meta: Meta<typeof StatusBar> = {
  title: "UI Components/StatusBar",
  component: StatusBar,
  parameters: { layout: "fullscreen" },
};

export default meta;

// ─── Shell ──────────────────────────────────────────────────────

type ShellStory = StoryObj<typeof StatusBar>;

export const Shell: ShellStory = {
  name: "Shell (three slots)",
  render: () => (
    <div style={STAGE_STYLE}>
      <StatusBar left={<span>Left slot</span>} center={<span>Center slot</span>} right={<span>Right slot</span>} />
    </div>
  ),
};

export const ShellRightOnly: ShellStory = {
  name: "Shell (right slot only — preview pattern)",
  render: () => (
    <div style={STAGE_STYLE}>
      <StatusBar right={<span>Zoom: 100%</span>} />
    </div>
  ),
};

// ─── Primitives ─────────────────────────────────────────────────

export const ZoomControlsPrimitive: ShellStory = {
  name: "StatusZoomControls (primitive)",
  render: function Render() {
    const [zoom, setZoom] = useState(1);
    return (
      <div style={STAGE_STYLE}>
        <StatusBar
          right={
            <StatusZoomControls
              zoom={zoom}
              zoomLabel={formatPercent(zoom)}
              minZoom={0.25}
              maxZoom={4}
              onZoomChange={setZoom}
              onResetZoom={() => setZoom(1)}
              onCalibrate={() => undefined}
            />
          }
        />
      </div>
    );
  },
};

export const SelectPrimitive: ShellStory = {
  name: "StatusSelect (primitive)",
  render: function Render() {
    const [mode, setMode] = useState("page");
    return (
      <div style={STAGE_STYLE}>
        <StatusBar
          right={
            <StatusSelect
              value={mode}
              onChange={setMode}
              options={[
                { value: "page", label: "Page" },
                { value: "spread", label: "Spread" },
                { value: "spread-h", label: "Spread (H)" },
              ]}
              ariaLabel="View mode"
              tooltip="View mode"
            />
          }
        />
      </div>
    );
  },
};

// ─── WriteStatusBar ─────────────────────────────────────────────

type WriteStory = StoryObj<typeof WriteStatusBar>;

function useWriteArgs(): WriteStatusBarProps {
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<WriteStatusBarProps["viewMode"]>("page");
  const [useWritten, setUseWritten] = useState(false);
  return {
    zoom,
    zoomLabel: formatPercent(zoom),
    minZoom: 0.25,
    maxZoom: 4,
    onZoomChange: setZoom,
    onResetZoom: () => setZoom(1),
    onCalibrate: () => undefined,
    viewMode,
    onViewModeChange: setViewMode,
    useWritten,
    onConcertPitchToggle: setUseWritten,
  };
}

export const Write_Default: WriteStory = {
  name: "WriteStatusBar — default (controls only)",
  render: function Render() {
    const args = useWriteArgs();
    return (
      <div style={STAGE_STYLE}>
        <WriteStatusBar {...args} />
      </div>
    );
  },
};

export const Write_BeatCountWarning: WriteStory = {
  name: "WriteStatusBar — beat-count warning",
  render: function Render() {
    const args = useWriteArgs();
    return (
      <div style={STAGE_STYLE}>
        <WriteStatusBar
          {...args}
          beatCountIssueCount={3}
          onRepairMeasures={() => undefined}
          onDismissBeatCountWarnings={() => undefined}
        />
      </div>
    );
  },
};

// ─── PreviewStatusBar ───────────────────────────────────────────

type PreviewStory = StoryObj<typeof PreviewStatusBar>;

function usePreviewArgs(): PreviewStatusBarProps {
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<PreviewStatusBarProps["viewMode"]>("page");
  return {
    zoom,
    zoomLabel: formatPercent(zoom),
    minZoom: 0.25,
    maxZoom: 4,
    viewMode,
    onZoomChange: setZoom,
    onResetZoom: () => setZoom(1),
    onViewModeChange: setViewMode,
    onCalibrate: () => undefined,
  };
}

export const Preview_Publish: PreviewStory = {
  name: "PreviewStatusBar — publish (view mode + zoom)",
  render: function Render() {
    const args = usePreviewArgs();
    return (
      <div style={STAGE_STYLE}>
        <PreviewStatusBar {...args} />
      </div>
    );
  },
};

export const Preview_EngraveReview: PreviewStory = {
  name: "PreviewStatusBar — engrave / review (concert + zoom)",
  render: function Render() {
    const args = usePreviewArgs();
    const [useWritten, setUseWritten] = useState(false);
    // Engrave/review variant: drop the view-mode select, add concert/written.
    const { onViewModeChange: _omit, ...rest } = args;
    void _omit;
    return (
      <div style={STAGE_STYLE}>
        <PreviewStatusBar {...rest} useWritten={useWritten} onConcertPitchToggle={setUseWritten} />
      </div>
    );
  },
};

// ─── Gallery ────────────────────────────────────────────────────

export const Gallery: ShellStory = {
  name: "All variants (gallery)",
  render: function Render() {
    const writeArgs = useWriteArgs();
    const previewArgs = usePreviewArgs();
    return (
      <div style={GALLERY_ROOT_STYLE}>
        <section style={SECTION_STYLE}>
          <div style={SECTION_LABEL_STYLE}>Shell — three slots</div>
          <div style={STAGE_STYLE}>
            <StatusBar left={<span>Left</span>} center={<span>Center</span>} right={<span>Right</span>} />
          </div>
        </section>

        <section style={SECTION_STYLE}>
          <div style={SECTION_LABEL_STYLE}>WriteStatusBar — default</div>
          <div style={STAGE_STYLE}>
            <WriteStatusBar {...writeArgs} />
          </div>
        </section>

        <section style={SECTION_STYLE}>
          <div style={SECTION_LABEL_STYLE}>WriteStatusBar — beat-count warning</div>
          <div style={STAGE_STYLE}>
            <WriteStatusBar
              {...writeArgs}
              beatCountIssueCount={3}
              onRepairMeasures={() => undefined}
              onDismissBeatCountWarnings={() => undefined}
            />
          </div>
        </section>

        <section style={SECTION_STYLE}>
          <div style={SECTION_LABEL_STYLE}>PreviewStatusBar</div>
          <div style={STAGE_STYLE}>
            <PreviewStatusBar {...previewArgs} />
          </div>
        </section>
      </div>
    );
  },
};
