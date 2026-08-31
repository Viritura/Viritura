/**
 * Score-to-picture alignment for the Caminandes 3 demo cue.
 *
 * The cue exists to demonstrate video sync end to end, so its value depends
 * entirely on one property: each section's first downbeat must land on the
 * picture event it was written for. The cue predates fractional MNX tempos, so
 * its bar counts, meters and integer tempi were fitted to the frame grid. This
 * test keeps that authored fit honest if anyone edits the cue's tempo map.
 *
 * Tolerance is one frame at 24 fps: the point at which a mismatch becomes
 * visible against picture.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseMnx } from "@viritura/format";
import { generateTimeline } from "@viritura/midi";

const FRAME_SECONDS = 1 / 24;
const CUE_PATH = path.resolve(__dirname, "../../../../packages/format/fixtures/mnx/caminandes-llamigos-cue.mnx");

/** Section start bar (1-based) and the picture moment it is written against. */
const HITS: readonly { bar: number; seconds: number; label: string }[] = [
  { bar: 1, seconds: 0.0, label: "fade up from black" },
  { bar: 2, seconds: 2.0, label: "title card" },
  { bar: 4, seconds: 6.0, label: "Koro walks onto the ice" },
  { bar: 9, seconds: 16.25, label: "belly flop" },
  { bar: 11, seconds: 21.39, label: "close-up standoff" },
  { bar: 15, seconds: 30.25, label: "Koro realises" },
  { bar: 16, seconds: 32.25, label: "train reveal" },
  { bar: 29, seconds: 52.0, label: "berry snatched" },
  { bar: 31, seconds: 56.6, label: "cart enters the tunnel" },
  { bar: 33, seconds: 60.5, label: "berries revealed" },
  { bar: 41, seconds: 74.6, label: "head bonk 1" },
  { bar: 42, seconds: 75.05, label: "head bonk 2" },
  { bar: 44, seconds: 78.75, label: "burst into daylight" },
  { bar: 45, seconds: 80.25, label: "Koro launched" },
  { bar: 54, seconds: 95.5, label: "landing impact" },
  { bar: 56, seconds: 101.8, label: "comic deflate ends" },
  { bar: 60, seconds: 111.75, label: "dissolve to sunset" },
  { bar: 62, seconds: 117.0, label: "a berry falls" },
  { bar: 64, seconds: 121.0, label: "the flock arrives" },
  { bar: 69, seconds: 133.5, label: "pull back to the lighthouse" },
  { bar: 70, seconds: 137.0, label: "credits" },
];

/** Media duration of the clip; the final barline is written to meet it. */
const CLIP_END_SECONDS = 150.12;
const PICTURE_MARKERS = [
  [0, "Black / fade in"],
  [2, "Caminandes title card"],
  [6, "Koro walks onto the ice"],
  [7, "First slip"],
  [9.5, "Spots the berries"],
  [16, "Big slip, legs fly out"],
  [16.25, "Belly flop on ice"],
  [21.39, "Close-up standoff with Oti"],
  [24, "Oti cute-eyes"],
  [27, "Koro strains for berry"],
  [30.25, "Koro eye-pop realization"],
  [30.51, "Tracks: Oti has the berry"],
  [32.25, "Train reveal"],
  [33.89, "Koro alarmed"],
  [36.8, "Chase cutting begins"],
  [44.01, "Steam engulfs frame"],
  [49.89, "Steam clears"],
  [52, "Berry snatched mid-air"],
  [53.3, "They land together on the cart"],
  [56.6, "Cart enters the tunnel"],
  [60.5, "Berries revealed in the mine"],
  [62.25, "Wide: cart rolling through mine"],
  [66.43, "Grabbing berries"],
  [74.6, "Head bonk 1"],
  [75.05, "Head bonk 2"],
  [76, "Oti eats smugly"],
  [78.75, "Burst out of tunnel into daylight"],
  [79, "Wrecked cart in snow"],
  [80.25, "Koro launched into the air"],
  [83.47, "Sliding / tumbling"],
  [93.05, "Wide mountains, tiny falling speck"],
  [95.5, "Landing impact"],
  [97, "Flop, Oti lands beside"],
  [104, "Koro raises head"],
  [108, "Defeated look"],
  [111.75, "Dissolve to sunset cliff"],
  [114.51, "Closer: Koro alone on the cliff"],
  [117, "A berry falls into frame"],
  [118.8, "Oti offers berries"],
  [121, "Penguin flock arrives with berries"],
  [125, "The feast"],
  [133.5, "Pull back to the lighthouse"],
  [134.75, "Lighthouse beam, starfield"],
  [137, "Credits begin"],
  [150.12, "End of clip"],
] as const;

/** Bars where the meter genuinely changes; every other bar inherits. */
const METER_CHANGES =
  "1=2/4, 2=4/4, 9=3/4, 11=4/4, 14=2/4, 15=4/4, 28=3/4, 29=4/4, 41=1/4, 42=4/4, 53=2/4, 54=4/4, 56=3/4, 64=4/4, 73=2/4";

const raw = JSON.parse(fs.readFileSync(CUE_PATH, "utf-8")) as {
  global: { measures: { time?: { count: number; unit: number } }[] };
  parts: { measures: { dynamics?: { type: string; value?: string }[] }[] }[];
};
const score = parseMnx(raw);
const timeline = generateTimeline(score);
const { model, measureStartBeats, measureStartTimes } = timeline;

/** Every dynamic mark in the cue, flattened across parts and bars. */
const allDynamics = raw.parts.flatMap((part) => part.measures.flatMap((measure) => measure.dynamics ?? []));

describe("Caminandes 3 demo cue: score time lands on picture", () => {
  for (const hit of HITS) {
    it(`bar ${hit.bar} (${hit.label}) is within one frame of ${hit.seconds}s`, () => {
      const actual = measureStartTimes[hit.bar - 1];
      expect(actual).toBeDefined();
      expect(Math.abs(actual! - hit.seconds)).toBeLessThan(FRAME_SECONDS);
    });
  }

  it("the final barline lands within one frame of the end of the clip", () => {
    const lastIndex = score.global.measures.length - 1;
    const last = score.global.measures[lastIndex]!;
    const barBeats = (last.time!.count * 4) / last.time!.unit;
    const end = model.timeAtBeat(measureStartBeats[lastIndex]! + barBeats);
    expect(Math.abs(end - CLIP_END_SECONDS)).toBeLessThan(FRAME_SECONDS);
  });

  it("plays every part for the length of the picture", () => {
    expect(score.parts).toHaveLength(14);
    expect(timeline.events.length).toBeGreaterThan(1000);
    expect(Math.abs(timeline.duration - CLIP_END_SECONDS)).toBeLessThan(FRAME_SECONDS);
  });

  it("carries the demo clip in its video-sync settings", () => {
    expect(score.videoSync?.media?.demoSourceId).toBe("caminandes-llamigos");
    expect(score.videoSync?.pictureOffsetSeconds).toBe(0);
  });

  it("persists the complete analyzed picture marker map", () => {
    expect(score.videoSync?.hitPoints).toHaveLength(PICTURE_MARKERS.length);
    expect(score.videoSync?.hitPoints?.map((marker) => [marker.pictureSeconds, marker.label])).toEqual(PICTURE_MARKERS);
    expect(new Set(score.videoSync?.hitPoints?.map((marker) => marker.id)).size).toBe(PICTURE_MARKERS.length);
  });

  it("writes a time signature only where the meter actually changes", () => {
    // A meter carries forward in MNX, so restating it every bar would engrave a
    // signature on all 73 bars — noise that buries the ones a player has to act
    // on. The cue changes meter often (a 1/4 bar for the head bonk, 2/4 and 3/4
    // tails to land a cut), which is exactly why the redundant ones must go.
    const stated: string[] = [];
    let previous: string | null = null;
    raw.global.measures.forEach((measure, index) => {
      if (!measure.time) return;
      const signature = `${measure.time.count}/${measure.time.unit}`;
      expect(signature, `bar ${index + 1} restates the current meter`).not.toBe(previous);
      stated.push(`${index + 1}=${signature}`);
      previous = signature;
    });
    expect(raw.global.measures[0]?.time, "the first bar must state its meter").toBeDefined();
    expect(stated.join(", ")).toBe(METER_CHANGES);
  });

  it("shapes its dynamics instead of terracing everything at forte", () => {
    // The first draft was 228 marks, every one immediate, 65% at forte or above,
    // and not a single hairpin — so the loud moments had nothing to be loud
    // against. These bounds are deliberately loose: they catch a regenerated cue
    // collapsing back to a flat block of forte, not ordinary re-balancing.
    const immediate = allDynamics.filter((d) => d.type === "immediate");
    const hairpins = allDynamics.filter((d) => d.type === "gradual");
    const loud = immediate.filter((d) => d.value === "f" || d.value === "ff");
    const levels = new Set(immediate.map((d) => d.value));

    expect(hairpins.length, "the cue should shape some of its transitions").toBeGreaterThan(20);
    expect(levels.size, "a cue that only knows p and ff is not shaped").toBeGreaterThanOrEqual(6);
    expect(loud.length / immediate.length).toBeLessThan(0.6);
  });

  it("arrives under the flock rather than peaking on its first frame", () => {
    // Koro does not react until 123.5s and the heaped berries do not fill frame
    // until 125s, so landing the loudest bar on 121s spends the moment before
    // the picture has finished making it. The build crests on the pull-back.
    const valueAt = (bar: number) =>
      raw.parts.flatMap((part) => part.measures[bar - 1]?.dynamics ?? []).find((d) => d.type === "immediate")?.value;

    expect(valueAt(64), "flock walks in").toBe("mp");
    expect(valueAt(65), "Koro reacts").toBe("mf");
    expect(valueAt(66), "the feast").toBe("f");
    expect(valueAt(69), "pull back to the lighthouse").toBe("ff");
  });

  it("keeps Oti's peace offering quiet", () => {
    // 60.5s is a single berry held out after a whole film spent fighting over
    // one — not the bonanza the first hit map called it. The bonanza is 65.8s.
    const bar33 = raw.parts.flatMap((part) => part.measures[32]?.dynamics ?? []);
    const playingAt33 = raw.parts.filter((part) => part.measures[32]?.dynamics?.length).length;

    expect(bar33.every((d) => d.type !== "immediate" || d.value === "pp")).toBe(true);
    expect(playingAt33, "the offering is chamber-scale, not tutti").toBeLessThan(7);
  });
});
