import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { TEXT_FRAME_MNX_JSON } from "../../storyFixtures/textFrameScore";

/**
 * `scores[]._x.viritura.textFrames` — free rectangular text owned by one score
 * view. The locator picks the page (directly by index, or through the page a
 * measure/event lands on after pagination); placement, offset, and width then
 * position the frame on that page. Horizon view has no pages and hides frames.
 */
const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Text Frames",
  component: ScorePreview,
};

export default meta;

/** Page-index frame (bottom, bordered, justified) plus a measure-located and an event-located frame. */
export const PageAndMusicalAnchors: StoryObj = {
  render: () => <ScorePreview mnxJson={TEXT_FRAME_MNX_JSON} viewMode="page" height={900} />,
  name: "Page, measure, and event anchors",
};
