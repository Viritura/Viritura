import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text, type TextVariant } from "./Text";

const COLUMN_GAP_16: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const COLUMN_GAP_8: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const COLUMN_GAP_4: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const HINT_COLUMN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  maxWidth: 360,
};

const meta: Meta<typeof Text> = {
  title: "UI Components/Text",
  component: Text,
  parameters: { layout: "padded" },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "display",
        "title",
        "heading",
        "body",
        "control",
        "small",
        "eyebrow",
        "monoInline",
        "monoBlock",
      ] satisfies TextVariant[],
    },
    tone: {
      control: "select",
      options: ["default", "bright", "muted", "accent", "error"],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Text>;

const SAMPLE = "The quick brown fox jumps over the lazy dog";

export const Playground: Story = {
  args: { variant: "body", tone: "default", children: SAMPLE },
};

const ALL_VARIANTS: TextVariant[] = [
  "display",
  "title",
  "heading",
  "body",
  "control",
  "small",
  "eyebrow",
  "monoInline",
  "monoBlock",
];

export const AllVariants: Story = {
  render: () => (
    <div style={COLUMN_GAP_16}>
      {ALL_VARIANTS.map((v) => (
        <div key={v} style={COLUMN_GAP_4}>
          <Text variant="eyebrow">{v}</Text>
          <Text variant={v}>{v === "monoInline" || v === "monoBlock" ? "renderScore(mnx)" : SAMPLE}</Text>
        </div>
      ))}
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div style={COLUMN_GAP_8}>
      <Text variant="body" tone="bright">
        bright — primary copy emphasis
      </Text>
      <Text variant="body" tone="default">
        default — paragraph copy
      </Text>
      <Text variant="body" tone="muted">
        muted — secondary copy, hints, captions
      </Text>
      <Text variant="body" tone="accent">
        accent — links, brand callouts
      </Text>
      <Text variant="body" tone="error">
        error — validation copy
      </Text>
    </div>
  ),
};

export const RowVsHint: Story = {
  name: "Small: row vs hint",
  render: () => (
    <div style={HINT_COLUMN_STYLE}>
      <Text variant="small">Voicing assistant</Text>
      <Text variant="small" tone="muted">
        Suggests parallel-fifth fixes as you enter notes. Toggle off for hand-crafted voice leading.
      </Text>
    </div>
  ),
};
