import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bug, FileInput, Gauge, Palette, Volume2, Waves, X } from "lucide-react";
import { Dialog, DialogHeader } from "./Dialog";
import { DialogSplitBody, DialogSplitAside, DialogSplitMain, DialogSplitMainHeader } from "./DialogSplit";
import { NavList, type NavListGroup } from "../NavList";
import { SearchInput } from "../SearchInput/SearchInput";
import { SettingsRow } from "../SettingsRow/SettingsRow";
import { Switch } from "../Switch/Switch";
import { Button } from "../Button/Button";

const EMPTY: CSSProperties = { fontSize: "0.875rem", opacity: 0.65, padding: "16px 4px", margin: 0 };

interface Category {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  description: string;
  settings: Array<{ id: string; label: string; description: string }>;
}

const CATEGORIES: Category[] = [
  {
    id: "appearance",
    label: "Appearance",
    group: "General",
    icon: <Palette size={14} />,
    description: "Theme and editor chrome.",
    settings: [
      { id: "a1", label: "Follow system theme", description: "Match the operating system's light/dark preference." },
      { id: "a2", label: "Reduce motion", description: "Disable panel and dialog transitions." },
    ],
  },
  {
    id: "import",
    label: "Import",
    group: "Files",
    icon: <FileInput size={14} />,
    description: "How MNX and MusicXML files are read.",
    settings: [
      { id: "i1", label: "Preserve vendor extensions", description: "Keep Viritura-specific engraving data." },
      { id: "i2", label: "Discard stem directions", description: "Let the engine choose stem directions." },
      { id: "i3", label: "Hide metronome mark", description: "Suppress it when tempo text is already present." },
    ],
  },
  {
    id: "output",
    label: "Audio Output",
    group: "Audio",
    icon: <Volume2 size={14} />,
    description: "Playback engine and device routing.",
    settings: [{ id: "o1", label: "Offline rendering", description: "Trade latency for fidelity." }],
  },
  {
    id: "reverb",
    label: "Default Reverb",
    group: "Audio",
    icon: <Waves size={14} />,
    description: "Applied to every instrument unless overridden.",
    settings: [{ id: "r1", label: "Enable reverb", description: "Adds a convolution tail to all instruments." }],
  },
  {
    id: "rendering",
    label: "Rendering",
    group: "Advanced",
    icon: <Gauge size={14} />,
    description: "Diagnostics for the canvas renderer.",
    settings: [
      { id: "d1", label: "Performance overlay", description: "Show frame timing and layout cost." },
      { id: "d2", label: "Hitbox overlay", description: "Outline every interactive region." },
      { id: "d3", label: "Bypass tile cache", description: "Repaint every tile on each frame." },
    ],
  },
  {
    id: "layout-debug",
    label: "Layout Debug",
    group: "Advanced",
    icon: <Bug size={14} />,
    description: "Spacing overlays from the engraving engine.",
    settings: [{ id: "l1", label: "Spacing overlay", description: "Draw system and staff measurement guides." }],
  },
];

const GROUP_ORDER = ["General", "Files", "Audio", "Advanced"];

function toGroups(categories: Category[]): NavListGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const items = categories.filter((c) => c.group === group);
    return items.length === 0
      ? []
      : [{ id: group, label: group, items: items.map((c) => ({ id: c.id, label: c.label, icon: c.icon })) }];
  });
}

const meta: Meta = {
  title: "UI Components/DialogSplit",
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj;

/**
 * The full settings shell: nav rail with search on the left, sticky-headed
 * detail pane on the right. Each pane scrolls independently.
 */
export const SettingsShell: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [active, setActive] = useState("appearance");
    const [query, setQuery] = useState("");
    const [values, setValues] = useState<Record<string, boolean>>({ a1: true, i1: true, d1: false });

    const matches = useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (needle === "") return CATEGORIES;
      return CATEGORIES.filter(
        (c) =>
          c.label.toLowerCase().includes(needle) ||
          c.group.toLowerCase().includes(needle) ||
          c.settings.some((s) => s.label.toLowerCase().includes(needle)),
      );
    }, [query]);

    const current = CATEGORIES.find((c) => c.id === active);

    return (
      <>
        {!open && <Button onClick={() => setOpen(true)}>Open settings</Button>}
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          size="xwide"
          onEscapeKeyDown={(event) => {
            // Escape clears an active search before it closes the dialog.
            if (query !== "") {
              event.preventDefault();
              setQuery("");
            }
          }}
        >
          <DialogHeader title="Settings" onClose={() => setOpen(false)} closeIcon={<X size={14} />} />
          <DialogSplitBody>
            <DialogSplitAside ariaLabel="Settings categories">
              <SearchInput size="sm" value={query} onValueChange={setQuery} placeholder="Search settings" />
              {matches.length === 0 ? (
                <p style={EMPTY}>No settings match “{query}”.</p>
              ) : (
                <NavList
                  groups={toGroups(matches)}
                  value={active}
                  onChange={setActive}
                  ariaLabel="Settings categories"
                  panelIdPrefix="settings-panel"
                />
              )}
            </DialogSplitAside>

            <DialogSplitMain id={`settings-panel-${active}`}>
              <DialogSplitMainHeader
                title={current?.label ?? ""}
                description={current?.description}
                actions={
                  <Button variant="ghost" size="sm">
                    Reset
                  </Button>
                }
              />
              {current?.settings.map((setting) => (
                <SettingsRow key={setting.id} label={setting.label} description={setting.description}>
                  {({ controlId, descriptionId }) => (
                    <Switch
                      id={controlId}
                      aria-describedby={descriptionId}
                      checked={values[setting.id] ?? false}
                      onCheckedChange={(next) => setValues((prev) => ({ ...prev, [setting.id]: next }))}
                    />
                  )}
                </SettingsRow>
              ))}
            </DialogSplitMain>
          </DialogSplitBody>
        </Dialog>
      </>
    );
  },
};
