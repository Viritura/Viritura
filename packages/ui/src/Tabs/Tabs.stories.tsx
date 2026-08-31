import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ClipboardList, Palette, Paperclip } from "lucide-react";
import { Tabs } from "./Tabs";

const TAB_CONTENT_STYLE: CSSProperties = { padding: 16, fontSize: 13 };

// Tabs sit on two surface tiers in the app:
//   • Glass — inside floating panels (Inspector, Palette, etc.)
//   • Chrome — inside opaque app frames (Menu bar, status bar regions)
// Both decorators are exported so stories can pick the right backdrop.
const GLASS_PANEL_STYLE: CSSProperties = {
  width: 320,
  padding: "6px 6px 0",
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid rgba(20,20,28,0.08)",
  background: "rgba(255,255,255,0.35)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const CHROME_PANEL_STYLE: CSSProperties = {
  width: 320,
  padding: "6px 6px 0",
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid var(--border, rgba(20,20,28,0.08))",
  background: "var(--surface)",
};

const NARROW_CHROME_PANEL_STYLE: CSSProperties = { ...CHROME_PANEL_STYLE, width: 220 };

const SURFACE_PAIR_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
  alignItems: "center",
};

const SURFACE_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 6,
};

const meta: Meta<typeof Tabs> = {
  title: "UI Components/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

const PANEL_TABS = [
  { id: "parts", label: "Parts", icon: <ClipboardList size={14} /> },
  { id: "palettes", label: "Palettes", icon: <Palette size={14} /> },
  { id: "clips", label: "Clips", icon: <Paperclip size={14} /> },
];

export const Default: Story = {
  render: () => (
    <div style={SURFACE_PAIR_STYLE}>
      <div>
        <div style={SURFACE_LABEL_STYLE}>On glass</div>
        <div style={GLASS_PANEL_STYLE}>
          <Tabs tabs={PANEL_TABS} defaultTab="palettes">
            <div style={TAB_CONTENT_STYLE}>Tab content area</div>
          </Tabs>
        </div>
      </div>
      <div>
        <div style={SURFACE_LABEL_STYLE}>On chrome</div>
        <div style={CHROME_PANEL_STYLE}>
          <Tabs tabs={PANEL_TABS} defaultTab="palettes">
            <div style={TAB_CONTENT_STYLE}>Tab content area</div>
          </Tabs>
        </div>
      </div>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [tab, setTab] = useState("b");
    return (
      <div style={GLASS_PANEL_STYLE}>
        <Tabs
          tabs={[
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
            { id: "c", label: "Gamma" },
          ]}
          activeTab={tab}
          onTabChange={setTab}
        >
          <div style={TAB_CONTENT_STYLE}>
            Active tab: <strong>{tab}</strong>
          </div>
        </Tabs>
      </div>
    );
  },
};

export const TwoTabs: Story = {
  render: () => (
    <div style={CHROME_PANEL_STYLE}>
      <Tabs
        tabs={[
          { id: "source", label: "Source" },
          { id: "preview", label: "Preview" },
        ]}
        defaultTab="source"
      >
        <div style={TAB_CONTENT_STYLE}>Two-tab layout</div>
      </Tabs>
    </div>
  ),
};

export const HorizontalOverflow: Story = {
  render: () => (
    <div style={NARROW_CHROME_PANEL_STYLE}>
      <Tabs
        tabs={[
          { id: "instruments", label: "Instruments" },
          { id: "staff-groups", label: "Staff Groups" },
          { id: "document-setup", label: "Document Setup" },
        ]}
        defaultTab="instruments"
      >
        <div style={TAB_CONTENT_STYLE}>Labels remain complete; the tab strip scrolls horizontally.</div>
      </Tabs>
    </div>
  ),
};
