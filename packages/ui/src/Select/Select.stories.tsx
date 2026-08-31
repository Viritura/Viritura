import { useState } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select";

const WRAPPER_200_STYLE: CSSProperties = { width: 200 };
const WRAPPER_160_STYLE: CSSProperties = { width: 160 };
const VALUE_TEXT_STYLE: CSSProperties = { fontSize: 12, color: "var(--text-muted)", marginTop: 8 };

const meta: Meta<typeof Select> = {
  title: "UI Components/Select",
  component: Select,
  parameters: { layout: "centered" },
  argTypes: {
    disabled: { control: "boolean" },
    placeholder: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    value: "quarter",
    options: [
      { value: "whole", label: "Whole" },
      { value: "half", label: "Half" },
      { value: "quarter", label: "Quarter" },
      { value: "eighth", label: "Eighth" },
    ],
    placeholder: "Select duration…",
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <Select {...args} value={value} onValueChange={setValue} />;
  },
};

export const WithAutoOption: Story = {
  args: {
    value: "",
    options: [
      { value: "", label: "Auto" },
      { value: "up", label: "Up" },
      { value: "down", label: "Down" },
    ],
    placeholder: "Select direction…",
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div style={WRAPPER_200_STYLE}>
        <Select {...args} value={value} onValueChange={setValue} />
        <p style={VALUE_TEXT_STYLE}>Value: {JSON.stringify(value)}</p>
      </div>
    );
  },
};

export const Disabled: Story = {
  args: {
    ...Default.args,
    disabled: true,
  },
};

export const ManyOptions: Story = {
  args: {
    value: "C",
    options: "C D E F G A B"
      .split(" ")
      .flatMap((n) => ["", "♯", "♭"].map((a) => ({ value: `${n}${a}`, label: `${n}${a}` }))),
    placeholder: "Select note…",
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div style={WRAPPER_160_STYLE}>
        <Select {...args} value={value} onValueChange={setValue} />
      </div>
    );
  },
};
