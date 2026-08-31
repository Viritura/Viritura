import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { VirituraLogo, VirituraMark, VirituraWordmark } from "./BrandLogo";
import { FolioFaviconExplorations } from "./FolioFaviconExplorations";
import { LogoExplorations } from "./LogoExplorations";

const DARK_BG_STYLE: CSSProperties = { padding: 32, background: "#1a1f2c", borderRadius: 12, color: "#83c8b3" };
const FAVICON_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "flex-end", gap: 18, color: "var(--accent)" };
const ACCENT_STYLE: CSSProperties = { color: "var(--accent)" };

const meta: Meta<typeof VirituraLogo> = {
  title: "UI Components/BrandLogo",
  component: VirituraLogo,
  // BrandLogo is an identity mark — it's shown on whatever surface
  // the host provides (login splash, about pane, marketing) and isn't
  // a glass-panel inhabitant in the Material Tiers sense.
  parameters: { layout: "centered", surface: "canvas" },
};

export default meta;
type Story = StoryObj<typeof VirituraLogo>;

export const Lockup: Story = {
  render: () => <VirituraLogo markSize={40} wordmarkWidth={190} />,
};

export const MarkOnly: Story = {
  render: () => (
    <div style={ACCENT_STYLE}>
      <VirituraMark size={64} />
    </div>
  ),
};

export const WordmarkOnly: Story = {
  render: () => (
    <div style={ACCENT_STYLE}>
      <VirituraWordmark width={240} />
    </div>
  ),
};

export const OnDark: Story = {
  render: () => (
    <div data-theme="dark" style={DARK_BG_STYLE}>
      <VirituraLogo markSize={44} wordmarkWidth={210} />
    </div>
  ),
};

export const FaviconScale: Story = {
  render: () => (
    <div style={FAVICON_ROW_STYLE}>
      <VirituraMark size={16} />
      <VirituraMark size={32} />
      <VirituraMark size={64} />
    </div>
  ),
};

export const TypographyDirections: Story = {
  parameters: {
    layout: "fullscreen",
    surface: "canvas",
  },
  render: () => <LogoExplorations />,
};

export const FolioFaviconDirections: Story = {
  parameters: {
    layout: "fullscreen",
    surface: "canvas",
  },
  render: () => <FolioFaviconExplorations />,
};
