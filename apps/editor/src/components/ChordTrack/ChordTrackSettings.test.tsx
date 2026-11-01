// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useViewStateStore } from "../../store/viewStateStore";
import { ConnectedChordTrackSettings } from "./ChordTrackSettings";
import { buildTrackSystems } from "./trackGeometry";
import { ChordTrackSettingsTrigger } from "./ChordTrackSettingsButton";
import { TooltipPrimitives } from "@viritura/ui";
import userEvent from "@testing-library/user-event";

const initial = useViewStateStore.getState();
afterEach(() => {
  cleanup();
  useViewStateStore.setState(initial);
});

describe("chord settings", () => {
  it("controls vertical stickiness and natural Horizon position independently", async () => {
    const user = userEvent.setup();
    useViewStateStore.setState({ chordTrackSticky: true, chordTrackPosition: "below" });
    render(<ConnectedChordTrackSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Sticky chord track" }));
    expect(useViewStateStore.getState().chordTrackSticky).toBe(false);
    await user.click(screen.getByRole("combobox", { name: "Chord track position" }));
    await user.click(await screen.findByRole("option", { name: "Above music", exact: true }));
    expect(useViewStateStore.getState().chordTrackPosition).toBe("above");
    expect(useViewStateStore.getState().chordTrackSticky).toBe(false);
  });

  it("keeps entry and playback settings together without navigation buttons", () => {
    render(<ConnectedChordTrackSettings />);
    expect(screen.queryByRole("button", { name: "Chord track" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to chords" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Chord entry grid" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Audition chords" })).toBeTruthy();
    expect(screen.queryByText("Concert pitch")).toBeNull();
    expect(screen.queryByText(/The track displays and accepts/)).toBeNull();
    expect(screen.queryByRole("switch", { name: "Sticky CHORDS header" })).toBeNull();
  });

  it("updates the same audition preference used by chord entry", () => {
    useViewStateStore.setState({ chordTrackAudition: true });
    render(<ConnectedChordTrackSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Audition chords" }));
    expect(useViewStateStore.getState().chordTrackAudition).toBe(false);
  });

  it("shows quarter-note grid copy and explains the temporary Alt override", () => {
    useViewStateStore.setState({ chordTrackGrid: "quarter" });
    render(<ConnectedChordTrackSettings />);
    expect(screen.getByRole("combobox", { name: "Chord entry grid" }).textContent).toContain("Quarter");
    expect(screen.getByText("Hold Alt while dragging a chord to snap to sixteenth notes.")).toBeTruthy();
  });

  it("opens settings from the track cog and closes them when the track is hidden", () => {
    useViewStateStore.setState({ chordSettingsOpen: false, chordTrackEnabled: true });
    render(
      <TooltipPrimitives.Provider>
        <ChordTrackSettingsTrigger
          system={
            buildTrackSystems({
              commands: [],
              width: 400,
              height: 200,
              measureBounds: [
                {
                  index: 0,
                  partIndex: 0,
                  partId: "piano",
                  staffIndex: 0,
                  x: 200,
                  y: 100,
                  width: 200,
                  height: 48,
                  prefixWidth: 20,
                  totalBeats: 4,
                  beatAnchors: [
                    [0, 220],
                    [4, 400],
                  ],
                },
              ],
            })[0]
          }
          viewport={{ zoom: 0.75, scrollX: 0, scrollY: 0 }}
          visible
          railY={300}
          scale={0.75}
        />
      </TooltipPrimitives.Provider>,
    );
    const cog = screen.getByRole("button", { name: "Chord settings" });
    expect(cog.closest("[data-sticky-chord-header]")?.getAttribute("data-sticky-chord-header")).toBe("true");
    expect(cog.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(cog);
    expect(useViewStateStore.getState().chordSettingsOpen).toBe(true);
    useViewStateStore.getState().setChordTrackEnabled(false);
    expect(useViewStateStore.getState().chordSettingsOpen).toBe(false);
  });

  it("closes settings when switching away from Horizon", () => {
    useViewStateStore.setState({ chordSettingsOpen: true, viewMode: "horizon" });
    useViewStateStore.getState().setViewMode("page");
    expect(useViewStateStore.getState().chordSettingsOpen).toBe(false);
  });
});
