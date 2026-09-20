import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { formatChordSymbolText, transposeChordSymbol } from "@viritura/core";
import { assertRawScore, parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import * as stories from "../../../stories/viritura-extensions/directions/ChordSymbol.stories";

vi.mock("../../../stories/storyFixtures/ScorePreview", () => ({ ScorePreview: () => null }));

type StoryKey = Exclude<keyof typeof stories, "default">;
const STORY_KEYS = Object.keys(stories).filter((key): key is StoryKey => key !== "default");

function readStorySource(key: StoryKey) {
  const story = stories[key];
  const element = (story.render as (args: unknown) => ReactElement<{ mnxJson: string }>)(story.args ?? {});
  const raw: unknown = JSON.parse(element.props.mnxJson);
  expect(validateRawScore(raw).ok).toBe(true);
  assertRawScore(raw);
  return raw;
}

function readStory(key: StoryKey) {
  return parseMnx(readStorySource(key));
}

describe("global chord-symbol notation stories", () => {
  it.each(STORY_KEYS)("%s round-trips global-only harmony", (key) => {
    const score = readStory(key);
    expect(score.global.measures.some((measure) => measure.chordSymbols?.length)).toBe(true);
    for (const measure of score.global.measures) {
      for (const chord of measure.chordSymbols ?? []) expect(chord).not.toHaveProperty("displayStaff");
    }
    for (const part of score.parts) {
      for (const measure of part.measures) expect(measure).not.toHaveProperty("chordSymbols");
    }
    const raw = serializeMnx(score);
    expect(validateRawScore(raw).ok).toBe(true);
    expect(parseMnx(raw)).toEqual(score);
  });

  it.each([
    ["SourcePartVisibilityAuto", "auto"],
    ["SourcePartVisibilityShow", "show"],
    ["SourcePartVisibilityHide", "hide"],
  ] as const)("%s stores policy on source Parts only", (key, policy) => {
    const score = readStory(key);
    expect(score.parts.map((part) => part.chordSymbolVisibility)).toEqual([policy, policy]);
    expect(serializeMnx(score)).toHaveProperty("parts.0._x.viritura.chordSymbolVisibility", policy);
    expect(serializeMnx(score)).toHaveProperty("parts.1._x.viritura.chordSymbolVisibility", policy);
    for (const layout of score.layouts ?? []) {
      for (const staff of layout.content) expect(staff).not.toHaveProperty("chordSymbolVisibility");
    }
  });

  it("keeps concert harmony canonical while both B-flat root and bass transpose for display", () => {
    const concert = readStory("BbConcertHarmony");
    const written = readStory("BbWrittenHarmony");
    expect(concert.scores?.[0]?.useWritten).toBe(false);
    expect(written.scores?.[0]?.useWritten).toBe(true);
    const concertSource = readStorySource("BbConcertHarmony");
    const writtenSource = readStorySource("BbWrittenHarmony");
    expect(writtenSource.global).toEqual(concertSource.global);
    expect(writtenSource.parts).toEqual(concertSource.parts);
    const harmony = written.global.measures.flatMap((measure) => measure.chordSymbols ?? []);
    const before = structuredClone(harmony);
    const interval = written.parts[0]!.transposition!.interval;
    expect(harmony.map((chord) => formatChordSymbolText(transposeChordSymbol(chord, interval)))).toEqual([
      "D/F#",
      "Em7/G",
      "A7/C#",
      "Dmaj7/F#",
    ]);
    expect(harmony).toEqual(before);
  });
});
