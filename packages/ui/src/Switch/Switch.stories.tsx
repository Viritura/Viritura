import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./Switch";
import { Checkbox } from "../Checkbox/Checkbox";

const STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, width: 320 };
const CAPTION: CSSProperties = { fontSize: "0.75rem", opacity: 0.7, margin: 0 };

const meta: Meta<typeof Switch> = {
  title: "UI Components/Switch",
  component: Switch,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  render: () => {
    const [on, setOn] = useState(true);
    return <Switch checked={on} onCheckedChange={setOn} label="Performance overlay" />;
  },
};

export const Sizes: Story = {
  render: () => {
    const [md, setMd] = useState(true);
    const [sm, setSm] = useState(true);
    return (
      <div style={STACK}>
        <Switch checked={md} onCheckedChange={setMd} label="Medium — dialogs" />
        <Switch size="sm" checked={sm} onCheckedChange={setSm} label="Small — dense panels" />
      </div>
    );
  },
};

export const States: Story = {
  render: () => (
    <div style={STACK}>
      <Switch checked={false} onCheckedChange={() => {}} label="Off" />
      <Switch checked onCheckedChange={() => {}} label="On" />
      <Switch checked={false} onCheckedChange={() => {}} disabled label="Disabled, off" />
      <Switch checked onCheckedChange={() => {}} disabled label="Disabled, on" />
    </div>
  ),
};

/** Switch vs Checkbox is a semantic choice, not a stylistic one. */
export const VersusCheckbox: Story = {
  render: () => {
    const [live, setLive] = useState(true);
    const [staged, setStaged] = useState(true);
    return (
      <div style={STACK}>
        <Switch checked={live} onCheckedChange={setLive} label="Show hitbox overlay" />
        <p style={CAPTION}>Switch — applies the moment you flip it.</p>
        <Checkbox checked={staged} onChange={(e) => setStaged(e.currentTarget.checked)} label="Include vendor data" />
        <p style={CAPTION}>Checkbox — staged until you press a confirm button.</p>
      </div>
    );
  },
};
