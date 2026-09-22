// @vitest-environment happy-dom
import { StrictMode } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHORDS_PART_ID, type ChordSymbol, type GlobalMeasure, type Score } from "@viritura/core";
import { MixerSyncBridge } from "../components/MixerSyncBridge";
import { MIXER_DEFAULT_GAIN } from "../store/mixerGain";
import { useMixer, useMixerActions, useMixerPartSync } from "../store/mixerStore";

const boundary = vi.hoisted(() => ({
  playback: {
    applyMix: vi.fn<(index: number, volume: number, pan: number, muted: boolean, stage: boolean) => void>(),
    setEnsembleLayer: vi.fn<(index: number, enabled: boolean) => void>(),
    setVstMutedParts: vi.fn<(parts: Set<number>) => void>(),
    stop: vi.fn(),
  },
  document: { getState: vi.fn() },
  revert: vi.fn(),
}));

vi.mock("@viritura/playback", () => ({
  usePlaybackActions: () => boundary.playback,
  usePlaybackState: () => ({ status: "stopped" }),
}));
vi.mock("../store/DocumentContext", () => ({
  useDocumentStoreApi: () => boundary.document,
}));
vi.mock("../instrumentProfiles", () => ({
  useAudioRenderModeStore: (selector: (state: { mode: "web" }) => unknown) => selector({ mode: "web" }),
}));
vi.mock("../components/mixerSoundPicker", () => ({
  revertVstAssignmentsToNotationDefault: boundary.revert,
}));

function chord(rawText = "C"): ChordSymbol {
  return { position: { fraction: [0, 1] }, rawText };
}

function scoreWith(measures: GlobalMeasure[] = [{ chordSymbols: [chord()] }], count = 2): Score {
  return {
    mnx: { version: 1 },
    global: { measures },
    parts: Array.from({ length: count }, (_, index) => ({
      id: `real-part-${index}`,
      name: index === 0 ? "Flute" : "Violin",
      measures: measures.map(() => ({ sequences: [] })),
    })),
  };
}

function freezeScore(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeScore(child);
  Object.freeze(value);
}

function observeMixer() {
  return renderHook(() => ({ mixer: useMixer(), actions: useMixerActions() })).result;
}

function lastMix(index: number) {
  const call = boundary.playback.applyMix.mock.calls.filter(([partIndex]) => partIndex === index).at(-1);
  expect(call, `applyMix for runtime channel ${index}`).toBeDefined();
  return call!;
}

function expectMuted(...muted: boolean[]) {
  muted.forEach((value, index) => expect(lastMix(index)[3]).toBe(value));
  expect(boundary.playback.setVstMutedParts).toHaveBeenLastCalledWith(
    new Set(muted.flatMap((value, index) => (value ? [index] : []))),
  );
}

beforeEach(() => {
  const { result, unmount } = renderHook(useMixerActions);
  act(() => result.current.reset());
  unmount();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MixerSyncBridge derived Chords integration", () => {
  it.each([
    { name: "no measures", measures: [], visible: false },
    { name: "absent chord symbols", measures: [{}], visible: false },
    { name: "empty chord symbols", measures: [{ chordSymbols: [] }], visible: false },
    { name: "global chord after empty measures", measures: [{}, { chordSymbols: [chord()] }], visible: true },
    { name: "global NC only", measures: [{ chordSymbols: [chord("NC")] }], visible: true },
    { name: "global unsupported only", measures: [{ chordSymbols: [chord("H7")] }], visible: true },
  ] satisfies { name: string; measures: GlobalMeasure[]; visible: boolean }[])(
    "uses authored presence for $name without adding a score Part",
    ({ measures, visible }) => {
      const score = scoreWith(measures);
      const original = structuredClone(score);
      const originalParts = score.parts;
      freezeScore(score);
      const state = observeMixer();
      render(<MixerSyncBridge score={score} />);

      expect(state.current.mixer.channels).toHaveLength(visible ? 3 : 2);
      expect(boundary.playback.applyMix.mock.calls.some(([index]) => index === 2)).toBe(visible);
      expect(score).toEqual(original);
      expect(score.parts).toBe(originalParts);
      expect(score.parts.some((part) => part.id === CHORDS_PART_ID)).toBe(false);
      expect(CHORDS_PART_ID).toBe("viritura:derived:chords");
      expect(boundary.document.getState).not.toHaveBeenCalled();
      expect(boundary.revert).not.toHaveBeenCalled();
      expect(boundary.playback.stop).not.toHaveBeenCalled();
    },
  );

  it("handles absent scores, including unloading a score with soloed Chords", () => {
    const state = observeMixer();
    const view = render(<MixerSyncBridge />);
    expect(state.current.mixer.channels).toHaveLength(0);
    expect(boundary.playback.applyMix).not.toHaveBeenCalled();

    view.rerender(<MixerSyncBridge score={scoreWith()} />);
    expect(state.current.mixer.channels).toHaveLength(3);
    act(() => state.current.actions.toggleSolo(2));
    expectMuted(true, true, false);
    view.rerender(<MixerSyncBridge score={null} />);
    expect(state.current.mixer.channels).toHaveLength(0);
    expect(boundary.playback.setVstMutedParts).toHaveBeenLastCalledWith(new Set());
  });

  it("moves Chords with the real part count without copying derived settings into real channels", () => {
    const score = scoreWith();
    const state = observeMixer();
    const view = render(<MixerSyncBridge score={score} />);
    act(() => {
      state.current.actions.setVolume(0, 0.7);
      state.current.actions.setPan(1, 0.2);
      state.current.actions.setVolume(2, 0.3);
      state.current.actions.setPan(2, -0.6);
      state.current.actions.toggleMute(2);
      state.current.actions.toggleEnsemble(2);
      state.current.actions.toggleSpatialMode(2);
    });
    const realChannels = state.current.mixer.channels.slice(0, 2);
    const derived = state.current.mixer.channels[2];
    expect(derived).toBeDefined();
    const grown = { ...score, parts: [...score.parts, scoreWith(undefined, 3).parts[2]!] };
    view.rerender(<MixerSyncBridge score={grown} />);

    expect(state.current.mixer.channels).toHaveLength(4);
    expect(state.current.mixer.channels.slice(0, 2)).toEqual(realChannels);
    expect(state.current.mixer.channels[2]).toMatchObject({
      volume: MIXER_DEFAULT_GAIN,
      pan: 0,
      muted: false,
      solo: false,
      ensembleEnabled: true,
      spatialMode: "stage",
    });
    expect(state.current.mixer.channels[3]).toEqual(derived);
    expect(lastMix(3)).toEqual([3, 0.3, -0.6, true, false]);
    expect(boundary.playback.setEnsembleLayer).toHaveBeenLastCalledWith(3, false);

    view.rerender(<MixerSyncBridge score={{ ...score, parts: score.parts.slice(0, 1) }} />);
    expect(state.current.mixer.channels).toHaveLength(2);
    expect(state.current.mixer.channels[0]).toEqual(realChannels[0]);
    expect(state.current.mixer.channels[1]).toEqual(derived);
    expect(lastMix(1)).toEqual([1, 0.3, -0.6, true, false]);
    expect(boundary.playback.setVstMutedParts).toHaveBeenLastCalledWith(new Set([1]));
  });

  it("caches hidden Chords across count changes without its solo silencing real parts", () => {
    const score = scoreWith();
    const state = observeMixer();
    const view = render(<MixerSyncBridge score={score} />);
    act(() => {
      state.current.actions.setVolume(2, 0.27);
      state.current.actions.setPan(2, 0.4);
      state.current.actions.toggleSolo(2);
      state.current.actions.toggleEnsemble(2);
      state.current.actions.toggleSpatialMode(2);
    });
    const derived = state.current.mixer.channels[2];
    expect(derived).toBeDefined();
    expectMuted(true, true, false);

    boundary.playback.applyMix.mockClear();
    view.rerender(<MixerSyncBridge score={{ ...score, global: { measures: [{}] } }} />);
    expect(state.current.mixer.channels).toHaveLength(2);
    expectMuted(false, false);
    expect(boundary.playback.applyMix.mock.calls.every(([index]) => index < 2)).toBe(true);

    const grown = scoreWith([{}], 3);
    view.rerender(<MixerSyncBridge score={grown} />);
    expect(state.current.mixer.channels[2]).toMatchObject({ volume: MIXER_DEFAULT_GAIN, solo: false, pan: 0 });
    expectMuted(false, false, false);
    const realChannels = state.current.mixer.channels.slice();

    view.rerender(<MixerSyncBridge score={{ ...grown, global: score.global }} />);
    expect(state.current.mixer.channels).toHaveLength(4);
    expect(state.current.mixer.channels.slice(0, 3)).toEqual(realChannels);
    expect(state.current.mixer.channels[3]).toEqual(derived);
    expect(lastMix(3)).toEqual([3, 0.27, 0.4, false, false]);
    expectMuted(true, true, true, false);
  });

  it("never forwards stale derived settings to a newly real runtime index", () => {
    const state = observeMixer();
    const view = render(<MixerSyncBridge score={scoreWith()} />);
    act(() => {
      state.current.actions.setVolume(2, 0.15);
      state.current.actions.toggleSolo(2);
    });
    boundary.playback.applyMix.mockClear();
    view.rerender(<MixerSyncBridge score={scoreWith([{}], 3)} />);
    expect(state.current.mixer.channels).toHaveLength(3);
    expect(boundary.playback.applyMix.mock.calls.length).toBeGreaterThan(0);
    for (const [, volume, , muted] of boundary.playback.applyMix.mock.calls) {
      expect(volume).toBe(MIXER_DEFAULT_GAIN);
      expect(muted).toBe(false);
    }

    boundary.playback.applyMix.mockClear();
    view.rerender(<MixerSyncBridge score={scoreWith(undefined, 2)} />);
    const derivedCalls = boundary.playback.applyMix.mock.calls.filter(([index]) => index === 2);
    expect(derivedCalls.length).toBeGreaterThan(0);
    expect(derivedCalls.every(([, volume]) => volume === 0.15)).toBe(true);
    expectMuted(true, true, false);
  });

  it.each([true, false])("reset drops the store's derived cache when visible is %s", (visible) => {
    const state = observeMixer();
    const view = render(<MixerSyncBridge score={scoreWith()} />);
    act(() => {
      state.current.actions.setVolume(2, 0.15);
      state.current.actions.toggleSolo(2);
      state.current.actions.toggleMasterMute();
    });
    if (!visible) view.rerender(<MixerSyncBridge score={scoreWith([{}])} />);
    view.unmount();
    act(() => state.current.actions.reset());
    expect(state.current.mixer.channels).toHaveLength(0);
    render(<MixerSyncBridge score={scoreWith()} />);
    expect(state.current.mixer.channels[2]).toMatchObject({
      volume: MIXER_DEFAULT_GAIN,
      muted: false,
      solo: false,
    });
    expectMuted(false, false, false);
  });

  it("applies master and channel gain/mute while keeping Chords outside all family buses", () => {
    const state = observeMixer();
    render(<MixerSyncBridge score={scoreWith()} />);
    expect(Object.keys(state.current.mixer.groups).sort()).toEqual(["Strings", "Woodwinds"]);
    expect(state.current.mixer.partGroups.slice(0, 2)).toEqual(["Woodwinds", "Strings"]);
    expect(state.current.mixer.partGroups[2] ?? "").toBe("");
    act(() => {
      state.current.actions.setVolume(0, 0.8);
      state.current.actions.setVolume(1, 0.6);
      state.current.actions.setVolume(2, 0.4);
      state.current.actions.setPan(2, -0.25);
      state.current.actions.setMasterVolume(0.5);
      state.current.actions.setGroupVolume("Woodwinds", 0.25);
      state.current.actions.setGroupVolume("Strings", 0.1);
      state.current.actions.toggleGroupMute("Woodwinds");
    });
    expect(lastMix(0)[1]).toBeCloseTo(0.1);
    expect(lastMix(1)[1]).toBeCloseTo(0.03);
    expect(lastMix(2)).toEqual([2, 0.2, -0.25, false, true]);
    expectMuted(true, false, false);

    act(() => state.current.actions.toggleMasterMute());
    expectMuted(true, true, true);
    act(() => state.current.actions.toggleMasterMute());
    expectMuted(true, false, false);
    act(() => state.current.actions.toggleMute(2));
    expectMuted(true, false, true);
    act(() => state.current.actions.toggleMute(2));
    expectMuted(true, false, false);
  });

  it("composes Chords solo with real-channel and family-group solo using normal ungrouped semantics", () => {
    const state = observeMixer();
    render(<MixerSyncBridge score={scoreWith()} />);
    expectMuted(false, false, false);
    act(() => state.current.actions.toggleSolo(0));
    expectMuted(false, true, true);
    act(() => state.current.actions.toggleSolo(2));
    expectMuted(false, true, false);
    act(() => state.current.actions.toggleSolo(0));
    expectMuted(true, true, false);
    act(() => state.current.actions.toggleGroupSolo("Woodwinds"));
    expectMuted(true, true, true);
    act(() => state.current.actions.toggleSolo(2));
    expectMuted(false, true, true);
    act(() => state.current.actions.toggleGroupSolo("Woodwinds"));
    expectMuted(false, false, false);
  });

  it("does not rescan global measures on faders or parent renders retaining the measures identity", () => {
    const readChords = vi.fn(() => [chord()]);
    const measures: GlobalMeasure[] = [
      {},
      {
        get chordSymbols() {
          return readChords();
        },
      },
    ];
    const score = scoreWith(measures);
    const state = observeMixer();
    const view = render(<MixerSyncBridge score={score} />);
    expect(readChords).toHaveBeenCalled();
    readChords.mockClear();

    act(() => state.current.actions.setVolume(2, 0.2));
    act(() => state.current.actions.setVolume(0, 0.7));
    act(() => state.current.actions.setMasterVolume(0.6));
    act(() => state.current.actions.setGroupVolume("Woodwinds", 0.4));
    view.rerender(<MixerSyncBridge score={{ ...score, global: { ...score.global } }} />);
    view.rerender(<MixerSyncBridge score={{ ...score, parts: [...score.parts] }} />);
    expect(readChords).not.toHaveBeenCalled();
    expect(lastMix(2)[1]).toBeCloseTo(0.12);

    view.rerender(<MixerSyncBridge score={{ ...score, global: { measures: [...measures] } }} />);
    expect(readChords).toHaveBeenCalled();
    view.rerender(<MixerSyncBridge score={{ ...score, global: { measures: [{}] } }} />);
    expect(state.current.mixer.channels).toHaveLength(2);
  });
});

describe("useMixerPartSync compatibility", () => {
  interface SyncProps {
    count: number;
    hasChords?: boolean;
  }

  it("defaults hidden, preserves managed visibility when omitted, and explicitly hides on false", () => {
    const { result, rerender } = renderHook(
      ({ count, hasChords }: SyncProps) => {
        useMixerPartSync(count, hasChords);
        return { mixer: useMixer(), actions: useMixerActions() };
      },
      { initialProps: { count: 2 } as SyncProps },
    );
    expect(result.current.mixer.channels).toHaveLength(2);
    rerender({ count: 2, hasChords: true });
    expect(result.current.mixer.channels).toHaveLength(3);
    act(() => result.current.actions.setVolume(2, 0.31));
    rerender({ count: 3 });
    expect(result.current.mixer.channels).toHaveLength(4);
    expect(result.current.mixer.channels[2]?.volume).toBe(MIXER_DEFAULT_GAIN);
    expect(result.current.mixer.channels[3]?.volume).toBe(0.31);
    rerender({ count: 3, hasChords: false });
    expect(result.current.mixer.channels).toHaveLength(3);
    rerender({ count: 2 });
    expect(result.current.mixer.channels).toHaveLength(2);
    rerender({ count: 2, hasChords: true });
    expect(result.current.mixer.channels[2]?.volume).toBe(0.31);
  });

  it("tolerates duplicate and count-only consumers under StrictMode without hiding managed Chords", () => {
    function CountOnly({ count }: { count: number }) {
      useMixerPartSync(count);
      return null;
    }
    const score = scoreWith();
    const state = observeMixer();
    const view = render(
      <StrictMode>
        <CountOnly count={2} />
        <MixerSyncBridge score={score} />
        <CountOnly count={2} />
      </StrictMode>,
    );
    expect(state.current.mixer.channels).toHaveLength(3);
    act(() => state.current.actions.setVolume(2, 0.35));
    view.rerender(
      <StrictMode>
        <CountOnly count={3} />
        <MixerSyncBridge score={{ ...score, parts: [...score.parts, scoreWith(undefined, 3).parts[2]!] }} />
        <CountOnly count={3} />
      </StrictMode>,
    );
    expect(state.current.mixer.channels).toHaveLength(4);
    expect(state.current.mixer.channels[2]?.volume).toBe(MIXER_DEFAULT_GAIN);
    expect(state.current.mixer.channels[3]?.volume).toBe(0.35);
    expect(lastMix(3)[1]).toBe(0.35);
  });
});
