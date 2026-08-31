import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Paper } from "./Paper";

const DECORATOR_STYLE: CSSProperties = {
  padding: 48,
  background: "radial-gradient(circle at 30% 20%, #d8e6dd, #c8d4d8 55%, #b8c0c8)",
  borderRadius: 12,
};
const SHEET_STYLE: CSSProperties = { width: 240, height: 160 };
const TILES_ROW_STYLE: CSSProperties = { display: "flex", gap: 8 };
const TILE_STYLE: CSSProperties = {
  width: 56,
  height: 56,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "Bravura, sans-serif",
  fontSize: 28,
  color: "#1c1c24",
};
const TILE_ACTIVE_STYLE: CSSProperties = {
  width: 56,
  height: 56,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "Bravura, sans-serif",
  fontSize: 28,
  color: "rgb(var(--accent-rgb, 33, 94, 78))",
};
const CARD_STYLE: CSSProperties = { width: 280, padding: 18 };
const CARD_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  color: "#1c1c24",
};
const CARD_SUBTITLE_STYLE: CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "#5a5a64" };
const CARD_META_STYLE: CSSProperties = { margin: "12px 0 0", fontSize: 11, color: "#85857a" };

const meta: Meta<typeof Paper> = {
  title: "UI Components/Paper",
  component: Paper,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      // Tinted backdrop so the cast shadow is visible — paper looks
      // wrong against a pure-white storybook canvas.
      <div style={DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Paper>;

export const Sheet: Story = {
  render: () => <Paper style={SHEET_STYLE} />,
};

export const PaletteTiles: Story = {
  name: "Palette tiles (interactive)",
  render: () => (
    <div style={TILES_ROW_STYLE}>
      {["\u{1D11E}", "\u266F", "\u{1D134}"].map((g, i) => (
        <Paper key={i} as="button" interactive style={TILE_STYLE}>
          {g}
        </Paper>
      ))}
    </div>
  ),
};

export const PressedTile: Story = {
  name: "Pressed / selected tile",
  render: () => (
    <Paper as="button" interactive pressed style={TILE_ACTIVE_STYLE}>
      {"\u{1D11E}"}
    </Paper>
  ),
};

export const Card: Story = {
  render: () => (
    <Paper style={CARD_STYLE}>
      <p style={CARD_TITLE_STYLE}>Symphony No. 4</p>
      <p style={CARD_SUBTITLE_STYLE}>Movement II · Andante</p>
      <p style={CARD_META_STYLE}>Last edited 3 minutes ago</p>
    </Paper>
  ),
};
