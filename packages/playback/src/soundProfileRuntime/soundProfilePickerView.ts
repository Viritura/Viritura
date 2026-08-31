import type { Part, SoundProfileAssignment } from "@viritura/core";
import {
  defaultSoundProfileRegistry,
  ORCHESTRA_SECTION_LABELS,
  ORCHESTRA_SECTION_ORDER,
  VIRITURA_SOUNDS_PROFILE_ID,
  VIRITURA_SOUNDS_SOURCE_OPTIONS,
  type OrchestraSection,
  type ResolvedPartSound,
  type SoundProfile,
  type SoundProfileRegistry,
  type SourceCatalogEntry,
} from "@viritura/sound-profiles";
import { partSoundProfileInput } from "./partSoundProfileInput";

export interface SoundProfilePickerOption {
  readonly id: string;
  readonly label: string;
}

export interface SoundProfilePickerSection {
  readonly id: OrchestraSection;
  readonly label: string;
  readonly options: readonly SoundProfilePickerOption[];
}

export interface SoundProfilePickerPack {
  readonly id: string;
  readonly label: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly notationDefault: SoundProfilePickerOption;
  readonly sections: readonly SoundProfilePickerSection[];
}

export interface SoundProfilePickerView {
  readonly profileId: string;
  readonly profileVersion: number;
  /** Empty means use the notation-derived profile default. */
  readonly selectedSourceId: string;
  /** Human-readable summary for the picker trigger. */
  readonly selectedLabel: string;
  /** Available sound packs, arranged for cascading menu presentation. */
  readonly packs: readonly SoundProfilePickerPack[];
  /** Flat legacy presentation retained for existing consumers. */
  readonly options: readonly SoundProfilePickerOption[];
}

function resolvedProfile(profile: SoundProfile, part: Part | undefined, partDisplayName: string): ResolvedPartSound {
  const resolved = profile.resolve(partSoundProfileInput(part, partDisplayName));
  if (!resolved) {
    throw new Error(`Built-in sound profile did not resolve "${partDisplayName}".`);
  }
  return resolved;
}

function notationDefaultOption(resolved: ResolvedPartSound, partDisplayName: string): SoundProfilePickerOption {
  const defaultSource = VIRITURA_SOUNDS_SOURCE_OPTIONS.find((option) => option.sourceId === resolved.selectedSourceId);
  return {
    id: "",
    label: `Notation default: ${defaultSource?.label ?? partDisplayName}`,
  };
}

function catalogSections(catalog: readonly SourceCatalogEntry[]): readonly SoundProfilePickerSection[] {
  return ORCHESTRA_SECTION_ORDER.map((section) => ({
    id: section,
    label: ORCHESTRA_SECTION_LABELS[section],
    options: catalog
      .filter((entry) => entry.section === section)
      .map((entry) => ({
        id: entry.sourceId,
        label: entry.configured === false ? `${entry.label} (needs setup)` : entry.label,
      })),
  })).filter((section) => section.options.length > 0);
}

/**
 * Adapts any registered profile that exposes a source catalog into a selectable
 * picker pack. VirituraSounds keeps its notation-derived default label; other
 * profiles (user VST profiles) reset to the notation default, which falls back
 * to VirituraSounds for that part.
 */
function pickerPackFor(
  profile: SoundProfile,
  resolved: ResolvedPartSound,
  partDisplayName: string,
): SoundProfilePickerPack | undefined {
  const catalog = profile.sourceCatalog?.();
  if (!catalog || catalog.length === 0) return undefined;
  const notationDefault =
    profile.id === VIRITURA_SOUNDS_PROFILE_ID
      ? notationDefaultOption(resolved, partDisplayName)
      : { id: "", label: "Notation default (VirituraSounds)" };
  return {
    id: profile.id,
    label: profile.displayName,
    profileId: profile.id,
    profileVersion: profile.version,
    notationDefault,
    sections: catalogSections(catalog),
  };
}

function selectedSourceLabel(profile: SoundProfile, selectedSourceId: string): string | undefined {
  return profile.sourceCatalog?.().find((entry) => entry.sourceId === selectedSourceId)?.label;
}

/**
 * Creates the selectable source presentation for a part across all registered
 * profiles. The empty option resets a part to its notation-derived VirituraSounds
 * default. Pass a registry composed with the user's VST instrument profiles to
 * make those profiles selectable in the Mixer.
 */
export function resolveSoundProfilePickerView(
  part: Part | undefined,
  partDisplayName: string,
  soundProfile?: SoundProfileAssignment,
  registry: SoundProfileRegistry = defaultSoundProfileRegistry,
): SoundProfilePickerView {
  const virituraSounds =
    registry.get(VIRITURA_SOUNDS_PROFILE_ID) ?? defaultSoundProfileRegistry.get(VIRITURA_SOUNDS_PROFILE_ID);
  if (!virituraSounds) throw new Error(`Built-in sound profile "${VIRITURA_SOUNDS_PROFILE_ID}" is unavailable.`);

  const override = part?.id ? soundProfile?.parts[part.id] : undefined;
  const selectedSourceId = override?.sourceId;
  const resolved = resolvedProfile(virituraSounds, part, partDisplayName);
  const notationDefault = notationDefaultOption(resolved, partDisplayName);

  // Prefer the part's own override profile (per-part profiles), falling back to
  // the assignment-level profile for scores authored before per-part profiles.
  const overrideProfileId = override?.profileId ?? soundProfile?.profileId;
  const assignedProfile = overrideProfileId ? registry.get(overrideProfileId) : undefined;
  const selectedLabel =
    assignedProfile && selectedSourceId
      ? `${assignedProfile.displayName} — ${selectedSourceLabel(assignedProfile, selectedSourceId) ?? selectedSourceId}`
      : `${virituraSounds.displayName} — ${notationDefault.label}`;

  const packs = registry.list().flatMap((profile) => {
    const pack = pickerPackFor(profile, resolved, partDisplayName);
    return pack ? [pack] : [];
  });

  return {
    profileId: assignedProfile?.id ?? resolved.profileId,
    profileVersion: assignedProfile?.version ?? resolved.profileVersion,
    selectedSourceId: selectedSourceId ?? "",
    selectedLabel,
    packs,
    options: [
      {
        id: "",
        label: `${virituraSounds.displayName} — Notation default: ${
          VIRITURA_SOUNDS_SOURCE_OPTIONS.find((option) => option.sourceId === resolved.selectedSourceId)?.label ??
          resolved.selectedSourceId
        } (${resolved.selectedSourceId})`,
      },
      ...VIRITURA_SOUNDS_SOURCE_OPTIONS.map((option) => ({
        id: option.sourceId,
        label: `${virituraSounds.displayName} — ${capitalize(option.section)}: ${option.label} (${option.sourceId})`,
      })),
    ],
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
