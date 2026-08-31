import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogBody,
  DialogActions,
  DialogCancelButton,
  DialogPrimaryButton,
} from "./Dialog";
import { FormField, FormInput } from "../FormField/FormField";
import { Select } from "../Select/Select";

const KEY_SIG_OPTIONS = [
  { value: "0", label: "C major" },
  { value: "1", label: "G major" },
  { value: "-1", label: "F major" },
];

const SHORTCUTS_HEADING_STYLE: CSSProperties = { fontSize: "0.9rem", marginBottom: 8, color: "var(--accent)" };
const SHORTCUTS_TABLE_STYLE: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" };
const SHORTCUTS_ROW_STYLE: CSSProperties = { borderBottom: "1px solid var(--border)" };
const SHORTCUTS_KEY_CELL_STYLE: CSSProperties = { padding: 4, fontWeight: 600 };
const SHORTCUTS_DESC_CELL_STYLE: CSSProperties = { padding: 4, color: "var(--text-muted)" };
const CONFIRM_TEXT_STYLE: CSSProperties = { fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1rem" };

const meta: Meta<typeof Dialog> = {
  title: "UI Components/Dialog",
  component: Dialog,
  // Dialog IS the Tier-4 modal surface — it brings its own dim overlay
  // and opaque raised surface. Render against the raw canvas so we see
  // the real modal recipe, not a doubled-up surface. (Components that
  // only LIVE inside a modal — ActionTile, Radio — use surface: "modal"
  // to get the .sbModalFrame wrapper instead.)
  parameters: { layout: "centered", surface: "canvas" },
  argTypes: {
    size: { control: "select", options: ["default", "wide", "xwide", "full"] },
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const DefaultSize: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [keySig, setKeySig] = useState("0");
    return (
      <>
        <button onClick={() => setOpen(true)}>Open Dialog</button>
        <Dialog open={open} onClose={() => setOpen(false)}>
          <DialogTitle>New Score</DialogTitle>
          <FormField label="Title">
            <FormInput type="text" large placeholder="Untitled" />
          </FormField>
          <FormField label="Tempo (BPM)">
            <FormInput type="number" large min={20} max={400} defaultValue={120} />
          </FormField>
          <FormField label="Key signature">
            <Select size="lg" value={keySig} onValueChange={setKeySig} options={KEY_SIG_OPTIONS} />
          </FormField>
          <DialogActions>
            <DialogCancelButton />
            <DialogPrimaryButton>Create</DialogPrimaryButton>
          </DialogActions>
        </Dialog>
      </>
    );
  },
};

export const WideWithHeader: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open Wide Dialog</button>
        <Dialog open={open} onClose={() => setOpen(false)} size="wide">
          <DialogHeader title="Keyboard Shortcuts" onClose={() => setOpen(false)} />
          <DialogBody>
            <h3 style={SHORTCUTS_HEADING_STYLE}>Navigation</h3>
            <table style={SHORTCUTS_TABLE_STYLE}>
              <tbody>
                <tr style={SHORTCUTS_ROW_STYLE}>
                  <td style={SHORTCUTS_KEY_CELL_STYLE}>← / →</td>
                  <td style={SHORTCUTS_DESC_CELL_STYLE}>Navigate notes</td>
                </tr>
                <tr style={SHORTCUTS_ROW_STYLE}>
                  <td style={SHORTCUTS_KEY_CELL_STYLE}>Ctrl+Z</td>
                  <td style={SHORTCUTS_DESC_CELL_STYLE}>Undo</td>
                </tr>
                <tr>
                  <td style={SHORTCUTS_KEY_CELL_STYLE}>Ctrl+S</td>
                  <td style={SHORTCUTS_DESC_CELL_STYLE}>Save</td>
                </tr>
              </tbody>
            </table>
          </DialogBody>
        </Dialog>
      </>
    );
  },
};

export const Confirm: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open Confirm</button>
        <Dialog open={open} onClose={() => setOpen(false)}>
          <DialogTitle>Delete Measure</DialogTitle>
          <p style={CONFIRM_TEXT_STYLE}>Are you sure you want to delete measure 4? This action cannot be undone.</p>
          <DialogActions>
            <DialogCancelButton />
            <DialogPrimaryButton onClick={() => setOpen(false)}>Delete</DialogPrimaryButton>
          </DialogActions>
        </Dialog>
      </>
    );
  },
};
