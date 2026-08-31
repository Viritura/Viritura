/**
 * Mixer store — per-part mixer state (volume, pan, mute, solo) + master.
 *
 * Module-level zustand store that owns the editor's mixer state (per-part
 * channels, group buses, master). Replaces the prior `MixerStateContext` +
 * `MixerDispatchContext` pair. The pure `mixerReducer` is kept exported so
 * unit tests can exercise state transitions without going through React.
 *
 * When the audio engine is connected, it reads from this store to apply
 * gain/pan/mute to each part's audio output.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { MIXER_DEFAULT_GAIN, MIXER_MAX_GAIN } from "./mixerGain";

// ═════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════

/** Per-channel mixer settings. */
export interface MixerChannelState {
  /** Linear gain (0 = silent, 1 = 0 dB unity, up to +6 dB). */
  volume: number;
  /** Stereo pan position (-1 = full left, 0 = center, 1 = full right). */
  pan: number;
  /** Whether this channel is muted. */
  muted: boolean;
  /** Whether this channel is soloed. When any channel is soloed, only soloed channels are audible. */
  solo: boolean;
  /** Whether the ensemble layer is enabled (only meaningful for SF2 string parts). */
  ensembleEnabled: boolean;
  /** Stage uses X/Y spatial depth; stereo keeps only left/right placement. */
  spatialMode: "stereo" | "stage";
}

/** Per-group bus settings (DAW-style group bus).
 *
 *  Group volume multiplies child channel volume at playback time
 *  (it does NOT overwrite per-channel volumes). Group mute/solo
 *  composes with channel and master mute/solo at the bridge layer:
 *    effectiveVolume = channel.volume * group.volume * master.volume
 *    effectivelyMuted = channel.muted || group.muted || masterMuted
 *                    || (anyChannelSolo && !channel.solo)
 *                    || (anyGroupSolo   && !group.solo)
 */
export interface MixerGroupState {
  /** Group bus linear gain (0 = silent, 1 = 0 dB unity, up to +6 dB). */
  volume: number;
  /** Group bus mute — silences all members at playback time. */
  muted: boolean;
  /** Group bus solo — if any group is soloed, only members of soloed groups play. */
  solo: boolean;
}

/** Overall mixer state. */
export interface MixerState {
  /** Per-part channel states, indexed by part index. */
  channels: MixerChannelState[];
  /** Per-group bus state, keyed by group id (family label). */
  groups: Record<string, MixerGroupState>;
  /** Group id per part index ("" if a part is ungrouped). */
  partGroups: string[];
  /** Master output linear gain (0 = silent, 1 = 0 dB unity, up to +6 dB). */
  masterVolume: number;
  /** Master mute. */
  masterMuted: boolean;
}

// ═════════════════════════════════════════════
// Actions
// ═════════════════════════════════════════════

export type MixerAction =
  | { type: "SET_VOLUME"; partIndex: number; volume: number }
  | { type: "SET_PAN"; partIndex: number; pan: number }
  | { type: "TOGGLE_MUTE"; partIndex: number }
  | { type: "TOGGLE_SOLO"; partIndex: number }
  | { type: "TOGGLE_ENSEMBLE"; partIndex: number }
  | { type: "TOGGLE_SPATIAL_MODE"; partIndex: number }
  | { type: "SET_GROUP_VOLUME"; groupId: string; volume: number }
  | { type: "TOGGLE_GROUP_MUTE"; groupId: string }
  | { type: "TOGGLE_GROUP_SOLO"; groupId: string }
  | { type: "SYNC_GROUPS"; groupIds: string[]; partGroups: string[] }
  | { type: "SET_MASTER_VOLUME"; volume: number }
  | { type: "TOGGLE_MASTER_MUTE" }
  | { type: "SYNC_PARTS"; partCount: number }
  | { type: "RESET" };

// ═════════════════════════════════════════════
// Defaults
// ═════════════════════════════════════════════

function defaultChannel(): MixerChannelState {
  return {
    volume: MIXER_DEFAULT_GAIN,
    pan: 0,
    muted: false,
    solo: false,
    ensembleEnabled: true,
    spatialMode: "stage",
  };
}

function defaultGroup(): MixerGroupState {
  // DAW convention: group fader at unity = no attenuation.
  return { volume: 1.0, muted: false, solo: false };
}

export function initialMixerState(): MixerState {
  return {
    channels: [],
    groups: {},
    partGroups: [],
    masterVolume: 1.0,
    masterMuted: false,
  };
}

// ═════════════════════════════════════════════
// Reducer (exported for testing)
// ═════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function updateChannel(
  channels: MixerChannelState[],
  index: number,
  patch: Partial<MixerChannelState>,
): MixerChannelState[] {
  if (index < 0 || index >= channels.length) return channels;
  const existing = channels[index]!;
  const updated = [...channels];
  updated[index] = {
    volume: patch.volume ?? existing.volume,
    pan: patch.pan ?? existing.pan,
    muted: patch.muted ?? existing.muted,
    solo: patch.solo ?? existing.solo,
    ensembleEnabled: patch.ensembleEnabled ?? existing.ensembleEnabled,
    spatialMode: patch.spatialMode ?? existing.spatialMode,
  };
  return updated;
}

function channelReducer(state: MixerState, action: MixerAction): MixerState | null {
  switch (action.type) {
    case "SET_VOLUME": {
      const volume = clamp(action.volume, 0, MIXER_MAX_GAIN);
      return { ...state, channels: updateChannel(state.channels, action.partIndex, { volume }) };
    }
    case "SET_PAN": {
      const pan = clamp(action.pan, -1, 1);
      return { ...state, channels: updateChannel(state.channels, action.partIndex, { pan }) };
    }
    case "TOGGLE_MUTE": {
      const ch = state.channels[action.partIndex];
      if (!ch) return state;
      return { ...state, channels: updateChannel(state.channels, action.partIndex, { muted: !ch.muted }) };
    }
    case "TOGGLE_SOLO": {
      const ch = state.channels[action.partIndex];
      if (!ch) return state;
      return { ...state, channels: updateChannel(state.channels, action.partIndex, { solo: !ch.solo }) };
    }
    case "TOGGLE_ENSEMBLE": {
      const ch = state.channels[action.partIndex];
      if (!ch) return state;
      return {
        ...state,
        channels: updateChannel(state.channels, action.partIndex, { ensembleEnabled: !ch.ensembleEnabled }),
      };
    }
    case "TOGGLE_SPATIAL_MODE": {
      const ch = state.channels[action.partIndex];
      if (!ch) return state;
      return {
        ...state,
        channels: updateChannel(state.channels, action.partIndex, {
          spatialMode: ch.spatialMode === "stage" ? "stereo" : "stage",
        }),
      };
    }
    default:
      return null;
  }
}

function groupReducer(state: MixerState, action: MixerAction): MixerState | null {
  switch (action.type) {
    case "SET_GROUP_VOLUME": {
      const existing = state.groups[action.groupId];
      if (!existing) return state;
      const volume = clamp(action.volume, 0, MIXER_MAX_GAIN);
      if (existing.volume === volume) return state;
      return {
        ...state,
        groups: { ...state.groups, [action.groupId]: { ...existing, volume } },
      };
    }
    case "TOGGLE_GROUP_MUTE": {
      const existing = state.groups[action.groupId];
      if (!existing) return state;
      return {
        ...state,
        groups: { ...state.groups, [action.groupId]: { ...existing, muted: !existing.muted } },
      };
    }
    case "TOGGLE_GROUP_SOLO": {
      const existing = state.groups[action.groupId];
      if (!existing) return state;
      return {
        ...state,
        groups: { ...state.groups, [action.groupId]: { ...existing, solo: !existing.solo } },
      };
    }
    default:
      return null;
  }
}

function syncReducer(state: MixerState, action: MixerAction): MixerState | null {
  switch (action.type) {
    case "SYNC_GROUPS": {
      const nextGroups: Record<string, MixerGroupState> = {};
      let changed = false;
      // Preserve overlapping group state; add defaults for new groups.
      for (const id of action.groupIds) {
        const existing = state.groups[id];
        nextGroups[id] = existing ?? defaultGroup();
        if (!existing) changed = true;
      }
      // Detect dropped groups.
      for (const id of Object.keys(state.groups)) {
        if (!(id in nextGroups)) {
          changed = true;
          break;
        }
      }
      // Compare partGroups arrays.
      const samePartGroups =
        state.partGroups.length === action.partGroups.length &&
        state.partGroups.every((v, i) => v === action.partGroups[i]);
      if (!changed && samePartGroups) return state;
      return { ...state, groups: nextGroups, partGroups: action.partGroups };
    }
    case "SYNC_PARTS": {
      const { partCount } = action;
      if (partCount === state.channels.length) return state;
      const channels: MixerChannelState[] = [];
      for (let i = 0; i < partCount; i++) {
        channels.push(state.channels[i] ?? defaultChannel());
      }
      return { ...state, channels };
    }
    case "SET_MASTER_VOLUME":
      return { ...state, masterVolume: clamp(action.volume, 0, MIXER_MAX_GAIN) };
    case "TOGGLE_MASTER_MUTE":
      return { ...state, masterMuted: !state.masterMuted };
    case "RESET":
      return initialMixerState();
    default:
      return null;
  }
}

export function mixerReducer(state: MixerState, action: MixerAction): MixerState {
  return channelReducer(state, action) ?? groupReducer(state, action) ?? syncReducer(state, action) ?? state;
}

// ═════════════════════════════════════════════
// Zustand store
// ═════════════════════════════════════════════

interface MixerStore extends MixerState {
  _dispatch: (action: MixerAction) => void;
}

function makeDispatch(set: (updater: (state: MixerStore) => MixerStore) => void) {
  return (action: MixerAction) =>
    set((s) => {
      const { _dispatch, ...current } = s;
      const next = mixerReducer(current, action);
      return next === current ? s : { ...next, _dispatch };
    });
}

const useMixerStore = create<MixerStore>()((set) => ({
  ...initialMixerState(),
  _dispatch: makeDispatch(set),
}));

/** Dispatch a mixer action from outside React (commands, bridges, tests). */
function dispatchMixer(action: MixerAction): void {
  useMixerStore.getState()._dispatch(action);
}

// ═════════════════════════════════════════════
// Action bag (stable identity, module-scoped)
// ═════════════════════════════════════════════

interface MixerActionsValue {
  setVolume: (partIndex: number, volume: number) => void;
  setPan: (partIndex: number, pan: number) => void;
  toggleMute: (partIndex: number) => void;
  toggleSolo: (partIndex: number) => void;
  toggleEnsemble: (partIndex: number) => void;
  toggleSpatialMode: (partIndex: number) => void;
  setMasterVolume: (volume: number) => void;
  toggleMasterMute: () => void;
  setGroupVolume: (groupId: string, volume: number) => void;
  toggleGroupMute: (groupId: string) => void;
  toggleGroupSolo: (groupId: string) => void;
  syncGroups: (groupIds: string[], partGroups: string[]) => void;
  reset: () => void;
}

const actions: MixerActionsValue = {
  setVolume: (partIndex, volume) => dispatchMixer({ type: "SET_VOLUME", partIndex, volume }),
  setPan: (partIndex, pan) => dispatchMixer({ type: "SET_PAN", partIndex, pan }),
  toggleMute: (partIndex) => dispatchMixer({ type: "TOGGLE_MUTE", partIndex }),
  toggleSolo: (partIndex) => dispatchMixer({ type: "TOGGLE_SOLO", partIndex }),
  toggleEnsemble: (partIndex) => dispatchMixer({ type: "TOGGLE_ENSEMBLE", partIndex }),
  toggleSpatialMode: (partIndex) => dispatchMixer({ type: "TOGGLE_SPATIAL_MODE", partIndex }),
  setMasterVolume: (volume) => dispatchMixer({ type: "SET_MASTER_VOLUME", volume }),
  toggleMasterMute: () => dispatchMixer({ type: "TOGGLE_MASTER_MUTE" }),
  setGroupVolume: (groupId, volume) => dispatchMixer({ type: "SET_GROUP_VOLUME", groupId, volume }),
  toggleGroupMute: (groupId) => dispatchMixer({ type: "TOGGLE_GROUP_MUTE", groupId }),
  toggleGroupSolo: (groupId) => dispatchMixer({ type: "TOGGLE_GROUP_SOLO", groupId }),
  syncGroups: (groupIds, partGroups) => dispatchMixer({ type: "SYNC_GROUPS", groupIds, partGroups }),
  reset: () => dispatchMixer({ type: "RESET" }),
};

// ═════════════════════════════════════════════
// Hooks
// ═════════════════════════════════════════════

/** Read-only access to mixer state. Re-renders on any mixer change. */
export function useMixer(): MixerState {
  const channels = useMixerStore((s) => s.channels);
  const groups = useMixerStore((s) => s.groups);
  const partGroups = useMixerStore((s) => s.partGroups);
  const masterVolume = useMixerStore((s) => s.masterVolume);
  const masterMuted = useMixerStore((s) => s.masterMuted);
  return { channels, groups, partGroups, masterVolume, masterMuted };
}

/** Mixer action creators. Identity is stable across renders. */
export function useMixerActions(): MixerActionsValue {
  return actions;
}

/**
 * Keeps the mixer channel count in sync with the current score's part count.
 * Mount this inside PlayView so SYNC_PARTS fires on partCount changes.
 */
export function useMixerPartSync(partCount: number): void {
  useEffect(() => {
    dispatchMixer({ type: "SYNC_PARTS", partCount });
  }, [partCount]);
}
