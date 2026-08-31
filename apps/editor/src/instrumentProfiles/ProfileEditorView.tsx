import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Badge, FormInput, IconButton, ListRow, SectionLabel } from "@viritura/ui";
import type { OrchestraSection } from "@viritura/instrument-profiles";
import { isSlotFullyConfigured, type ProfileSlot, type VstInstrumentProfile } from "@viritura/instrument-profiles";
import { PROFILE_EDITOR_SECTIONS, PROFILE_SECTION_LABELS, orderSlotsByScoreOrder } from "./profileSections";
import { addInstrumentProfileSlot, renameInstrumentProfile } from "./instrumentProfileStore";
import { AddInstrumentMenu } from "./AddInstrumentMenu";
import { SlotInspector } from "./SlotInspector";
import type { ProfileHostBridge } from "./profileHostBridge";
import styles from "./instrumentProfiles.module.css";

interface ProfileEditorViewProps {
  profile: VstInstrumentProfile;
  bridge: ProfileHostBridge;
  onBack: () => void;
}

function SectionGroup({
  profile,
  section,
  selectedSlotId,
  onSelectSlot,
}: {
  profile: VstInstrumentProfile;
  section: OrchestraSection;
  selectedSlotId: string | null;
  onSelectSlot: (slotId: string) => void;
}) {
  const slots = orderSlotsByScoreOrder(profile.slots.filter((slot) => slot.section === section));

  return (
    <div className={styles.sectionGroup}>
      <div className={styles.sectionGroupHeader}>
        <SectionLabel className={styles.sectionLabel} label={PROFILE_SECTION_LABELS[section] ?? section} />
        <AddInstrumentMenu
          section={section}
          slots={profile.slots}
          onAddSlot={(slot) => {
            addInstrumentProfileSlot(profile.id, slot);
            // Select what was just added so the inspector is already focused on
            // it — that is what lets a custom instrument be named inline rather
            // than through a prompt before it exists.
            onSelectSlot(slot.slotId);
          }}
        />
      </div>
      {slots.length === 0 ? (
        <div className={styles.emptySection}>No instruments yet.</div>
      ) : (
        <div className={styles.slotRows}>
          {slots.map((slot) => (
            <ListRow
              key={slot.slotId}
              density="compact"
              selected={slot.slotId === selectedSlotId}
              onClick={() => onSelectSlot(slot.slotId)}
              trailing={<SlotStatus slot={slot} />}
            >
              {slot.label}
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact readiness marker for a slot row — the detail lives in the inspector. */
function SlotStatus({ slot }: { slot: ProfileSlot }) {
  return isSlotFullyConfigured(slot.binding) ? (
    <Badge variant="success">Ready</Badge>
  ) : (
    <Badge variant="muted">Setup</Badge>
  );
}

/**
 * The profile editor, shown in place of the profile list inside the Settings
 * pane rather than in a dialog of its own — a settings dialog that opens
 * another dialog to edit one of its rows traps the user two layers deep.
 *
 * Laid out like the percussion editor: instruments on the left grouped by
 * orchestral section, the selected instrument's bindings on the right.
 */
export function ProfileEditorView({ profile, bridge, onBack }: ProfileEditorViewProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const selectedSlot = useMemo(
    () => profile.slots.find((slot) => slot.slotId === selectedSlotId) ?? null,
    [profile.slots, selectedSlotId],
  );

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <IconButton size="sm" tooltip="Back to profiles" aria-label="Back to profiles" onClick={onBack}>
          <ChevronLeft size={16} />
        </IconButton>
        <FormInput
          className={styles.editorName}
          value={profile.displayName}
          aria-label="Profile name"
          onChange={(event) => renameInstrumentProfile(profile.id, event.currentTarget.value)}
        />
      </div>

      <div className={styles.editorColumns}>
        <div className={styles.slotColumn}>
          {PROFILE_EDITOR_SECTIONS.map((section) => (
            <SectionGroup
              key={section}
              profile={profile}
              section={section}
              selectedSlotId={selectedSlotId}
              onSelectSlot={setSelectedSlotId}
            />
          ))}
        </div>
        <div className={styles.inspectorColumn}>
          <SlotInspector profileId={profile.id} slot={selectedSlot} bridge={bridge} />
        </div>
      </div>
    </div>
  );
}
