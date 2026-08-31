import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bug, FileInput, Gauge, Music, Palette, Type, Volume2, Waves } from "lucide-react";
import { NavList } from "./NavList";
import type { NavListGroup } from "./types";

const RAIL: CSSProperties = { width: 220 };
const SPLIT: CSSProperties = { display: "flex", gap: 24, width: 620, alignItems: "flex-start" };
const PANEL: CSSProperties = { flex: 1, fontSize: "0.875rem", opacity: 0.8, paddingTop: 8 };

const GROUPS: NavListGroup[] = [
  {
    id: "general",
    label: "General",
    items: [
      { id: "appearance", label: "Appearance", icon: <Palette size={14} /> },
      { id: "text-styles", label: "Text Styles", icon: <Type size={14} /> },
    ],
  },
  {
    id: "notation",
    label: "Notation",
    items: [{ id: "instruments", label: "Instrument Profiles", icon: <Music size={14} /> }],
  },
  {
    id: "audio",
    label: "Audio",
    items: [
      { id: "output", label: "Audio Output", icon: <Volume2 size={14} /> },
      { id: "reverb", label: "Default Reverb", icon: <Waves size={14} /> },
    ],
  },
  {
    id: "files",
    label: "Files",
    items: [{ id: "import", label: "Import", icon: <FileInput size={14} /> }],
  },
  {
    id: "advanced",
    label: "Advanced",
    items: [
      { id: "rendering", label: "Rendering", icon: <Gauge size={14} /> },
      { id: "layout-debug", label: "Layout Debug", icon: <Bug size={14} /> },
    ],
  },
];

const meta: Meta<typeof NavList> = {
  title: "UI Components/NavList",
  component: NavList,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof NavList>;

/** Focus a row, then use Up/Down/Home/End — navigation wraps at both ends. */
export const Grouped: Story = {
  render: () => {
    const [active, setActive] = useState("appearance");
    return (
      <div style={RAIL}>
        <NavList groups={GROUPS} value={active} onChange={setActive} ariaLabel="Settings categories" />
      </div>
    );
  },
};

export const WithTrailingAndDisabled: Story = {
  render: () => {
    const [active, setActive] = useState("appearance");
    const groups: NavListGroup[] = [
      {
        id: "general",
        label: "General",
        items: [
          { id: "appearance", label: "Appearance", icon: <Palette size={14} />, trailing: "3" },
          { id: "text-styles", label: "Text Styles", icon: <Type size={14} />, trailing: "12" },
        ],
      },
      {
        id: "audio",
        label: "Audio",
        items: [
          { id: "output", label: "Audio Output", icon: <Volume2 size={14} /> },
          // Arrow keys skip disabled rows entirely.
          { id: "reverb", label: "Default Reverb", icon: <Waves size={14} />, disabled: true },
        ],
      },
    ];
    return (
      <div style={RAIL}>
        <NavList groups={groups} value={active} onChange={setActive} ariaLabel="Settings categories" />
      </div>
    );
  },
};

/** Ungrouped rows: omit `label` on the single group. */
export const Ungrouped: Story = {
  render: () => {
    const [active, setActive] = useState("appearance");
    return (
      <div style={RAIL}>
        <NavList
          groups={[{ id: "all", items: GROUPS.flatMap((g) => g.items) }]}
          value={active}
          onChange={setActive}
          ariaLabel="Settings categories"
        />
      </div>
    );
  },
};

/** With `panelIdPrefix` the rows become tabs wired to a detail panel. */
export const AsTabList: Story = {
  render: () => {
    const [active, setActive] = useState("appearance");
    const label = GROUPS.flatMap((g) => g.items).find((i) => i.id === active)?.label ?? "";
    return (
      <div style={SPLIT}>
        <div style={RAIL}>
          <NavList
            groups={GROUPS}
            value={active}
            onChange={setActive}
            ariaLabel="Settings categories"
            panelIdPrefix="settings-panel"
          />
        </div>
        <div style={PANEL} id={`settings-panel-${active}`} role="tabpanel" tabIndex={0}>
          {label} panel content
        </div>
      </div>
    );
  },
};
