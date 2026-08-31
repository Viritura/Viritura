import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { TextPopover } from "./TextPopover";

const DECORATOR_STYLE: CSSProperties = {
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
};
const DECORATOR_RELATIVE_STYLE: CSSProperties = { height: "100vh", position: "relative" };
const TRIGGER_BUTTON_STYLE: CSSProperties = {
  padding: "8px 16px",
  border: "1px solid rgba(20,20,28,0.12)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(8px)",
  cursor: "pointer",
};
const BRAVURA_PREVIEW_STYLE: CSSProperties = { fontFamily: "Bravura, serif", fontSize: 18 };

const meta: Meta<typeof TextPopover> = {
  title: "UI Components/TextPopover",
  component: TextPopover,
  // TextPopover is a Tier-3 floating popover anchored over the score
  // canvas. Carries its own surface; render against the raw canvas to
  // avoid glass-on-glass stacking.
  parameters: { layout: "fullscreen", surface: "canvas" },
};

export default meta;
type Story = StoryObj<typeof TextPopover>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState<string | null>(null);
    return (
      <div style={DECORATOR_STYLE}>
        <button onClick={() => setOpen(true)} style={TRIGGER_BUTTON_STYLE}>
          {value ?? "Click to edit"}
        </button>
        <TextPopover
          open={open}
          onClose={() => setOpen(false)}
          onSubmit={(v) => {
            setValue(v);
            setOpen(false);
          }}
          position={{ x: window.innerWidth / 2, y: window.innerHeight / 2 - 60 }}
          title="Rehearsal mark"
          placeholder="A"
          initialValue={value ?? ""}
        />
      </div>
    );
  },
};

export const WithPreview: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <div style={DECORATOR_RELATIVE_STYLE}>
        <TextPopover
          open={open}
          onClose={() => setOpen(false)}
          onSubmit={() => setOpen(false)}
          position={{ x: window.innerWidth / 2, y: 200 }}
          title="Tempo"
          placeholder="120"
          inputType="number"
          renderPreview={(v) => <span style={BRAVURA_PREVIEW_STYLE}>♩ = {v || "120"}</span>}
        />
      </div>
    );
  },
};

export const WithValidation: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <div style={DECORATOR_RELATIVE_STYLE}>
        <TextPopover
          open={open}
          onClose={() => setOpen(false)}
          onSubmit={() => setOpen(false)}
          position={{ x: window.innerWidth / 2, y: 200 }}
          title="Measure number"
          placeholder="1–999"
          inputType="number"
          validate={(v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return "Must be a number";
            if (n < 1 || n > 999) return "Range 1–999";
            return null;
          }}
        />
      </div>
    );
  },
};
