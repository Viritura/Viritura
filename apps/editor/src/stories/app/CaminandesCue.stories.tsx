/**
 * The Caminandes 3 demo cue — the score half of the video-sync demonstration.
 *
 * The cue is original music written to picture: every section boundary is a
 * cut, hit or emotional pivot in the clip, and its bar count, meter and integer
 * BPM were fitted so that downbeat lands within one frame at 24 fps. Opening
 * this score in the editor auto-attaches the clip (it carries
 * `_x.viritura.videoSync` with the demo source id), so Play mode rolls picture
 * and orchestra together.
 *
 * `showEditor` is off deliberately: the MNX is ~1.5 MB and a Monaco pane over
 * it would dominate the story for no benefit.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../storyFixtures/ScorePreview";
import cueMnx from "../../../../../packages/format/fixtures/mnx/caminandes-llamigos-cue.mnx?raw";

const meta: Meta = {
  title: "App/Caminandes Cue",
  component: ScorePreview,
  parameters: { layout: "fullscreen" },
};

export default meta;

/** The opening: fade-up, title fanfare, and Koro's theme on the ice. */
export const Opening: StoryObj = {
  render: () => <ScorePreview mnxJson={cueMnx} showEditor={false} viewMode="horizon" scrollAnchor="start" />,
  name: "Full cue (73 bars, 14 parts)",
};
