import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickEngine } from "@viritura/audio/click";
import { TransportBar } from "@viritura/playback";
import { Button, TooltipPrimitives } from "@viritura/ui";
import score from "../../../../packages/format/fixtures/mnx/c-major-scale.mnx?raw";
import { useClickPlayer } from "../click/useClickPlayer";
import { PlaybackPanel } from "../components/SettingsDialog/panels/PlaybackPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ClickPlayerProbe() {
  const player = useClickPlayer(score);
  return <Button onClick={() => void player.play()}>Start click</Button>;
}

describe("PlaybackPanel", () => {
  it("saves the chosen metronome sound and restores it when settings reopen", () => {
    const panel = render(<PlaybackPanel />);
    expect(screen.getByRole("radiogroup", { name: "Metronome sound" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Oscillator" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Beep" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Tick" }));
    expect(localStorage.getItem("viritura.metronome.sound")).toBe("tick");
    panel.unmount();
    render(<PlaybackPanel />);
    expect(screen.getByRole("radio", { name: "Tick" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Oscillator" }));
  });

  it("saves the Click player flash preference when settings reopen", () => {
    const panel = render(<PlaybackPanel />);
    expect(screen.getByRole("radiogroup", { name: "Click player flash" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Every beat" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Measure only" }));
    expect(localStorage.getItem("viritura.click.flash")).toBe("measure");
    panel.unmount();
    render(<PlaybackPanel />);
    expect(screen.getByRole("radio", { name: "Measure only" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(localStorage.getItem("viritura.click.flash")).toBe("off");
    fireEvent.click(screen.getByRole("radio", { name: "Every beat" }));
  });

  it("applies the selected sound to Click playback and changes it during a take", async () => {
    const engine = {
      context: { currentTime: 0, state: "running", resume: vi.fn(async () => {}), onstatechange: null },
      onEvent: vi.fn(() => () => {}),
      setSound: vi.fn(async () => {}),
      load: vi.fn(async () => 0),
      start: vi.fn(async () => ({ contextTime: 0 })),
      dispose: vi.fn(async () => {}),
    };
    vi.spyOn(ClickEngine, "create").mockResolvedValue(engine as unknown as ClickEngine);
    render(
      <>
        <PlaybackPanel />
        <ClickPlayerProbe />
      </>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Woodblock" }));
    fireEvent.click(screen.getByRole("button", { name: "Start click" }));
    await waitFor(() => expect(engine.start).toHaveBeenCalledOnce());
    expect(engine.setSound).toHaveBeenCalledWith("woodblock");

    fireEvent.click(screen.getByRole("radio", { name: "Oscillator" }));
    await waitFor(() => expect(engine.setSound).toHaveBeenLastCalledWith("oscillator"));
    expect(engine.start).toHaveBeenCalledOnce();
  });

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
