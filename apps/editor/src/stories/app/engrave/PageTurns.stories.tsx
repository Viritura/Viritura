import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

/**
 * Engrave Mode — page-turn courtesy hints.
 *
 * When page-turn-aware pagination (a part default) places a turn just before
 * the next page opens with a multimeasure rest, the engine prints a courtesy
 * reminder in the bottom-right margin of the outgoing page: the literal text
 * "⊢N⊣", where N is the number of whole-bar rests waiting after the turn. This
 * mirrors the hand annotation performers write so they know the turn is safe
 * and how long they have. It is deliberately the literal tack-bracket text
 * rather than a miniature multimeasure-rest symbol, which could be misread as
 * an actual performance direction and double-counted.
 *
 * The page geometry below is intentionally small so the part paginates onto
 * facing pages: page 1 ends on a played bar and page 2 opens with four bars of
 * rest — the "time" case that triggers the hint.
 */
const meta: Meta = {
  title: "App/Engrave Mode/Page Turns",
  component: ScorePreview,
};
export default meta;

const MELODY_BARS = 10;
const REST_BARS = 4;
const TAIL_BARS = 6;

function quarter(step: string) {
  return { duration: { base: "quarter" }, notes: [{ pitch: { step, octave: 5 } }] };
}

/** A played bar: four quarter notes. */
function melodyMeasure() {
  return { sequences: [{ content: [quarter("C"), quarter("D"), quarter("E"), quarter("F")] }] };
}

/** A whole-bar rest (an explicit whole-duration rest event). */
function restMeasure() {
  return { sequences: [{ content: [{ duration: { base: "whole" } }] }] };
}

function buildScore() {
  const total = MELODY_BARS + REST_BARS + TAIL_BARS;
  const globalMeasures = Array.from({ length: total }, (_, i) =>
    i === 0 ? { id: "m1", time: { count: 4, unit: 4 }, key: { fifths: 0 } } : { id: `m${i + 1}` },
  );

  const partMeasures: Record<string, unknown>[] = [
    // First measure carries the clef.
    {
      clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
      sequences: [{ content: [quarter("C"), quarter("D"), quarter("E"), quarter("F")] }],
    },
  ];
  for (let i = 1; i < MELODY_BARS; i++) partMeasures.push(melodyMeasure());
  for (let i = 0; i < REST_BARS; i++) partMeasures.push(restMeasure());
  for (let i = 0; i < TAIL_BARS; i++) partMeasures.push(melodyMeasure());

  return {
    mnx: { version: 1 },
    global: { measures: globalMeasures },
    parts: [{ id: "vn", name: "Violin", shortName: "Vn.", measures: partMeasures }],
    layouts: [{ id: "L", content: [{ type: "staff", labelref: "shortName", sources: [{ part: "vn" }] }] }],
    scores: [
      {
        name: "Violin",
        layout: "L",
        // Small page so the part paginates onto two facing pages with the
        // rest block opening page 2 (the "time" case).
        _x: {
          viritura: {
            pageSetup: {
              width: 120,
              height: 55,
              orientation: "portrait",
              margins: { top: 15, right: 15, bottom: 15, left: 15 },
              spatiumMm: 1.0,
              pageTurns: { enabled: true, preset: "relaxed" },
            },
          },
        },
      },
    ],
  };
}

const mnxJson = JSON.stringify(buildScore(), null, 2);

/**
 * Spread view — the outgoing page (left) carries the "⊢4⊣" hint in its
 * bottom-right margin; page 2 (right) opens with the four-bar rest.
 */
export const TimeCaseSpread: StoryObj = {
  render: () => <ScorePreview mnxJson={mnxJson} viewMode="spread" height={620} />,
  name: "Courtesy hint (spread)",
};

/**
 * Single-page view of the same score — scroll/turn to the second page to see
 * the rest the hint refers to.
 */
export const TimeCasePage: StoryObj = {
  render: () => <ScorePreview mnxJson={mnxJson} viewMode="page" height={620} />,
  name: "Courtesy hint (page)",
};
