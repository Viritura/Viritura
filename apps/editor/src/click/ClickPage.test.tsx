import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ClickEngineEvent } from "@viritura/audio/click";
import type { ScorePosition, ScoreViewerProps } from "@viritura/score-viewer-react";
import score from "../../../../packages/format/fixtures/mnx/c-major-scale.mnx?raw";
import rehearsals from "../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import multipleLayouts from "../../../../packages/format/fixtures/mnx/multiple-layouts.mnx?raw";
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

vi.mock("@viritura/score-viewer-react", () => ({
  ScoreViewer: ({ children, mnx, useWorker, defaultViewMode, scoreIndex, zoom, fitMode }: ScoreViewerProps) => (
    <div
      data-testid="score-viewer"
      data-mnx={mnx}
      data-worker={useWorker}
      data-mode={defaultViewMode}
      data-score-index={scoreIndex}
      data-zoom={zoom}
      data-fit={fitMode}
    >
      {children}
    </div>
  ),
  ScoreView: {
    Playhead: ({
      position,
      follow,
    }: {
      position: Extract<ScorePosition, { measureIndex: number }>;
      follow: boolean;
    }) => (
      <div data-testid="playhead" data-measure={position.measureIndex} data-beat={position.beat} data-follow={follow} />
    ),
  },
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

async function openFile(text = score, name = "practice.mnx", expandNavigation = true) {
  fireEvent.change(screen.getByLabelText("MNX file"), {
    target: { files: [new File([text], name, { type: "application/json" })] },
  });
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Click player" }).getAttribute("aria-busy")).toBe("false"),
  );
  const navigation = screen.queryByRole("button", { name: "Bar navigation", exact: true });
  if (expandNavigation && navigation?.getAttribute("aria-expanded") === "false") fireEvent.click(navigation);
}

describe("standalone click page", () => {
  it("selects authored scores and source parts from the top nav without restarting a take", async () => {
    const user = userEvent.setup();
    render(<ClickPage />);
    await openFile(multipleLayouts, "choir.mnx", false);
    const nav = within(screen.getByRole("banner"));
    const selector = nav.getByRole("combobox", { name: "Score or part" });
    const viewer = screen.getByTestId("score-viewer");
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    await user.click(selector);
    await user.click(screen.getByRole("option", { name: "TwoStaffSplit", exact: true }));
    expect(viewer.dataset.scoreIndex).toBe("1");
    expect(viewer.dataset.mnx).toBe(multipleLayouts);
    await user.click(selector);
    await user.click(screen.getByRole("option", { name: "Alto", exact: true }));
    const partView = JSON.parse(viewer.dataset.mnx!) as { parts: { name: string }[] };
    expect(partView.parts.map((part) => part.name)).toEqual(["Alto"]);
    expect(audio.start).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledOnce();
  });

  it("exposes zoom and fit in the top nav and resets the view when another file opens", async () => {
    render(<ClickPage />);
    await openFile(score, "scale.mnx", false);
    const nav = within(screen.getByRole("banner"));
    const viewer = screen.getByTestId("score-viewer");
    fireEvent.click(nav.getByRole("button", { name: "Zoom in", exact: true }));
    expect(viewer.dataset.zoom).toBe("1.2");
    expect(nav.getByLabelText("Score zoom").textContent).toBe("120%");
    fireEvent.click(nav.getByRole("button", { name: "Zoom to fit", exact: true }));
    expect(viewer.dataset.fit).toBe("height");
    fireEvent.click(nav.getByRole("button", { name: "Zoom out", exact: true }));
    expect(viewer.dataset.zoom).toBe("1");
    expect(viewer.dataset.fit).toBe("none");
    fireEvent.click(nav.getByRole("button", { name: "Zoom in", exact: true }));
    await openFile(rehearsals, "rehearsals.mnx", false);
    expect(screen.getByTestId("score-viewer").dataset.zoom).toBe("1");
    expect(screen.getByTestId("score-viewer").dataset.scoreIndex).toBe("0");
    expect(screen.getByTestId("score-viewer").dataset.fit).toBe("height");
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("keeps the transport compact and expands the two navigation tracks on demand", async () => {
    render(<ClickPage />);
    await openFile(rehearsals, "rehearsals.mnx", false);
    expect(screen.queryByRole("listbox", { name: "Start bar" })).toBeNull();
    const navigation = screen.getByRole("button", { name: "Bar navigation", exact: true });
    expect(navigation.textContent).toContain("A / Bar 1");
    fireEvent.click(navigation);
    expect(screen.getByRole("listbox", { name: "Rehearsal" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Bar 3, rehearsal B" }));
    fireEvent.click(navigation);
    expect(screen.queryByRole("listbox", { name: "Start bar" })).toBeNull();
    expect(navigation.textContent).toContain("B / Bar 3");
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("uses the score as its main surface and follows the click clock without restarting audio", async () => {
    render(<ClickPage />);
    await openFile();
    const viewer = screen.getByTestId("score-viewer");
    const playhead = screen.getByTestId("playhead");
    expect(viewer.dataset.mnx).toBe(score);
    expect(viewer.dataset.worker).toBe("true");
    expect(viewer.dataset.mode).toBe("horizon");
    expect(playhead.dataset.follow).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Bar 2" }));
    expect(playhead.dataset.measure).toBe("1");
    expect(playhead.dataset.beat).toBe("0");
    fireEvent.click(screen.getByRole("option", { name: "Bar 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    act(() => {
      audio.context.currentTime = 2;
    });
    await waitFor(() => expect(screen.getByText("Counting off 3 of 4")).toBeTruthy());
    expect(playhead.dataset.beat).toBe("0");
    act(() => {
      audio.context.currentTime = 5.25;
    });
    await waitFor(() => expect(playhead.dataset.measure).toBe("1"));
    expect(Number(playhead.dataset.beat)).toBeCloseTo(0.5);
    expect(audio.start).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(playhead.dataset.measure).toBe("0"));
    expect(playhead.dataset.beat).toBe("0");
  });

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
    expect(screen.queryByTestId("score-viewer")).toBeNull();
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

  it("shows the selected start's meter and scaled tempo alongside its countoff", async () => {
    const mixedMeter = JSON.parse(score) as {
      global: {
        measures: {
          time?: { count: number; unit: number };
          tempos?: { bpm: number; value: { base: string } }[];
        }[];
      };
    };
    mixedMeter.global.measures[1]!.time = { count: 3, unit: 4 };
    mixedMeter.global.measures[1]!.tempos = [{ bpm: 90, value: { base: "quarter" } }];
    render(<ClickPage />);
    await openFile(JSON.stringify(mixedMeter));
    const details = within(screen.getByRole("group", { name: "Selected start" }));
    expect(details.getByText("4/4")).toBeTruthy();
    expect(details.getByText("Quarter = 120")).toBeTruthy();
    expect(screen.getByText("4 clicks free")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Bar 2" }));
    expect(details.getByText("3/4")).toBeTruthy();
    expect(details.getByText("Quarter = 90")).toBeTruthy();
    expect(screen.getByText("3 clicks free")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Session tempo %" }), { target: { value: "50" } });
    expect(details.getByText("Quarter = 45")).toBeTruthy();
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
    expect(screen.getByText("Quarter = 0")).toBeTruthy();
    expect(play.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Set tempo above 0% to start");
    fireEvent.click(play);
    expect(audio.create).not.toHaveBeenCalled();

    fireEvent.change(slider, { target: { value: "1" } });
    expect(screen.getByText("1%")).toBeTruthy();
    expect(screen.getByText("Quarter = 1.2")).toBeTruthy();
    expect(play.hasAttribute("disabled")).toBe(false);

    fireEvent.change(slider, { target: { value: "50" } });
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset to 100%" })).toBeNull();
    fireEvent.change(slider, { target: { value: "100" } });
    expect(within(screen.getByRole("region", { name: "Click player" })).getByText("100%")).toBeTruthy();

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
