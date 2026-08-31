import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Section } from "./Section";
import { FormField, FormInput } from "../FormField/FormField";
import { Select } from "../Select/Select";

const STEM_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const DURATION_OPTIONS = [{ value: "quarter", label: "Quarter" }];

const DECORATOR_STYLE: CSSProperties = { width: 260, padding: 12 };
const TEXT_STYLE: CSSProperties = { fontSize: 12, color: "var(--text)" };
const INSPECTOR_WRAP_STYLE: CSSProperties = {
  width: 280,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const meta: Meta<typeof Section> = {
  title: "UI Components/Section",
  component: Section,
  // Section is a Tier-1 glass panel container — its own surface.
  parameters: { layout: "centered", surface: "canvas" },
  argTypes: {
    variant: { control: "select", options: ["raised", "inset"] },
    focused: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Section>;

export const Raised: Story = {
  args: {
    title: "Stem & Beam",
    children: (
      <>
        <FormField label="Stem direction">
          <Select value="auto" onValueChange={() => {}} options={STEM_OPTIONS} />
        </FormField>
        <FormField label="Beam group">
          <FormInput type="number" defaultValue={0} />
        </FormField>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export const Inset: Story = {
  args: {
    title: "Properties",
    variant: "inset",
    children: <div style={TEXT_STYLE}>Inset section content</div>,
  },
  decorators: [
    (Story) => (
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export const Focused: Story = {
  args: {
    title: "Tie Properties",
    focused: true,
    children: <div style={TEXT_STYLE}>This section is focused (highlighted with accent ring)</div>,
  },
  decorators: [
    (Story) => (
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export const InspectorExample: Story = {
  render: () => (
    <div style={INSPECTOR_WRAP_STYLE}>
      <Section title="Note">
        <FormField label="Pitch">
          <FormInput readOnly value="C5" />
        </FormField>
        <FormField label="Duration">
          <Select value="quarter" onValueChange={() => {}} options={DURATION_OPTIONS} />
        </FormField>
      </Section>
      <Section title="Stem & Beam">
        <FormField label="Direction">
          <Select value="auto" onValueChange={() => {}} options={STEM_OPTIONS} />
        </FormField>
      </Section>
      <Section title="Ties" focused>
        <div style={TEXT_STYLE}>No ties on this note</div>
      </Section>
    </div>
  ),
};
