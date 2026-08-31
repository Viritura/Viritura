import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, type BadgeProps } from "./Badge";

const STATUS_BAR_EXAMPLE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  color: "var(--text-muted)",
};

const GALLERY_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  rowGap: 12,
  columnGap: 16,
  alignItems: "center",
};

const GALLERY_LABEL_STYLE: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  color: "var(--text-muted)",
};

const GALLERY_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const GALLERY_GROUP_STYLE: CSSProperties = { display: "contents" };

const VARIANTS: ReadonlyArray<{ variant: NonNullable<BadgeProps["variant"]>; label: string }> = [
  { variant: "accent", label: "NOTE INPUT" },
  { variant: "muted", label: "Hover info" },
  { variant: "error", label: "3 errors" },
  { variant: "warning", label: "Warning" },
  { variant: "success", label: "Saved" },
];

const meta: Meta<typeof Badge> = {
  title: "UI Components/Badge",
  component: Badge,
  // Badge's only @viritura/ui importer is `StatusBar.tsx` — the Tier-2
  // chrome status bar pinned to the bottom of the editor. Render on
  // chrome so the muted text + subtle surface read like production.
  parameters: { layout: "centered", surface: "chrome" },
  argTypes: {
    variant: { control: "select", options: ["accent", "muted", "error", "warning", "success"] },
    mono: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Playground: Story = {
  args: { children: "NOTE INPUT", variant: "accent" },
};

export const AllVariants: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={GALLERY_STYLE}>
      {VARIANTS.map(({ variant, label }) => (
        <div key={variant} style={GALLERY_GROUP_STYLE}>
          <code style={GALLERY_LABEL_STYLE}>{variant}</code>
          <div style={GALLERY_ROW_STYLE}>
            <Badge variant={variant}>{label}</Badge>
            <Badge variant={variant} mono>
              {label}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const StatusBarExample: Story = {
  render: () => (
    <div style={STATUS_BAR_EXAMPLE_STYLE}>
      <span>No selection</span>
      <Badge variant="accent">NOTE INPUT</Badge>
      <Badge variant="accent" mono>
        Cursor: M1 Beat 1.00 V1 S1
      </Badge>
      <Badge variant="muted" mono>
        Hover: M2 Beat 3.50 X:450
      </Badge>
    </div>
  ),
};
