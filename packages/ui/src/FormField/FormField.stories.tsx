import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { FormField, FormInput } from "./FormField";
import { Select } from "../Select/Select";

const KEY_SIG_OPTIONS = [
  { value: "-2", label: "B♭ major" },
  { value: "-1", label: "F major" },
  { value: "0", label: "C major" },
  { value: "1", label: "G major" },
  { value: "2", label: "D major" },
];
const BEAT_UNIT_OPTIONS = [
  { value: "2", label: "2" },
  { value: "4", label: "4" },
  { value: "8", label: "8" },
];
const STEM_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

const NARROW_STYLE: CSSProperties = { width: 280, padding: 16 };
const LARGE_VARIANT_STYLE: CSSProperties = {
  width: 300,
  padding: 16,
  background: "rgba(255,255,255,0.35)",
  border: "1px solid rgba(20,20,28,0.08)",
  borderRadius: 14,
  backdropFilter: "blur(8px)",
};
const INSPECTOR_STYLE: CSSProperties = {
  width: 240,
  padding: 12,
  background: "rgba(255,255,255,0.35)",
  border: "1px solid rgba(20,20,28,0.08)",
  borderRadius: 10,
  backdropFilter: "blur(8px)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const meta: Meta<typeof FormField> = {
  title: "UI Components/FormField",
  component: FormField,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof FormField>;

export const TextInput: Story = {
  render: () => (
    <div style={NARROW_STYLE}>
      <FormField label="Title">
        <FormInput type="text" placeholder="Score title" />
      </FormField>
    </div>
  ),
};

export const WithLabelAction: Story = {
  render: () => (
    <div style={NARROW_STYLE}>
      <FormField label="Password" action={<a href="#forgot-password">Forgot password?</a>}>
        <FormInput type="password" placeholder="Your password" />
      </FormField>
    </div>
  ),
};

export const NumberInput: Story = {
  render: () => (
    <div style={NARROW_STYLE}>
      <FormField label="Number of measures">
        <FormInput type="number" min={1} max={999} defaultValue={8} />
      </FormField>
    </div>
  ),
};

export const SelectField: Story = {
  render: function SelectFieldStory() {
    const [v, setV] = useState("0");
    return (
      <div style={NARROW_STYLE}>
        <FormField label="Key signature">
          <Select value={v} onValueChange={setV} options={KEY_SIG_OPTIONS} />
        </FormField>
      </div>
    );
  },
};

export const LargeVariant: Story = {
  render: function LargeVariantStory() {
    const [beat, setBeat] = useState("4");
    return (
      <div style={LARGE_VARIANT_STYLE}>
        <FormField label="Title">
          <FormInput type="text" large placeholder="Score title" />
        </FormField>
        <FormField label="Tempo (BPM)">
          <FormInput type="number" large min={20} max={400} defaultValue={120} />
        </FormField>
        <FormField label="Beat unit">
          <Select size="lg" value={beat} onValueChange={setBeat} options={BEAT_UNIT_OPTIONS} />
        </FormField>
      </div>
    );
  },
};

export const WithError: Story = {
  render: () => (
    <div style={NARROW_STYLE}>
      <FormField label="Tempo (BPM)" error="Must be between 20 and 400">
        <FormInput type="number" defaultValue={999} />
      </FormField>
    </div>
  ),
};

export const WithMessage: Story = {
  render: () => (
    <div style={NARROW_STYLE}>
      <FormField label="Project name" message="Choose the folder that should contain your new project.">
        <FormInput required placeholder="My Project" />
      </FormField>
    </div>
  ),
};

export const InspectorStyle: Story = {
  render: function InspectorStyleStory() {
    const [stem, setStem] = useState("auto");
    return (
      <div style={INSPECTOR_STYLE}>
        <FormField label="Stem direction">
          <Select value={stem} onValueChange={setStem} options={STEM_OPTIONS} />
        </FormField>
        <FormField label="Staff offset">
          <FormInput type="number" defaultValue={0} />
        </FormField>
      </div>
    );
  },
};
