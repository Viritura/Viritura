import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickEngineEvent } from "@viritura/audio/click";
import score from "../../../../packages/format/fixtures/mnx/c-major-scale.mnx?raw";
import rehearsals from "../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import { ClickPage } from "./index";

const audio = vi.hoisted(() => ({
  create: vi.fn(),
  load: vi.fn(async () => 0),
  start: vi.fn(async () => ({ contextTime: 1 })),
  stop: vi.fn(async () => 0.75),
  dispose: vi.fn(async () => {}),
  context: { currentTime: 0, state: "running", resume: vi.fn(async () => {}), onstatechange: null },
  listener: undefined as ((event: ClickEngineEvent) => void) | undefined,
}));

vi.mock("@viritura/audio/click", () => ({
  ClickEngine: { create: audio.create },
}));

beforeEach(() => {
  vi.clearAllMocks();
  audio.listener = undefined;
  audio.context.currentTime = 0;
  audio.create.mockResolvedValue({
    ...audio,
    onEvent: (listener: (event: ClickEngineEvent) => void) => {
      audio.listener = listener;
      return () => {
        audio.listener = undefined;
      };
    },
  });
});

afterEach(cleanup);

async function openFile(text = score, name = "practice.mnx") {
  fireEvent.change(screen.getByLabelText("MNX file"), {
    target: { files: [new File([text], name, { type: "application/json" })] },
  });
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Click player" }).getAttribute("aria-busy")).toBe("false"),
  );
}

describe("standalone click page", () => {
  it("opens MNX without audio and toggles Start and Stop with a fresh countoff", async () => {
    render(<ClickPage />);
    await openFile();
    const navigation = within(screen.getByRole("banner"));
    expect(navigation.getByRole("heading", { name: "practice.mnx" })).toBeTruthy();
    expect(navigation.getByRole("button", { name: "Open MNX" })).toBeTruthy();
    expect(screen.getByText("4 clicks free")).toBeTruthy();
    expect(screen.queryByText("Next start")).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Resume|Stop/ })).toBeNull();
    expect(audio.create).not.toHaveBeenCalled();

    const transport = screen.getByRole("button", { name: "Start", exact: true });
    fireEvent.click(transport);
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toContain("Counting off"),
    );
    expect(audio.load).toHaveBeenCalledWith(
      expect.arrayContaining([
        { time: 0, level: "accent" },
        { time: 2, level: "accent" },
      ]),
      6,
    );
    expect(audio.start).toHaveBeenLastCalledWith();

    expect(screen.queryByRole("button", { name: /Start|Pause|Resume/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop" })).toBe(transport);
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Ready"));
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBe(transport));
    expect(audio.start).toHaveBeenLastCalledWith();
    act(() => audio.listener?.({ type: "ended" }));
    expect(screen.getByRole("button", { name: "Start" })).toBe(transport);
  });

  it("clears the previous file and reports invalid MNX instead of playing stale data", async () => {
    render(<ClickPage />);
    await openFile();
    await openFile("{}", "invalid.mnx");
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "practice.mnx" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start", exact: true })).toBeNull();
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("toggles the countoff cue and plays both bars before the selected start", async () => {
    render(<ClickPage />);
    await openFile();
    fireEvent.click(screen.getByRole("radio", { name: "2 bars" }));
    expect(screen.getByText("8 clicks free")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "1 bar" }));
    expect(screen.getByText("4 clicks free")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "2 bars" }));
    fireEvent.click(screen.getByRole("option", { name: "Bar 2" }));
    expect(screen.getByText("8 clicks free")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() =>
      expect(audio.load).toHaveBeenCalledWith(
        expect.arrayContaining([
          { time: 0, level: "accent" },
          { time: 2, level: "accent" },
          { time: 4, level: "accent" },
        ]),
        6,
      ),
    );
    expect(screen.getByRole("radio", { name: "1 bar" }).hasAttribute("disabled")).toBe(true);
    act(() => {
      audio.context.currentTime = 4.6;
    });
    await waitFor(() => expect(screen.getByText("Counting off 8 of 8")).toBeTruthy());
    expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true");
    act(() => {
      audio.context.currentTime = 5.1;
    });
    await waitFor(() => expect(screen.getByText("8 clicks free")).toBeTruthy());
    expect(screen.queryByRole("status", { name: "Playback position" })).toBeNull();
  });

  it("updates the countoff cue when the selected bar changes meter", async () => {
    const mixedMeter = JSON.parse(score) as { global: { measures: { time?: { count: number; unit: number } }[] } };
    mixedMeter.global.measures[1]!.time = { count: 3, unit: 4 };
    render(<ClickPage />);
    await openFile(JSON.stringify(mixedMeter));
    expect(screen.getByText("4 clicks free")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Bar 2" }));
    expect(screen.getByText("3 clicks free")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "2 bars" }));
    expect(screen.getByText("6 clicks free")).toBeTruthy();
  });

  it("uses a 0–100% tempo scale and requires a positive tempo to start", async () => {
    render(<ClickPage />);
    await openFile();

    const slider = screen.getByRole("slider", { name: "Session tempo %" });
    const play = screen.getByRole("button", { name: "Start", exact: true });
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe("100");

    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByText("0%")).toBeTruthy();
    expect(play.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Set tempo above 0% to start");
    fireEvent.click(play);
    expect(audio.create).not.toHaveBeenCalled();

    fireEvent.change(slider, { target: { value: "1" } });
    expect(screen.getByText("1%")).toBeTruthy();
    expect(play.hasAttribute("disabled")).toBe(false);

    fireEvent.change(slider, { target: { value: "50" } });
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset to 100%" })).toBeNull();
    fireEvent.change(slider, { target: { value: "100" } });
    expect(screen.getByText("100%")).toBeTruthy();

    fireEvent.change(slider, { target: { value: "50" } });
    fireEvent.click(play);
    await waitFor(() =>
      expect(audio.load).toHaveBeenCalledWith(
        expect.arrayContaining([
          { time: 0, level: "accent" },
          { time: 4, level: "accent" },
        ]),
        12,
      ),
    );
  });

  it("settles touch scrolling before enabling Start and starts at the selected rehearsal", async () => {
    render(<ClickPage />);
    await openFile(rehearsals);
    const dial = screen.getByRole("listbox", { name: "Start bar" });
    const play = screen.getByRole("button", { name: "Start", exact: true });

    fireEvent.pointerDown(dial, { pointerType: "touch" });
    expect(play.hasAttribute("disabled")).toBe(true);
    dial.scrollLeft = 160;
    fireEvent.scroll(dial);
    expect(play.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerUp(dial, { pointerType: "touch" });
    await waitFor(() => expect(play.hasAttribute("disabled")).toBe(false));
    expect(screen.getByRole("option", { name: "Bar 3, rehearsal B" }).getAttribute("aria-selected")).toBe("true");
    expect(play.hasAttribute("disabled")).toBe(false);

    fireEvent.click(play);
    await waitFor(() =>
      expect(audio.load).toHaveBeenCalledWith(
        expect.arrayContaining([
          { time: 0, level: "accent" },
          { time: 2, level: "accent" },
          { time: 6, level: "accent" },
        ]),
        8,
      ),
    );
    expect(screen.getByRole("option", { name: "Bar 3, rehearsal B" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects a repeated bar visit rather than silently starting its first occurrence", async () => {
    const repeated = JSON.parse(score) as {
      global: { measures: { repeatStart?: object; repeatEnd?: object }[] };
    };
    repeated.global.measures[0]!.repeatStart = {};
    repeated.global.measures[1]!.repeatEnd = {};
    render(<ClickPage />);
    await openFile(JSON.stringify(repeated));
    fireEvent.click(screen.getByRole("option", { name: "Bar 1, visit 2 of 2" }));
    expect(screen.getByRole("option", { name: "Bar 1, visit 2 of 2" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.load).toHaveBeenCalledWith(expect.any(Array), 6));
    expect(screen.getByRole("option", { name: "Bar 1, visit 2 of 2" }).getAttribute("aria-selected")).toBe("true");
  });

  it("scrolls through rehearsals independently and synchronizes the selected bar", async () => {
    render(<ClickPage />);
    await openFile(rehearsals);
    const rehearsalTrack = screen.getByRole("listbox", { name: "Rehearsal" });
    const barTrack = screen.getByRole("listbox", { name: "Start bar" });
    expect(within(rehearsalTrack).getAllByRole("option")).toHaveLength(4);
    fireEvent.pointerDown(rehearsalTrack, { pointerType: "touch" });
    rehearsalTrack.scrollLeft = 80;
    fireEvent.scroll(rehearsalTrack);
    expect(barTrack.scrollLeft).toBe(0);
    expect(screen.getByRole("button", { name: "Start", exact: true }).hasAttribute("disabled")).toBe(true);
    fireEvent.pointerUp(rehearsalTrack, { pointerType: "touch" });
    await waitFor(() => expect(barTrack.scrollLeft).toBe(160));
    expect(rehearsalTrack.scrollLeft).toBe(80);
    expect(barTrack.scrollLeft).toBe(160);
    fireEvent.click(within(barTrack).getByRole("option", { name: "Bar 2" }));
    expect(
      within(rehearsalTrack).getByRole("option", { name: "Rehearsal A, Bar 1" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(rehearsalTrack.scrollLeft).toBe(0);
    expect(barTrack.scrollLeft).toBe(80);
  });

  it("keeps Start disabled until both tracks have settled", async () => {
    render(<ClickPage />);
    await openFile(rehearsals);
    const rehearsalTrack = screen.getByRole("listbox", { name: "Rehearsal" });
    fireEvent.pointerDown(rehearsalTrack, { pointerType: "touch" });
    fireEvent.wheel(screen.getByRole("listbox", { name: "Start bar" }), { deltaY: 80 });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true"),
    );
    const play = screen.getByRole("button", { name: "Start", exact: true });
    expect(play.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerUp(rehearsalTrack, { pointerType: "touch" });
    await waitFor(() => expect(play.hasAttribute("disabled")).toBe(false));
  });

  it("follows the current rehearsal without seeking the playing take", async () => {
    render(<ClickPage />);
    await openFile(rehearsals);
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    act(() => {
      audio.context.currentTime = 7.1;
    });
    const track = screen.getByRole("listbox", { name: "Rehearsal" });
    await waitFor(() =>
      expect(within(track).getByRole("option", { name: "Rehearsal B, Bar 3" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(track.scrollLeft).toBe(80);
    expect(track.getAttribute("aria-readonly")).toBe("true");
    track.scrollLeft = 240;
    fireEvent.scroll(track);
    expect(track.scrollLeft).toBe(80);
    expect(audio.load).toHaveBeenCalledOnce();
    expect(screen.getByText("4 clicks free")).toBeTruthy();
  });

  it("follows the current bar during playback and restores the selected start on Stop", async () => {
    render(<ClickPage />);
    await openFile();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toContain("Counting off"),
    );

    act(() => {
      audio.context.currentTime = 3.1;
    });
    await waitFor(() => expect(screen.getByText("4 clicks free")).toBeTruthy());
    expect(screen.getByRole("option", { name: "Bar 1" }).getAttribute("aria-selected")).toBe("true");
    act(() => {
      audio.context.currentTime = 5.1;
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "Bar 1" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Ready"));
    expect(screen.getByRole("option", { name: "Bar 1" }).getAttribute("aria-selected")).toBe("true");
  });

  it("reports worklet errors and permits an explicit fresh retry", async () => {
    audio.create.mockRejectedValueOnce(new Error("Worklet unavailable"));
    render(<ClickPage />);
    await openFile();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Worklet unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toContain("Counting off"),
    );
    await act(async () => audio.listener?.({ type: "failed", message: "Audio processor failed" }));
    expect(screen.getByRole("alert").textContent).toBe("Audio processor failed");
    expect(audio.dispose).toHaveBeenCalledOnce();
  });
});
