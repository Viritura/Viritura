import { describe, it, expect } from "vitest";
import { mixerReducer, initialMixerState, type MixerState, type MixerChannelState } from "../mixerStore";
import { MIXER_DEFAULT_GAIN, MIXER_MAX_GAIN } from "../mixerGain";

/** Helper: access channel by index with non-null assertion (test convenience). */
function ch(state: MixerState, index: number): MixerChannelState {
  const c = state.channels[index];
  if (!c) throw new Error(`No channel at index ${index}`);
  return c;
}

function stateWithChannels(count: number, overrides?: Partial<MixerChannelState>[]): MixerState {
  const base = initialMixerState();
  base.channels = Array.from({ length: count }, (_, i) => ({
    volume: 0.5,
    pan: 0,
    muted: false,
    solo: false,
    ensembleEnabled: true,
    spatialMode: "stage",
    ...(overrides?.[i] ?? {}),
  }));
  return base;
}

describe("mixerReducer", () => {
  describe("SYNC_PARTS", () => {
    it("creates channels for new parts", () => {
      const state = initialMixerState();
      const next = mixerReducer(state, { type: "SYNC_PARTS", partCount: 3 });
      expect(next.channels).toHaveLength(3);
      expect(ch(next, 0).volume).toBe(MIXER_DEFAULT_GAIN);
      expect(ch(next, 0).pan).toBe(0);
      expect(ch(next, 0).muted).toBe(false);
      expect(ch(next, 0).solo).toBe(false);
      expect(ch(next, 0).spatialMode).toBe("stage");
    });

    it("preserves existing channel state when adding parts", () => {
      const state = stateWithChannels(2, [{ volume: 0.5, pan: -0.3 }]);
      const next = mixerReducer(state, { type: "SYNC_PARTS", partCount: 4 });
      expect(next.channels).toHaveLength(4);
      expect(ch(next, 0).volume).toBe(0.5);
      expect(ch(next, 0).pan).toBe(-0.3);
      // New channels get defaults
      expect(ch(next, 2).volume).toBe(MIXER_DEFAULT_GAIN);
      expect(ch(next, 3).volume).toBe(MIXER_DEFAULT_GAIN);
    });

    it("trims channels when parts are removed", () => {
      const state = stateWithChannels(5);
      const next = mixerReducer(state, { type: "SYNC_PARTS", partCount: 2 });
      expect(next.channels).toHaveLength(2);
    });

    it("returns same state when part count is unchanged", () => {
      const state = stateWithChannels(3);
      const next = mixerReducer(state, { type: "SYNC_PARTS", partCount: 3 });
      expect(next).toBe(state);
    });
  });

  describe("SET_VOLUME", () => {
    it("sets volume for a specific channel", () => {
      const state = stateWithChannels(3);
      const next = mixerReducer(state, { type: "SET_VOLUME", partIndex: 1, volume: 0.5 });
      expect(ch(next, 1).volume).toBe(0.5);
      expect(ch(next, 0).volume).toBe(0.5); // unchanged
    });

    it("clamps volume to the +6 dB gain ceiling", () => {
      const state = stateWithChannels(2);
      const over = mixerReducer(state, { type: "SET_VOLUME", partIndex: 0, volume: 3 });
      expect(ch(over, 0).volume).toBe(MIXER_MAX_GAIN);

      const under = mixerReducer(state, { type: "SET_VOLUME", partIndex: 0, volume: -0.2 });
      expect(ch(under, 0).volume).toBe(0);
    });

    it("ignores out-of-range partIndex", () => {
      const state = stateWithChannels(2);
      const next = mixerReducer(state, { type: "SET_VOLUME", partIndex: 5, volume: 0.3 });
      expect(next.channels).toBe(state.channels);
    });
  });

  describe("SET_PAN", () => {
    it("sets pan for a specific channel", () => {
      const state = stateWithChannels(2);
      const next = mixerReducer(state, { type: "SET_PAN", partIndex: 0, pan: -0.7 });
      expect(ch(next, 0).pan).toBe(-0.7);
    });

    it("clamps pan to -1..1 range", () => {
      const state = stateWithChannels(2);
      const over = mixerReducer(state, { type: "SET_PAN", partIndex: 0, pan: 2 });
      expect(ch(over, 0).pan).toBe(1);

      const under = mixerReducer(state, { type: "SET_PAN", partIndex: 0, pan: -5 });
      expect(ch(under, 0).pan).toBe(-1);
    });
  });

  describe("TOGGLE_MUTE", () => {
    it("toggles mute on a channel", () => {
      const state = stateWithChannels(2);
      const muted = mixerReducer(state, { type: "TOGGLE_MUTE", partIndex: 0 });
      expect(ch(muted, 0).muted).toBe(true);

      const unmuted = mixerReducer(muted, { type: "TOGGLE_MUTE", partIndex: 0 });
      expect(ch(unmuted, 0).muted).toBe(false);
    });

    it("ignores invalid partIndex", () => {
      const state = stateWithChannels(1);
      const next = mixerReducer(state, { type: "TOGGLE_MUTE", partIndex: 3 });
      expect(next).toBe(state);
    });
  });

  describe("TOGGLE_SOLO", () => {
    it("toggles solo on a channel", () => {
      const state = stateWithChannels(3);
      const soloed = mixerReducer(state, { type: "TOGGLE_SOLO", partIndex: 1 });
      expect(ch(soloed, 1).solo).toBe(true);
      expect(ch(soloed, 0).solo).toBe(false);

      const unsoloed = mixerReducer(soloed, { type: "TOGGLE_SOLO", partIndex: 1 });
      expect(ch(unsoloed, 1).solo).toBe(false);
    });

    describe("TOGGLE_SPATIAL_MODE", () => {
      it("toggles a channel between Stage and Stereo", () => {
        const state = stateWithChannels(2);
        const stereo = mixerReducer(state, { type: "TOGGLE_SPATIAL_MODE", partIndex: 0 });
        expect(ch(stereo, 0).spatialMode).toBe("stereo");
        expect(ch(stereo, 1).spatialMode).toBe("stage");

        const stage = mixerReducer(stereo, { type: "TOGGLE_SPATIAL_MODE", partIndex: 0 });
        expect(ch(stage, 0).spatialMode).toBe("stage");
      });
    });

    it("allows multiple channels to be soloed", () => {
      const state = stateWithChannels(3);
      let next = mixerReducer(state, { type: "TOGGLE_SOLO", partIndex: 0 });
      next = mixerReducer(next, { type: "TOGGLE_SOLO", partIndex: 2 });
      expect(ch(next, 0).solo).toBe(true);
      expect(ch(next, 1).solo).toBe(false);
      expect(ch(next, 2).solo).toBe(true);
    });
  });

  describe("SET_MASTER_VOLUME", () => {
    it("sets master volume", () => {
      const state = initialMixerState();
      const next = mixerReducer(state, { type: "SET_MASTER_VOLUME", volume: 0.6 });
      expect(next.masterVolume).toBe(0.6);
    });

    it("clamps master volume", () => {
      const state = initialMixerState();
      expect(mixerReducer(state, { type: "SET_MASTER_VOLUME", volume: 5 }).masterVolume).toBe(MIXER_MAX_GAIN);
      expect(mixerReducer(state, { type: "SET_MASTER_VOLUME", volume: -1 }).masterVolume).toBe(0);
    });
  });

  describe("TOGGLE_MASTER_MUTE", () => {
    it("toggles master mute", () => {
      const state = initialMixerState();
      const muted = mixerReducer(state, { type: "TOGGLE_MASTER_MUTE" });
      expect(muted.masterMuted).toBe(true);

      const unmuted = mixerReducer(muted, { type: "TOGGLE_MASTER_MUTE" });
      expect(unmuted.masterMuted).toBe(false);
    });
  });

  describe("RESET", () => {
    it("resets all mixer state to defaults", () => {
      const state = stateWithChannels(3, [
        { volume: 0.2, muted: true },
        { volume: 0.5, solo: true },
      ]);
      state.masterVolume = 0.3;
      state.masterMuted = true;

      const next = mixerReducer(state, { type: "RESET" });
      expect(next.channels).toHaveLength(0);
      expect(next.masterVolume).toBe(1.0);
      expect(next.masterMuted).toBe(false);
      expect(next.groups).toEqual({});
      expect(next.partGroups).toEqual([]);
    });
  });

  describe("solo logic scenarios", () => {
    it("soloing one channel effectively mutes others", () => {
      const state = stateWithChannels(3);
      const soloed = mixerReducer(state, { type: "TOGGLE_SOLO", partIndex: 1 });

      // Channel 0: not soloed → should be silenced (by consumer logic)
      expect(ch(soloed, 0).solo).toBe(false);
      // Channel 1: soloed → should be audible
      expect(ch(soloed, 1).solo).toBe(true);
      // Channel 2: not soloed → should be silenced
      expect(ch(soloed, 2).solo).toBe(false);

      // Verify anySolo = true
      expect(soloed.channels.some((ch) => ch.solo)).toBe(true);
    });

    it("unsoloing all channels restores normal behavior", () => {
      let state = stateWithChannels(3);
      state = mixerReducer(state, { type: "TOGGLE_SOLO", partIndex: 0 });
      state = mixerReducer(state, { type: "TOGGLE_SOLO", partIndex: 0 }); // unsolo

      expect(state.channels.some((ch) => ch.solo)).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Group bus (DAW-style multiplicative groups)
  // ════════════════════════════════════════════════════════════

  describe("SYNC_GROUPS", () => {
    it("adds missing groups with unity-volume defaults", () => {
      const state = initialMixerState();
      const next = mixerReducer(state, {
        type: "SYNC_GROUPS",
        groupIds: ["Woodwinds", "Brass"],
        partGroups: ["Woodwinds", "Woodwinds", "Brass"],
      });
      expect(Object.keys(next.groups).sort()).toEqual(["Brass", "Woodwinds"]);
      expect(next.groups["Woodwinds"]).toEqual({ volume: 1, muted: false, solo: false });
      expect(next.groups["Brass"]).toEqual({ volume: 1, muted: false, solo: false });
      expect(next.partGroups).toEqual(["Woodwinds", "Woodwinds", "Brass"]);
    });

    it("preserves overlapping group values across resync", () => {
      let state = initialMixerState();
      state = mixerReducer(state, {
        type: "SYNC_GROUPS",
        groupIds: ["Woodwinds", "Brass"],
        partGroups: ["Woodwinds", "Brass"],
      });
      state = mixerReducer(state, { type: "SET_GROUP_VOLUME", groupId: "Woodwinds", volume: 0.4 });
      state = mixerReducer(state, { type: "TOGGLE_GROUP_MUTE", groupId: "Brass" });

      // Resync with Brass replaced by Strings; Woodwinds value preserved.
      const next = mixerReducer(state, {
        type: "SYNC_GROUPS",
        groupIds: ["Woodwinds", "Strings"],
        partGroups: ["Woodwinds", "Strings"],
      });
      expect(next.groups["Woodwinds"]).toEqual({ volume: 0.4, muted: false, solo: false });
      expect(next.groups["Strings"]).toEqual({ volume: 1, muted: false, solo: false });
      expect(next.groups["Brass"]).toBeUndefined();
    });

    it("returns same state when groups and partGroups are unchanged", () => {
      let state = initialMixerState();
      state = mixerReducer(state, {
        type: "SYNC_GROUPS",
        groupIds: ["A", "B"],
        partGroups: ["A", "B", "A"],
      });
      const next = mixerReducer(state, {
        type: "SYNC_GROUPS",
        groupIds: ["A", "B"],
        partGroups: ["A", "B", "A"],
      });
      expect(next).toBe(state);
    });

    it("is independent of SYNC_PARTS (channels untouched)", () => {
      let state = stateWithChannels(2);
      state = mixerReducer(state, {
        type: "SYNC_GROUPS",
        groupIds: ["X"],
        partGroups: ["X", "X"],
      });
      const beforeChannels = state.channels;
      const next = mixerReducer(state, { type: "SYNC_PARTS", partCount: 2 });
      expect(next.channels).toBe(beforeChannels);
      expect(next.groups).toBe(state.groups);
      expect(next.partGroups).toBe(state.partGroups);
    });
  });

  describe("SET_GROUP_VOLUME", () => {
    it("clamps group volume to the +6 dB gain ceiling", () => {
      let state = initialMixerState();
      state = mixerReducer(state, { type: "SYNC_GROUPS", groupIds: ["G"], partGroups: ["G"] });
      expect(mixerReducer(state, { type: "SET_GROUP_VOLUME", groupId: "G", volume: 3 }).groups["G"]?.volume).toBe(
        MIXER_MAX_GAIN,
      );
      expect(mixerReducer(state, { type: "SET_GROUP_VOLUME", groupId: "G", volume: -1 }).groups["G"]?.volume).toBe(0);
    });

    it("no-ops for unknown group id", () => {
      const state = initialMixerState();
      const next = mixerReducer(state, { type: "SET_GROUP_VOLUME", groupId: "none", volume: 0.5 });
      expect(next).toBe(state);
    });
  });

  describe("TOGGLE_GROUP_MUTE / TOGGLE_GROUP_SOLO", () => {
    it("toggles group mute", () => {
      let state = mixerReducer(initialMixerState(), {
        type: "SYNC_GROUPS",
        groupIds: ["G"],
        partGroups: ["G"],
      });
      state = mixerReducer(state, { type: "TOGGLE_GROUP_MUTE", groupId: "G" });
      expect(state.groups["G"]?.muted).toBe(true);
      state = mixerReducer(state, { type: "TOGGLE_GROUP_MUTE", groupId: "G" });
      expect(state.groups["G"]?.muted).toBe(false);
    });

    it("toggles group solo independently of channel solo", () => {
      let state = mixerReducer(initialMixerState(), {
        type: "SYNC_GROUPS",
        groupIds: ["G", "H"],
        partGroups: ["G", "H"],
      });
      state = mixerReducer(state, { type: "TOGGLE_GROUP_SOLO", groupId: "G" });
      expect(state.groups["G"]?.solo).toBe(true);
      expect(state.groups["H"]?.solo).toBe(false);
    });

    it("no-ops for unknown group id", () => {
      const state = initialMixerState();
      expect(mixerReducer(state, { type: "TOGGLE_GROUP_MUTE", groupId: "none" })).toBe(state);
      expect(mixerReducer(state, { type: "TOGGLE_GROUP_SOLO", groupId: "none" })).toBe(state);
    });
  });
});
