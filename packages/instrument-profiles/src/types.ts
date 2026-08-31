import type { OrchestraSection } from "@viritura/sound-profiles";

/**
 * A stable, profile-defined identifier for one playable slot. It doubles as the
 * score-visible `sourceId` a part selects in the Mixer, so it must never change
 * once a score has referenced it.
 */
export type SlotId = string;

/** Identity a plugin reports about itself, captured so opaque state is never
 * restored into an incompatible build. */
export interface PluginIdentity {
  readonly format: "vst3";
  /** VST3 class ID (the stable per-plugin identifier). */
  readonly pluginId: string;
  readonly vendor?: string;
  readonly version?: string;
  /** Opaque build/version stamp when the host can obtain one. */
  readonly buildId?: string;
}

/**
 * The three machine-local values a slot binds, plus the channel its Lua mapper
 * uses within its own dedicated instance. Every field except `baseChannel` is
 * optional so a partially-configured slot is representable (and simply not yet
 * playable — see {@link isSlotFullyConfigured}).
 */
export interface SlotBinding {
  /** Absolute local path to the `.lua` articulation mapper. */
  readonly luaScriptPath?: string;
  /** Absolute local path to the `.vst3` bundle/file. */
  readonly pluginPath?: string;
  /** Identity captured on first load; gates opaque-state restore. */
  readonly pluginIdentity?: PluginIdentity;
  /**
   * Content-addressed key into the local state store. This is a reference, never
   * the opaque state bytes themselves (bytes never enter the registry or MNX).
   */
  readonly stateRef?: string;
  /** 0–15 MIDI channel the slot's Lua uses within its own instance. Default 0. */
  readonly baseChannel: number;
}

/**
 * One playable slot = one dedicated VST instance. Slots are NOT keyed by catalog
 * instrument identity: "Violin 1" and "Violin 2" are distinct slots (typically
 * different plugins) even when both derive from the `violin` catalog entry.
 */
export interface ProfileSlot {
  /** Stable slot identity; also the score-visible source ID. */
  readonly slotId: SlotId;
  /** Seed for range/display defaults; omitted for fully custom slots. */
  readonly catalogInstrumentId?: string;
  /** Orchestral section this slot lists under in the editor. */
  readonly section: OrchestraSection;
  /** User-editable label, e.g. "Violin 1". */
  readonly label: string;
  readonly binding: SlotBinding;
}

/** A user-authored, machine-local VST instrument profile. */
export interface VstInstrumentProfile {
  /** "user-<uuid>"; stable, referenced by scores. */
  readonly id: string;
  /** Bumped when the slot set changes materially. */
  readonly version: number;
  readonly displayName: string;
  readonly slots: readonly ProfileSlot[];
}

/**
 * Why a slot is or is not currently playable. Drives the Mixer's availability
 * indicator and the explicit web/desktop fallback to VirituraSounds.
 */
export type SlotAvailabilityReason = "ok" | "web-unsupported" | "unconfigured" | "identity-mismatch";

export interface SlotAvailability {
  readonly available: boolean;
  readonly reason: SlotAvailabilityReason;
}

/** The runtime platform a profile is being resolved on. */
export type ProfilePlatform = "desktop" | "web";
