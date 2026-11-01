import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { initWasm, loadMusicFont, wasmComputeMnxScoreLayout, type DisplayList } from "@viritura/renderer";
import { Button } from "@viritura/ui";
import { ChordTrackPrototype } from "../../../components/ChordTrackPrototype";
import { CHORD_TRACK_MNX, MOCK_TRACK_CHORDS } from "../../storyFixtures/chordTrackScore";

interface Props {
  initialView: "horizon" | "page";
  empty?: boolean;
}

function ChordTrackStory({ initialView, empty = false }: Props) {
  const [view, setView] = useState(initialView);
  const [layouts, setLayouts] = useState<Record<"horizon" | "page", DisplayList> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([initWasm(), loadMusicFont()])
      .then(([, fonts]) => {
        if (fonts.failed.length) throw new Error(`Could not load prototype fonts: ${fonts.failed.join(", ")}`);
        const horizon = wasmComputeMnxScoreLayout(CHORD_TRACK_MNX, 12, 0);
        const page = wasmComputeMnxScoreLayout(CHORD_TRACK_MNX, 12, 1000);
        if (!horizon.measureBounds?.length || !page.measureBounds?.length) {
          throw new Error("Prototype layout did not publish rhythmic geometry");
        }
        if (!cancelled) {
          setLayouts({ horizon, page });
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        console.error("Chord track prototype layout failed", reason);
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, padding: "12px 20px" }}>
        <Button label="Horizon" active={view === "horizon"} onClick={() => setView("horizon")} />
        <Button label="Wrapped systems" active={view === "page"} onClick={() => setView("page")} />
        <span style={{ alignSelf: "center", fontSize: 12 }}>
          Real Rust notation and beat anchors. Mock harmony. Prototype spacing, not print pagination.
        </span>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : layouts ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ChordTrackPrototype
            displayList={layouts[view]}
            initialChords={empty ? [] : MOCK_TRACK_CHORDS}
            viewMode={view}
          />
        </div>
      ) : (
        <p role="status">Loading notation</p>
      )}
    </div>
  );
}

const meta: Meta<typeof ChordTrackStory> = {
  title: "App/Write Mode/Chord Track Prototype",
  component: ChordTrackStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "An isolated chord-lane experiment: real Rust engraving and nonuniform beat anchors, " +
          "Canvas score/ruler/chord painting, and accessible React hit targets with the shared text popover. " +
          "Horizon places the lane below the paper; wrapped mode allocates a lane above each system. " +
          "This is mock editor spacing, not final pagination. Changes are local and survive switching views; " +
          "there is no document mutation, playback, transposition, or export integration. " +
          "Single-click to select; double-click or press Enter to edit. Drag chords in Horizon to preview " +
          "snapped moves and destination replacements; hold Alt for a temporary sixteenth-note grid. " +
          "The horizontal header stays pinned while scrolling. " +
          "Use Space/Shift+Space to move to the first beat of the next/previous bar, semicolon to advance quarter beats, " +
          "and Ctrl+arrows as an alternative for bar navigation.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ChordTrackStory>;

export const Horizon: Story = { args: { initialView: "horizon" } };
export const WrappedSystems: Story = { args: { initialView: "page" } };
export const EmptyTrack: Story = { args: { initialView: "horizon", empty: true } };
