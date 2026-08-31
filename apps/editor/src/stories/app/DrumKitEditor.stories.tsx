import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DrumKitDialog, type KitComponentEdit, type DrumKitTarget } from "../../components/DrumKitDialog";
import { FULL_DRUM_KIT_COMPONENTS } from "../../score/percussionPresets";

const PAGE_STYLE: CSSProperties = { padding: "1rem", color: "var(--text)", minHeight: "100vh" };
const OPEN_BUTTON_STYLE: CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
const PRE_STYLE: CSSProperties = {
  marginTop: "1rem",
  padding: "0.75rem",
  background: "var(--surface-dim)",
  borderRadius: 6,
  fontSize: "var(--type-eyebrow-size)",
  overflow: "auto",
  maxHeight: "40vh",
};

// The standard 5-piece Full Drum Kit preset, resolved into the same row shape
// the editor builds from a part's `kit` + `global.sounds`. Kept in sync with
// the canonical preset (single source of truth in percussionPresets).
const SAMPLE_TARGET: DrumKitTarget = {
  partIndex: 0,
  partName: "Percussion",
  components: FULL_DRUM_KIT_COMPONENTS.map((c) => ({
    id: c.id,
    name: c.name,
    staffPosition: c.staffPosition,
    notehead: c.notehead ?? "normal",
    drumKit: undefined,
    midiKey: c.midiNumber,
  })),
};

// The real Percussion part from `packages/format/fixtures/mnx/Rhapsody in Blue.mnx`, resolved
// the same way `resolveDrumKitTarget` reads a loaded score's `kit` +
// `global.sounds`. Eight kit-components, sorted top-of-staff first; the Tam-tam
// borrows the Big Gong from the Ethnic kit (drumKit 49). This is the realistic
// "edit an existing score's mapping" case, vs. the tidy Full Drum Kit preset.
const RHAPSODY_TARGET: DrumKitTarget = {
  partIndex: 0,
  partName: "Percussion",
  components: [
    { id: "P26-kit-18", name: "Open Triangle", staffPosition: 7, notehead: "normal", drumKit: undefined, midiKey: 81 },
    { id: "P26-kit-3", name: "Concert Cymbal", staffPosition: 7, notehead: "normal", drumKit: undefined, midiKey: 59 },
    { id: "P26-kit-1", name: "Concert Cymbal", staffPosition: 6, notehead: "x", drumKit: undefined, midiKey: 59 },
    { id: "P26-kit-5", name: "Concert Cymbal", staffPosition: 5, notehead: "normal", drumKit: undefined, midiKey: 59 },
    { id: "P26-kit-2", name: "Acoustic Snare", staffPosition: 3, notehead: "normal", drumKit: undefined, midiKey: 38 },
    { id: "P26-kit-4", name: "Side Stick", staffPosition: 3, notehead: "x", drumKit: undefined, midiKey: 37 },
    { id: "P26-kit-0", name: "Bass Drum 1", staffPosition: -1, notehead: "normal", drumKit: undefined, midiKey: 36 },
    { id: "P26-kit-19", name: "Tam-tam", staffPosition: -3, notehead: "normal", drumKit: 49, midiKey: 45 },
  ],
};

/**
 * Drum-kit mapping editor. Each row binds a notated identity (staff position +
 * notehead) to a concrete sound: a MIDI key on a General-MIDI drum kit from the
 * loaded SoundFont (Shan SGM Pro 15). Choosing a non-default kit borrows that
 * hit from another GS kit (e.g. the Tam-tam row pulls the Big Gong from the
 * Ethnic kit, program 49). The play button auditions the mapped sound.
 */
const meta: Meta<typeof DrumKitDialog> = {
  title: "App/Editing/Drum Kit Editor",
  component: DrumKitDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof DrumKitDialog>;

function Harness({ target }: { target: DrumKitTarget | null }) {
  const [open, setOpen] = useState(true);
  const [applied, setApplied] = useState<readonly KitComponentEdit[] | null>(null);
  return (
    <div style={PAGE_STYLE}>
      <button onClick={() => setOpen(true)} style={OPEN_BUTTON_STYLE}>
        Open Drum Kit Editor
      </button>
      <DrumKitDialog
        open={open}
        onClose={() => setOpen(false)}
        target={target}
        onApply={(edits) => {
          setApplied(edits);
          setOpen(false);
        }}
        onPreview={(midiKey, drumKit) =>
          // Storybook has no sampler; log the audition request instead.
          console.log(`audition key ${midiKey}${drumKit !== undefined ? ` on kit ${drumKit}` : ""}`)
        }
      />
      {applied ? <pre style={PRE_STYLE}>{JSON.stringify(applied, null, 2)}</pre> : null}
    </div>
  );
}

export const Default: Story = {
  render: () => <Harness target={SAMPLE_TARGET} />,
};

export const RhapsodyInBlue: Story = {
  render: () => <Harness target={RHAPSODY_TARGET} />,
};

export const NoPercussionPart: Story = {
  render: () => <Harness target={null} />,
};
