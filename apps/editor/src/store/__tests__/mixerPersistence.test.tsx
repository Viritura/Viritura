// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CHORDS_PART_ID, patch, type Score } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { createDocumentStore } from "../documentStore";
import { bindMixerDocument } from "../mixerPersistence";
import { MIXER_DEFAULT_GAIN } from "../mixerGain";
import { useMixer, useMixerActions } from "../mixerStore";

const subscriptions: (() => void)[] = [];
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  cleanup();
});

function scoreWithChords(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ chordSymbols: [{ position: { fraction: [0, 1] }, rawText: "C" }] }] },
    parts: ["Flute", "Violin"].map((name) => ({ id: name.toLowerCase(), name, measures: [{ sequences: [] }] })),
  };
}

function setup() {
  const store = createDocumentStore();
  subscriptions.push(bindMixerDocument(store));
  const { result } = renderHook(() => ({ mixer: useMixer(), actions: useMixerActions() }));
  act(() => store.getState().loadScore(scoreWithChords()));
  return { store, result };
}

describe("document mixer persistence", () => {
  it("saves chord mute synchronously, marks dirty, and restores it after reopening", () => {
    const { store, result } = setup();
    expect(store.getState().dirty).toBe(false);
    act(() => result.current.actions.toggleMute(2));
    const saved = store.getState().mnxJson;
    expect(store.getState().dirty).toBe(true);
    expect(parseMnx(JSON.parse(saved)).mixer?.channels?.[CHORDS_PART_ID]?.muted).toBe(true);
    expect(store.getState().lastCommittedPatches[0]?.kind).toBe("setScoreExtension");
    act(() => {
      store.getState().markSaved(saved, store.getState().documentGeneration);
      store.getState().newScore();
      store.getState().loadScore(parseMnx(JSON.parse(saved)));
    });
    expect(result.current.mixer.channels[2]?.muted).toBe(true);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().score?.parts).toHaveLength(2);
  });

  it("round-trips channel, group, and master controls without altering notation edits", () => {
    const { store, result } = setup();
    act(() => {
      result.current.actions.setVolume(0, 1.2);
      result.current.actions.setPan(0, -0.4);
      result.current.actions.toggleSolo(0);
      result.current.actions.toggleEnsemble(0);
      result.current.actions.toggleSpatialMode(0);
      result.current.actions.setGroupVolume("Woodwinds", 0.8);
      result.current.actions.toggleGroupMute("Woodwinds");
      result.current.actions.toggleGroupSolo("Woodwinds");
      result.current.actions.setMasterVolume(1.3);
      result.current.actions.toggleMasterMute();
      store.getState().commitPatches([patch.setScoreMetadata({ title: "New title" })]);
    });
    const expected = result.current.mixer;
    const saved = store.getState().mnxJson;
    act(() => store.getState().loadScore(parseMnx(JSON.parse(saved))));
    expect(result.current.mixer).toEqual(expected);
    expect(store.getState().score?.metadata?.title).toBe("New title");
    expect(result.current.mixer.groups["Woodwinds"]).toEqual({ volume: 0.8, muted: true, solo: true });
    expect(result.current.mixer.channels[0]).toMatchObject({
      volume: 1.2,
      pan: -0.4,
      solo: true,
      ensembleEnabled: false,
      spatialMode: "stereo",
    });
  });

  it("does not leak controls into another document with the same roster", () => {
    const { store, result } = setup();
    act(() => {
      result.current.actions.toggleMute(2);
      result.current.actions.toggleGroupMute("Woodwinds");
      result.current.actions.toggleMasterMute();
      store.getState().loadScore(scoreWithChords());
    });
    expect(result.current.mixer.channels.every((channel) => !channel.muted)).toBe(true);
    expect(result.current.mixer.groups["Woodwinds"]?.muted).toBe(false);
    expect(result.current.mixer.masterMuted).toBe(false);
    expect(store.getState().score?.mixer).toBeUndefined();
    expect(store.getState().dirty).toBe(false);
  });

  it("uses stable part IDs through reordering, insertion, and removal", () => {
    const { store, result } = setup();
    act(() => {
      result.current.actions.setVolume(0, 0.3);
      result.current.actions.setPan(1, 0.6);
      result.current.actions.toggleMute(2);
      const score = store.getState().workingScore!;
      store.getState().updateScore({
        ...score,
        parts: [score.parts[1]!, { id: "clarinet", name: "Clarinet", measures: [{ sequences: [] }] }, score.parts[0]!],
      });
    });
    expect(result.current.mixer.channels[0]?.pan).toBe(0.6);
    expect(result.current.mixer.channels[1]?.volume).toBe(MIXER_DEFAULT_GAIN);
    expect(result.current.mixer.channels[2]?.volume).toBe(0.3);
    expect(result.current.mixer.channels[3]?.muted).toBe(true);
    act(() => {
      const score = store.getState().workingScore!;
      store.getState().updateScore({ ...score, parts: score.parts.slice(1) });
      result.current.actions.toggleMute(0);
    });
    expect(result.current.mixer.channels[1]?.volume).toBe(0.3);
    const saved = parseMnx(JSON.parse(store.getState().mnxJson)).mixer;
    expect(saved?.channels?.["violin"]).toBeUndefined();
    expect(saved?.channels?.["clarinet"]?.muted).toBe(true);
    expect(saved?.channels?.[CHORDS_PART_ID]?.muted).toBe(true);
  });

  it("retains hidden chord controls through saving and reopening without active solo", () => {
    const { store, result } = setup();
    act(() => {
      result.current.actions.toggleSolo(2);
      result.current.actions.toggleMute(2);
      const score = store.getState().workingScore!;
      store.getState().updateScore({ ...score, global: { measures: [{}] } });
      result.current.actions.setMasterVolume(0.7);
    });
    expect(result.current.mixer.channels).toHaveLength(2);
    expect(result.current.mixer.channels.some((channel) => channel.solo)).toBe(false);
    const saved = store.getState().mnxJson;
    act(() => {
      store.getState().loadScore(parseMnx(JSON.parse(saved)));
      const score = store.getState().workingScore!;
      store.getState().updateScore({ ...score, global: scoreWithChords().global });
    });
    expect(result.current.mixer.channels[2]).toMatchObject({ muted: true, solo: true });
    expect(result.current.mixer.masterVolume).toBe(0.7);
  });

  it("restores externally changed mixer settings without a write loop", () => {
    const { store, result } = setup();
    act(() =>
      store.getState().commitPatches([
        patch.setScoreExtension({
          field: "mixer",
          value: { channels: { [CHORDS_PART_ID]: { muted: true } }, masterVolume: 0.4 },
        }),
      ]),
    );
    expect(result.current.mixer.channels[2]?.muted).toBe(true);
    expect(result.current.mixer.masterVolume).toBe(0.4);
    expect(store.getState().workingScore?.mixer).toEqual({
      channels: { [CHORDS_PART_ID]: { muted: true } },
      masterVolume: 0.4,
    });
    act(() => store.getState().commitPatches([patch.setScoreExtension({ field: "mixer", value: undefined })]));
    expect(result.current.mixer.channels[2]?.muted).toBe(false);
    expect(result.current.mixer.masterVolume).toBe(1);
  });

  it("cleans up subscriptions and can reconnect without marking the score dirty", () => {
    const { store, result } = setup();
    subscriptions.pop()!();
    act(() => result.current.actions.toggleMute(2));
    expect(store.getState().dirty).toBe(false);
    act(() => subscriptions.push(bindMixerDocument(store)));
    expect(result.current.mixer.channels[2]?.muted).toBe(false);
    expect(store.getState().dirty).toBe(false);
    act(() => result.current.actions.toggleMute(2));
    expect(parseMnx(JSON.parse(store.getState().mnxJson)).mixer?.channels?.[CHORDS_PART_ID]?.muted).toBe(true);
  });
});
