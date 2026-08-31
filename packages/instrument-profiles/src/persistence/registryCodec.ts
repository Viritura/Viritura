import type { OrchestraSection } from "@viritura/sound-profiles";
import type { PluginIdentity, ProfileSlot, SlotBinding, VstInstrumentProfile } from "../types";

/** Current on-disk schema version for `registry.json`. */
export const REGISTRY_SCHEMA_VERSION = 1 as const;

interface RegistryFile {
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly profiles: readonly VstInstrumentProfile[];
}

export interface ParsedRegistry {
  readonly profiles: readonly VstInstrumentProfile[];
  /** Human-readable notes about entries that were dropped or repaired. */
  readonly issues: readonly string[];
}

const VALID_SECTIONS: ReadonlySet<OrchestraSection> = new Set([
  "strings",
  "woodwinds",
  "brass",
  "percussion",
  "keys",
  "voices",
  "other",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coercePluginIdentity(value: unknown): PluginIdentity | undefined {
  if (!isObject(value)) return undefined;
  if (value.format !== "vst3") return undefined;
  if (typeof value.pluginId !== "string" || value.pluginId.length === 0) return undefined;
  const identity: PluginIdentity = {
    format: "vst3",
    pluginId: value.pluginId,
    ...(typeof value.vendor === "string" ? { vendor: value.vendor } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(typeof value.buildId === "string" ? { buildId: value.buildId } : {}),
  };
  return identity;
}

function coerceBaseChannel(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 15) return 0;
  return value;
}

function coerceBinding(value: unknown): SlotBinding {
  const raw = isObject(value) ? value : {};
  const binding: SlotBinding = {
    baseChannel: coerceBaseChannel(raw.baseChannel),
    ...(typeof raw.luaScriptPath === "string" ? { luaScriptPath: raw.luaScriptPath } : {}),
    ...(typeof raw.pluginPath === "string" ? { pluginPath: raw.pluginPath } : {}),
    ...(typeof raw.stateRef === "string" ? { stateRef: raw.stateRef } : {}),
    ...(coercePluginIdentity(raw.pluginIdentity) ? { pluginIdentity: coercePluginIdentity(raw.pluginIdentity) } : {}),
  };
  return binding;
}

function coerceSlot(value: unknown, issues: string[], profileId: string): ProfileSlot | null {
  if (!isObject(value)) {
    issues.push(`Profile "${profileId}": dropped a non-object slot.`);
    return null;
  }
  if (typeof value.slotId !== "string" || value.slotId.length === 0) {
    issues.push(`Profile "${profileId}": dropped a slot with no slotId.`);
    return null;
  }
  const section = value.section;
  if (typeof section !== "string" || !VALID_SECTIONS.has(section as OrchestraSection)) {
    issues.push(`Profile "${profileId}": dropped slot "${value.slotId}" with invalid section.`);
    return null;
  }
  const slot: ProfileSlot = {
    slotId: value.slotId,
    section: section as OrchestraSection,
    label: typeof value.label === "string" && value.label.length > 0 ? value.label : value.slotId,
    binding: coerceBinding(value.binding),
    ...(typeof value.catalogInstrumentId === "string" ? { catalogInstrumentId: value.catalogInstrumentId } : {}),
  };
  return slot;
}

function coerceProfile(value: unknown, issues: string[]): VstInstrumentProfile | null {
  if (!isObject(value)) {
    issues.push("Dropped a non-object profile entry.");
    return null;
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    issues.push("Dropped a profile with no id.");
    return null;
  }
  if (typeof value.displayName !== "string" || value.displayName.length === 0) {
    issues.push(`Dropped profile "${value.id}" with no displayName.`);
    return null;
  }
  const version =
    typeof value.version === "number" && Number.isInteger(value.version) && value.version >= 1 ? value.version : 1;
  const rawSlots = Array.isArray(value.slots) ? value.slots : [];
  const slots: ProfileSlot[] = [];
  const seen = new Set<string>();
  for (const rawSlot of rawSlots) {
    const slot = coerceSlot(rawSlot, issues, value.id);
    if (!slot) continue;
    if (seen.has(slot.slotId)) {
      issues.push(`Profile "${value.id}": dropped duplicate slot "${slot.slotId}".`);
      continue;
    }
    seen.add(slot.slotId);
    slots.push(slot);
  }
  return { id: value.id, version, displayName: value.displayName, slots };
}

/** Serialize the profile set into the atomic `registry.json` contents. */
export function serializeRegistry(profiles: readonly VstInstrumentProfile[]): string {
  const file: RegistryFile = { schemaVersion: REGISTRY_SCHEMA_VERSION, profiles };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Parse `registry.json`, tolerating (and reporting) malformed entries rather than
 * throwing. A corrupt file yields an empty profile set plus an issue, so a bad
 * write can never brick the whole Instrument Profiles feature.
 */
export function parseRegistry(text: string): ParsedRegistry {
  const issues: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { profiles: [], issues: ["registry.json is not valid JSON; ignoring it."] };
  }
  if (!isObject(parsed) || !Array.isArray(parsed.profiles)) {
    return { profiles: [], issues: ["registry.json has no profiles array; ignoring it."] };
  }
  const profiles: VstInstrumentProfile[] = [];
  const seen = new Set<string>();
  for (const rawProfile of parsed.profiles) {
    const profile = coerceProfile(rawProfile, issues);
    if (!profile) continue;
    if (seen.has(profile.id)) {
      issues.push(`Dropped duplicate profile "${profile.id}".`);
      continue;
    }
    seen.add(profile.id);
    profiles.push(profile);
  }
  return { profiles, issues };
}
