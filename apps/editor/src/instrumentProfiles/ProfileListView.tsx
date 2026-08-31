import { Copy, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, IconButton, Text } from "@viritura/ui";
import { isSlotFullyConfigured, type VstInstrumentProfile } from "@viritura/instrument-profiles";
import {
  createInstrumentProfile,
  deleteInstrumentProfile,
  duplicateInstrumentProfile,
  openProfileEditor,
} from "./instrumentProfileStore";
import styles from "./instrumentProfiles.module.css";

interface ProfileListViewProps {
  profiles: readonly VstInstrumentProfile[];
  desktop: boolean;
}

function readiness(profile: VstInstrumentProfile): string {
  const ready = profile.slots.filter((slot) => isSlotFullyConfigured(slot.binding)).length;
  if (profile.slots.length === 0) return "No instruments yet";
  return `${ready}/${profile.slots.length} instruments ready`;
}

function ProfileRow({ profile }: { profile: VstInstrumentProfile }) {
  return (
    <div className={styles.profileRow}>
      <div className={styles.profileInfo}>
        <span className={styles.profileName}>{profile.displayName}</span>
        <span className={styles.profileMeta}>{readiness(profile)}</span>
      </div>
      <span className={styles.profileActions}>
        <IconButton
          size="sm"
          tooltip="Edit instruments"
          aria-label={`Edit ${profile.displayName}`}
          onClick={() => openProfileEditor(profile.id)}
        >
          <Pencil size={14} />
        </IconButton>
        <IconButton
          size="sm"
          tooltip="Duplicate"
          aria-label={`Duplicate ${profile.displayName}`}
          onClick={() => duplicateInstrumentProfile(profile.id)}
        >
          <Copy size={14} />
        </IconButton>
        <IconButton
          size="sm"
          tooltip="Delete"
          aria-label={`Delete ${profile.displayName}`}
          onClick={() => deleteInstrumentProfile(profile.id)}
        >
          <Trash2 size={14} />
        </IconButton>
      </span>
    </div>
  );
}

/**
 * The profile list: the built-in VirituraSounds entry plus each user profile,
 * with per-profile readiness and edit / duplicate / delete actions.
 *
 * Actions are icon buttons rather than a row of text buttons so the row reads
 * as its name first — the same treatment the percussion editor gives its pieces.
 */
export function ProfileListView({ profiles, desktop }: ProfileListViewProps) {
  return (
    <div className={styles.profileList}>
      <div className={styles.profileRow}>
        <div className={styles.profileInfo}>
          <span className={styles.profileName}>
            VirituraSounds <Badge variant="muted">Built-in</Badge>
          </span>
          <span className={styles.profileMeta}>The default SoundFont instruments. Always available.</span>
        </div>
      </div>

      {profiles.map((profile) => (
        <ProfileRow key={profile.id} profile={profile} />
      ))}

      {profiles.length === 0 && (
        <Text variant="eyebrow" tone="muted">
          No custom profiles yet.
        </Text>
      )}

      {!desktop && (
        <div className={styles.explainer}>
          VST instrument profiles run in the desktop app. You can still create and edit profiles here; capturing plugin
          state and playing VST sources require the desktop build, and VST sources fall back to VirituraSounds
          elsewhere.
        </div>
      )}

      <div className={styles.listActions}>
        <Button label="New profile" onClick={() => createInstrumentProfile("New Profile")} />
      </div>
    </div>
  );
}
