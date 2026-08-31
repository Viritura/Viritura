import { useState } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox";

const CHECKBOX_COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };

const meta: Meta<typeof Checkbox> = {
  title: "UI Components/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return <Checkbox label="Don't show on launch" checked={checked} onChange={(e) => setChecked(e.target.checked)} />;
  },
};

export const Checked: Story = {
  render: () => {
    const [checked, setChecked] = useState(true);
    return <Checkbox label="Enable autosave" checked={checked} onChange={(e) => setChecked(e.target.checked)} />;
  },
};

export const Disabled: Story = {
  render: () => (
    <div style={CHECKBOX_COL_STYLE}>
      <Checkbox label="Unavailable option" disabled />
      <Checkbox label="Unavailable (checked)" disabled defaultChecked />
    </div>
  ),
};

export const Group: Story = {
  render: () => {
    const [opts, setOpts] = useState({ a: true, b: false, c: false });
    const toggle = (k: "a" | "b" | "c") => (e: React.ChangeEvent<HTMLInputElement>) =>
      setOpts((p) => ({ ...p, [k]: e.target.checked }));
    return (
      <div style={CHECKBOX_COL_STYLE}>
        <Checkbox label="Show measure numbers" checked={opts.a} onChange={toggle("a")} />
        <Checkbox label="Show instrument names" checked={opts.b} onChange={toggle("b")} />
        <Checkbox label="Show concert pitch" checked={opts.c} onChange={toggle("c")} />
      </div>
    );
  },
};
