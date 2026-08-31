import { describe, it, expect } from "vitest";
import {
  noteInputReducer,
  initialNoteInputState,
  type NoteInputState,
  type NoteInputAction,
} from "../store/noteInputStore";
import {
  DURATION_KEY_MAP,
  durationFromKey,
  toggleNoteInputAction,
  setDurationAction,
  setAccidentalAction,
  toggleRestAction,
  toggleDotAction,
  setVoiceAction,
  setGraceTypeAction,
  resetAction,
} from "../commands/noteInputCommands";

function reduce(state: NoteInputState, ...actions: NoteInputAction[]): NoteInputState {
  return actions.reduce(noteInputReducer, state);
}

describe("noteInputReducer", () => {
  it("starts with note input inactive", () => {
    expect(initialNoteInputState.active).toBe(false);
    expect(initialNoteInputState.currentDuration).toBe("quarter");
    expect(initialNoteInputState.currentAccidental).toBe(null);
    expect(initialNoteInputState.isRest).toBe(false);
    expect(initialNoteInputState.dotCount).toBe(0);
    expect(initialNoteInputState.currentVoice).toBe(1);
    expect(initialNoteInputState.currentGraceType).toBe(null);
  });

  describe("TOGGLE_NOTE_INPUT", () => {
    it("activates note input mode", () => {
      const state = reduce(initialNoteInputState, { type: "TOGGLE_NOTE_INPUT" });
      expect(state.active).toBe(true);
    });

    it("deactivates note input mode", () => {
      const active = { ...initialNoteInputState, active: true };
      const state = reduce(active, { type: "TOGGLE_NOTE_INPUT" });
      expect(state.active).toBe(false);
    });

    it("resets rest and grace type when deactivating", () => {
      const active: NoteInputState = {
        ...initialNoteInputState,
        active: true,
        isRest: true,
        currentGraceType: "grace",
      };
      const state = reduce(active, { type: "TOGGLE_NOTE_INPUT" });
      expect(state.active).toBe(false);
      expect(state.isRest).toBe(false);
      expect(state.currentGraceType).toBe(null);
    });

    it("preserves duration and voice when toggling", () => {
      const active: NoteInputState = {
        ...initialNoteInputState,
        active: true,
        currentDuration: "half",
        currentVoice: 3,
      };
      const state = reduce(active, { type: "TOGGLE_NOTE_INPUT" });
      expect(state.currentDuration).toBe("half");
      expect(state.currentVoice).toBe(3);
    });
  });

  describe("SET_DURATION", () => {
    it("sets the current duration", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_DURATION",
        duration: "whole",
      });
      expect(state.currentDuration).toBe("whole");
    });

    it("changes from one duration to another", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_DURATION",
        duration: "eighth",
      });
      expect(state.currentDuration).toBe("eighth");

      const state2 = reduce(state, {
        type: "SET_DURATION",
        duration: "16th",
      });
      expect(state2.currentDuration).toBe("16th");
    });
  });

  describe("SET_ACCIDENTAL", () => {
    it("sets an accidental", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_ACCIDENTAL",
        accidental: "sharp",
      });
      expect(state.currentAccidental).toBe("sharp");
    });

    it("toggles off when same accidental is set again", () => {
      const withSharp = reduce(initialNoteInputState, {
        type: "SET_ACCIDENTAL",
        accidental: "sharp",
      });
      const state = reduce(withSharp, {
        type: "SET_ACCIDENTAL",
        accidental: "sharp",
      });
      expect(state.currentAccidental).toBe(null);
    });

    it("switches accidentals", () => {
      const withSharp = reduce(initialNoteInputState, {
        type: "SET_ACCIDENTAL",
        accidental: "sharp",
      });
      const state = reduce(withSharp, {
        type: "SET_ACCIDENTAL",
        accidental: "flat",
      });
      expect(state.currentAccidental).toBe("flat");
    });

    it("clears accidental when set to null", () => {
      const withSharp = reduce(initialNoteInputState, {
        type: "SET_ACCIDENTAL",
        accidental: "sharp",
      });
      const state = reduce(withSharp, {
        type: "SET_ACCIDENTAL",
        accidental: null,
      });
      expect(state.currentAccidental).toBe(null);
    });
  });

  describe("TOGGLE_REST", () => {
    it("toggles rest mode on", () => {
      const state = reduce(initialNoteInputState, { type: "TOGGLE_REST" });
      expect(state.isRest).toBe(true);
    });

    it("toggles rest mode off", () => {
      const withRest = { ...initialNoteInputState, isRest: true };
      const state = reduce(withRest, { type: "TOGGLE_REST" });
      expect(state.isRest).toBe(false);
    });
  });

  describe("TOGGLE_DOT", () => {
    it("toggles between 0 and 1 dot", () => {
      let state = reduce(initialNoteInputState, { type: "TOGGLE_DOT" });
      expect(state.dotCount).toBe(1);

      state = reduce(state, { type: "TOGGLE_DOT" });
      expect(state.dotCount).toBe(0);

      state = reduce(state, { type: "TOGGLE_DOT" });
      expect(state.dotCount).toBe(1);
    });

    it("toggles back to 0 from any non-zero count", () => {
      const state = reduce(
        { ...initialNoteInputState, dotCount: 3 },
        {
          type: "TOGGLE_DOT",
        },
      );
      expect(state.dotCount).toBe(0);
    });
  });

  describe("INCREMENT_DOT", () => {
    it("cycles dot count: 0 \u2192 1 \u2192 2 \u2192 3 \u2192 4 \u2192 0", () => {
      let state = reduce(initialNoteInputState, { type: "INCREMENT_DOT" });
      expect(state.dotCount).toBe(1);

      state = reduce(state, { type: "INCREMENT_DOT" });
      expect(state.dotCount).toBe(2);

      state = reduce(state, { type: "INCREMENT_DOT" });
      expect(state.dotCount).toBe(3);

      state = reduce(state, { type: "INCREMENT_DOT" });
      expect(state.dotCount).toBe(4);

      state = reduce(state, { type: "INCREMENT_DOT" });
      expect(state.dotCount).toBe(0);
    });
  });

  describe("SET_VOICE", () => {
    it("sets the current voice", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_VOICE",
        voice: 2,
      });
      expect(state.currentVoice).toBe(2);
    });

    it("supports all four voices", () => {
      for (const voice of [1, 2, 3, 4] as const) {
        const state = reduce(initialNoteInputState, {
          type: "SET_VOICE",
          voice,
        });
        expect(state.currentVoice).toBe(voice);
      }
    });
  });

  describe("SET_GRACE_TYPE", () => {
    it("sets a grace type", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_GRACE_TYPE",
        graceType: "grace",
      });
      expect(state.currentGraceType).toBe("grace");
    });

    it("records the picked type as the selected (picker memory) value", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_GRACE_TYPE",
        graceType: "appoggiatura",
      });
      expect(state.currentGraceType).toBe("appoggiatura");
      expect(state.selectedGraceType).toBe("appoggiatura");
    });

    it("TOGGLE_GRACE_ACTIVE flips current on/off and restores the selected type", () => {
      let state = reduce(initialNoteInputState, {
        type: "SET_GRACE_TYPE",
        graceType: "appoggiatura",
      });
      state = reduce(state, { type: "TOGGLE_GRACE_ACTIVE" });
      expect(state.currentGraceType).toBeNull();
      expect(state.selectedGraceType).toBe("appoggiatura");

      state = reduce(state, { type: "TOGGLE_GRACE_ACTIVE" });
      expect(state.currentGraceType).toBe("appoggiatura");
    });

    it("switches grace types", () => {
      const withGrace = reduce(initialNoteInputState, {
        type: "SET_GRACE_TYPE",
        graceType: "grace",
      });
      const state = reduce(withGrace, {
        type: "SET_GRACE_TYPE",
        graceType: "appoggiatura",
      });
      expect(state.currentGraceType).toBe("appoggiatura");
    });
  });

  describe("RESET", () => {
    it("resets all state to initial values", () => {
      const modified: NoteInputState = {
        active: true,
        currentDuration: "whole",
        currentAccidental: "sharp",
        isRest: true,
        dotCount: 2,
        currentVoice: 3,
        currentGraceType: "grace",
        tieActive: true,
        slurActive: true,
        slurStartEventId: "ev-123",
      };
      const state = reduce(modified, { type: "RESET" });
      expect(state).toEqual(initialNoteInputState);
    });
  });

  describe("TOGGLE_SLUR", () => {
    it("toggles slur mode on", () => {
      const state = reduce(initialNoteInputState, { type: "TOGGLE_SLUR" });
      expect(state.slurActive).toBe(true);
    });

    it("toggles slur mode off and clears slur start", () => {
      const withSlur: NoteInputState = {
        ...initialNoteInputState,
        slurActive: true,
        slurStartEventId: "ev-123",
      };
      const state = reduce(withSlur, { type: "TOGGLE_SLUR" });
      expect(state.slurActive).toBe(false);
      expect(state.slurStartEventId).toBe(null);
    });
  });

  describe("SET_SLUR_START", () => {
    it("sets the slur start event ID", () => {
      const state = reduce(initialNoteInputState, {
        type: "SET_SLUR_START",
        eventId: "ev-abc",
      });
      expect(state.slurStartEventId).toBe("ev-abc");
    });
  });

  describe("CLEAR_SLUR_START", () => {
    it("clears the slur start event ID", () => {
      const withStart: NoteInputState = {
        ...initialNoteInputState,
        slurStartEventId: "ev-abc",
      };
      const state = reduce(withStart, { type: "CLEAR_SLUR_START" });
      expect(state.slurStartEventId).toBe(null);
    });
  });

  describe("TOGGLE_NOTE_INPUT with slur state", () => {
    it("clears slur start when deactivating note input", () => {
      const active: NoteInputState = {
        ...initialNoteInputState,
        active: true,
        slurActive: true,
        slurStartEventId: "ev-123",
      };
      const state = reduce(active, { type: "TOGGLE_NOTE_INPUT" });
      expect(state.active).toBe(false);
      expect(state.slurStartEventId).toBe(null);
    });
  });

  describe("unknown action", () => {
    it("returns state unchanged for unknown action", () => {
      const state = noteInputReducer(
        initialNoteInputState,
        // @ts-expect-error testing unknown action
        { type: "UNKNOWN" },
      );
      expect(state).toBe(initialNoteInputState);
    });
  });
});

describe("noteInputCommands", () => {
  describe("DURATION_KEY_MAP", () => {
    it("maps number keys 1-9 to the durations shown by the toolbar", () => {
      expect(DURATION_KEY_MAP["1"]).toBe("64th");
      expect(DURATION_KEY_MAP["2"]).toBe("32nd");
      expect(DURATION_KEY_MAP["3"]).toBe("16th");
      expect(DURATION_KEY_MAP["4"]).toBe("eighth");
      expect(DURATION_KEY_MAP["5"]).toBe("quarter");
      expect(DURATION_KEY_MAP["6"]).toBe("half");
      expect(DURATION_KEY_MAP["7"]).toBe("whole");
      expect(DURATION_KEY_MAP["8"]).toBe("breve");
      expect(DURATION_KEY_MAP["9"]).toBe("maxima");
    });
  });

  describe("durationFromKey", () => {
    it("returns SET_DURATION action for valid key", () => {
      const action = durationFromKey("4");
      expect(action).toEqual({ type: "SET_DURATION", duration: "eighth" });
    });

    it("returns null for invalid key", () => {
      expect(durationFromKey("0")).toBe(null);
      expect(durationFromKey("a")).toBe(null);
      expect(durationFromKey("")).toBe(null);
    });
  });

  describe("action creators", () => {
    it("toggleNoteInputAction", () => {
      expect(toggleNoteInputAction()).toEqual({ type: "TOGGLE_NOTE_INPUT" });
    });

    it("setDurationAction", () => {
      expect(setDurationAction("half")).toEqual({
        type: "SET_DURATION",
        duration: "half",
      });
    });

    it("setAccidentalAction", () => {
      expect(setAccidentalAction("flat")).toEqual({
        type: "SET_ACCIDENTAL",
        accidental: "flat",
      });
    });

    it("toggleRestAction", () => {
      expect(toggleRestAction()).toEqual({ type: "TOGGLE_REST" });
    });

    it("toggleDotAction", () => {
      expect(toggleDotAction()).toEqual({ type: "TOGGLE_DOT" });
    });

    it("setVoiceAction", () => {
      expect(setVoiceAction(2)).toEqual({ type: "SET_VOICE", voice: 2 });
    });

    it("setGraceTypeAction", () => {
      expect(setGraceTypeAction("appoggiatura")).toEqual({
        type: "SET_GRACE_TYPE",
        graceType: "appoggiatura",
      });
    });

    it("resetAction", () => {
      expect(resetAction()).toEqual({ type: "RESET" });
    });
  });

  describe("compound state transitions", () => {
    it("typical note input workflow: activate → set duration → set accidental → enter rest", () => {
      let state = initialNoteInputState;
      state = noteInputReducer(state, toggleNoteInputAction());
      expect(state.active).toBe(true);

      state = noteInputReducer(state, setDurationAction("half"));
      expect(state.currentDuration).toBe("half");

      state = noteInputReducer(state, setAccidentalAction("sharp"));
      expect(state.currentAccidental).toBe("sharp");

      state = noteInputReducer(state, toggleRestAction());
      expect(state.isRest).toBe(true);

      // Deactivate resets rest
      state = noteInputReducer(state, toggleNoteInputAction());
      expect(state.active).toBe(false);
      expect(state.isRest).toBe(false);
      // But duration persists
      expect(state.currentDuration).toBe("half");
    });

    it("voice switching preserves other state", () => {
      const state = reduce(
        initialNoteInputState,
        toggleNoteInputAction(),
        setDurationAction("eighth"),
        toggleDotAction(),
        setVoiceAction(2),
      );
      expect(state.active).toBe(true);
      expect(state.currentDuration).toBe("eighth");
      expect(state.dotCount).toBe(1);
      expect(state.currentVoice).toBe(2);
    });

    it("keyboard duration entry via durationFromKey", () => {
      let state = reduce(initialNoteInputState, toggleNoteInputAction());
      for (let key = 1; key <= 6; key++) {
        const action = durationFromKey(String(key));
        expect(action).not.toBe(null);
        state = noteInputReducer(state, action!);
      }
      expect(state.currentDuration).toBe("half"); // key 6 = half
    });
  });
});
