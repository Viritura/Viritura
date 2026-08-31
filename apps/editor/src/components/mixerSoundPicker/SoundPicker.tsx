import { useCallback, useMemo } from "react";
import type { Part, Score } from "@viritura/core";
import { resolveSoundProfilePickerView } from "@viritura/playback";
import { CascadingMenu, type CascadingMenuItem } from "@viritura/ui";
import { useComposedSoundProfileRegistry } from "../../instrumentProfiles";
import type { PartSoundSourceChange } from "./soundAssignment";
import styles from "./SoundPicker.module.css";

interface SoundPickerProps {
  readonly part?: Part;
  readonly score?: Score | null;
  readonly partDisplayName: string;
  readonly onSoundSourceChange: (change: PartSoundSourceChange) => void;
}

function menuItemsFor(
  view: ReturnType<typeof resolveSoundProfilePickerView>,
  onSourceSelect: (sourceId: string, profileId: string, profileVersion: number) => void,
): CascadingMenuItem[] {
  return view.packs.map((pack) => ({
    id: pack.id,
    label: pack.label,
    children: [
      {
        id: `${pack.id}:notation-default`,
        label: pack.notationDefault.label,
        onSelect: () => onSourceSelect("", pack.profileId, pack.profileVersion),
      },
      ...pack.sections.map((section) => ({
        id: `${pack.id}:${section.id}`,
        label: section.label,
        children: section.options.map((option) => ({
          id: option.id,
          label: option.label,
          onSelect: () => onSourceSelect(option.id, pack.profileId, pack.profileVersion),
        })),
      })),
    ],
  }));
}

/** Select a persisted VirituraSounds source without changing the part's notation identity. */
export function SoundPicker({ part, score, partDisplayName, onSoundSourceChange }: SoundPickerProps) {
  const partId = part?.id;
  const registry = useComposedSoundProfileRegistry();
  const view = useMemo(
    () => resolveSoundProfilePickerView(part, partDisplayName, score?.soundProfile, registry),
    [part, partDisplayName, score?.soundProfile, registry],
  );
  const handleSoundChange = useCallback(
    (sourceId: string, profileId: string, profileVersion: number): void => {
      if (!partId) return;
      onSoundSourceChange({
        partId,
        sourceId: sourceId || undefined,
        profileId,
        profileVersion,
      });
    },
    [onSoundSourceChange, partId],
  );
  const menuItems = useMemo(() => menuItemsFor(view, handleSoundChange), [handleSoundChange, view]);

  return (
    <CascadingMenu
      ariaLabel={`Sound for ${partDisplayName}: ${view.selectedLabel}`}
      className={styles.button}
      label="Sound"
      items={menuItems}
      triggerFullWidth={false}
      triggerSize="sm"
    />
  );
}
