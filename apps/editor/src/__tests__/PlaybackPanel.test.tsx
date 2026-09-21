import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TransportBar } from "@viritura/playback";
import { TooltipPrimitives } from "@viritura/ui";
import { PlaybackPanel } from "../components/SettingsDialog/panels/PlaybackPanel";

afterEach(cleanup);

describe("PlaybackPanel", () => {
  it("updates the shared transport visibility preferences", () => {
    render(
      <TooltipPrimitives.Provider>
        <PlaybackPanel />
        <TransportBar />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByRole("button", { name: "Back to start" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Showing time — click for measure:beat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Follow playhead on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Metronome off" })).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Show time display" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show follow-playback-head control" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show metronome control" }));

    expect(screen.queryByRole("button", { name: "Showing time — click for measure:beat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow playhead on" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Metronome off" })).toBeNull();
    expect(localStorage.getItem("viritura.transport.visibility")).toBe(
      JSON.stringify({ showTimeDisplay: false, showFollow: false, showMetronome: false }),
    );

    fireEvent.click(screen.getByRole("switch", { name: "Show time display" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show follow-playback-head control" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show metronome control" }));
  });

  it("keeps explicit view overrides above persisted visibility preferences", () => {
    render(
      <TooltipPrimitives.Provider>
        <TransportBar showTimeDisplay showFollow={false} showMetronome={false} />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByRole("button", { name: "Showing time — click for measure:beat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Follow playhead/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Metronome/ })).toBeNull();
  });
});
