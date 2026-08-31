import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Slider } from "./Slider";

const DECORATOR_STYLE: CSSProperties = { width: 260, padding: 16 };
const COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const COL_TIGHT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const CENTER_LABEL_STYLE: CSSProperties = { fontSize: 12, color: "var(--text-muted)", textAlign: "center" };
const INLINE_LABEL_STYLE: CSSProperties = { fontSize: 11, color: "var(--text-muted)" };
const VALUE_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text)",
  minWidth: 48,
  textAlign: "right",
};

const meta: Meta<typeof Slider> = {
  title: "UI Components/Slider",
  component: Slider,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState(50);
    return (
      <div style={COL_STYLE}>
        <Slider min={0} max={100} value={value} onChange={setValue} ariaLabel="Value" />
        <span style={CENTER_LABEL_STYLE}>{value}</span>
      </div>
    );
  },
};

export const Zoom: Story = {
  render: () => {
    const [zoom, setZoom] = useState(1);
    return (
      <div style={ROW_STYLE}>
        <span style={INLINE_LABEL_STYLE}>25%</span>
        <Slider min={0.25} max={4} step={0.05} value={zoom} onChange={setZoom} ariaLabel="Zoom" width={160} />
        <span style={INLINE_LABEL_STYLE}>400%</span>
        <span style={VALUE_LABEL_STYLE}>{Math.round(zoom * 100)}%</span>
      </div>
    );
  },
};

export const StepIncrement: Story = {
  render: () => {
    const [tempo, setTempo] = useState(120);
    return (
      <div style={COL_TIGHT_STYLE}>
        <Slider min={40} max={240} step={1} value={tempo} onChange={setTempo} ariaLabel="Tempo" />
        <span style={CENTER_LABEL_STYLE}>{tempo} BPM</span>
      </div>
    );
  },
};
