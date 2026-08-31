import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Clock3, FolderOpen, FileUp, FilePlus2, GitBranchPlus } from "lucide-react";
import { ActionTile } from "./ActionTile";

const COL: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, width: 260 };

const meta: Meta<typeof ActionTile> = {
  title: "UI Components/ActionTile",
  component: ActionTile,
  // ActionTile appears inside dialog step flows (NewScoreDialog,
  // FolderConfirmDialog, StartCenter) — Tier-4 modal surface.
  parameters: { layout: "centered", surface: "modal" },
};
export default meta;

type Story = StoryObj<typeof ActionTile>;

export const StartCenterSidebar: Story = {
  render: () => (
    <div style={COL}>
      <ActionTile active icon={<Clock3 size={18} />} title="Recent Projects" hint="Continue where you left off" />
      <ActionTile icon={<FolderOpen size={18} />} title="Open Folder…" hint="Includes Git version history" />
      <ActionTile icon={<FileUp size={18} />} title="Open File…" hint="Standalone — no version history" />
      <ActionTile icon={<FilePlus2 size={18} />} title="New Score…" hint="Pick instruments, key, time signature" />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={COL}>
      <ActionTile
        icon={<GitBranchPlus size={18} />}
        title="Initialize Git project"
        hint="Coming soon — needs filesystem permissions"
        disabled
      />
    </div>
  ),
};

export const NoIcon: Story = {
  render: () => (
    <div style={COL}>
      <ActionTile title="Blank Score" hint="Choose instruments manually" />
      <ActionTile title="Solo Piano" hint="Single grand staff" />
      <ActionTile title="String Quartet" hint="Vln 1, Vln 2, Vla, Vc" />
    </div>
  ),
};
