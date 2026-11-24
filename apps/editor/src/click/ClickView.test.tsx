import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ClickEngineEvent } from "@viritura/audio/click";
import type { ScorePosition, ScoreViewerProps } from "@viritura/score-viewer-react";
import score from "../../../../packages/format/fixtures/mnx/c-major-scale.mnx?raw";
import rehearsals from "../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import multipleLayouts from "../../../../packages/format/fixtures/mnx/multiple-layouts.mnx?raw";
import { ClickView } from "./index";
import { useClickPlayer } from "./useClickPlayer";
import { keyboardRegistry } from "../keyboard/KeyboardRegistry";

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

const playback = vi.hoisted(() => ({
  releaseAudio: vi.fn(async () => {}),
  statusListener: undefined as ((status: string) => void) | undefined,
}));

vi.mock("@viritura/playback", () => ({
  usePlaybackActions: () => ({ releaseAudio: playback.releaseAudio }),
  subscribePlaybackStatus: (listener: (status: string) => void) => {
    playback.statusListener = listener;
    return () => {
      playback.statusListener = undefined;
    };
  },
}));

vi.mock("@viritura/score-viewer-react", () => ({
  useScoreView: () => ({
    viewer: null,
    engine: null,
    displayList: null,
    pagePositions: [],
    zoom: 1,
  }),
  ScoreViewer: ({ children, mnx, useWorker, viewMode, scoreIndex, zoom, fitMode }: ScoreViewerProps) => (
    <div
      data-testid="score-viewer"
      data-mnx={mnx}
      data-worker={useWorker}
      data-mode={viewMode}
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
      follow: boolean | "page";
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

async function renderClick(text = score) {
  const view = render(<ClickView mnx={text} />);
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Click player" }).getAttribute("aria-busy")).toBe("false"),
  );
  return view;
}

function settings() {
  return screen.getByRole("group", { name: "Click settings" });
}

/** Pausing before release prevents a dial drag from flinging past its target. */
async function holdStill(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

describe("click activity", () => {
  it("reports a score bar without a full playback visit and clears the error after a valid selection", async () => {
    const { result } = renderHook(() => useClickPlayer(rehearsals));
    act(() => result.current.selectScoreMeasure(99));
    expect(result.current.error).toContain("no full-bar visit");
    expect(result.current.startBar).toBe(0);
    act(() => result.current.selectScoreMeasure(2));
    expect(result.current.startBar).toBe(2);
    expect(result.current.error).toBe("");
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("selects scores and parts before playback and preserves the selected view while the nav is hidden", async () => {
    const user = userEvent.setup();
    await renderClick(multipleLayouts);
    const nav = within(settings());
    const selector = nav.getByRole("combobox", { name: "Score or part" });
    const viewer = screen.getByTestId("score-viewer");
    await user.click(selector);
    await user.click(screen.getByRole("option", { name: "TwoStaffSplit", exact: true }));
    expect(viewer.dataset.scoreIndex).toBe("1");
    expect(viewer.dataset.mnx).toBe(multipleLayouts);
    await user.click(selector);
    await user.click(screen.getByRole("option", { name: "Alto", exact: true }));
    const partView = JSON.parse(viewer.dataset.mnx!) as { parts: { name: string }[] };
    expect(partView.parts.map((part) => part.name)).toEqual(["Alto"]);
    expect(audio.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    expect(screen.queryByRole("group", { name: "Click settings" })).toBeNull();
    expect(screen.getByTestId("score-viewer")).toBe(viewer);
    expect(JSON.parse(viewer.dataset.mnx!)).toEqual(partView);
    expect(audio.start).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledOnce();
  });

  it("switches page, spread, horizontal spread, and horizon without restarting audio", async () => {
    const user = userEvent.setup();
    await renderClick();
    const viewer = screen.getByTestId("score-viewer");
    const selector = screen.getByRole("combobox", { name: "View mode" });
    for (const [label, mode] of [
      ["Page", "page"],
      ["Spread", "spread"],
      ["Horizon", "horizon"],
      ["Spread (H)", "spread-horizontal"],
    ]) {
      await user.click(selector);
      await user.click(screen.getByRole("option", { name: label, exact: true }));
      expect(viewer.dataset.mode).toBe(mode);
      expect(viewer.dataset.fit).toBe(mode === "horizon" ? "height" : "page");
    }
    expect(audio.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    expect(screen.queryByRole("combobox", { name: "View mode" })).toBeNull();
    expect(screen.getByTestId("score-viewer")).toBe(viewer);
    expect(viewer.dataset.mode).toBe("spread-horizontal");
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "View mode" })).toBeTruthy());
    expect(viewer.dataset.mode).toBe("spread-horizontal");
    expect(audio.start).toHaveBeenCalledOnce();
  });

  it("exposes zoom and fit in the settings bar and keeps the view across document edits", async () => {
    const user = userEvent.setup();
    const { rerender } = await renderClick(score);
    const nav = within(settings());
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
    await user.click(nav.getByRole("combobox", { name: "View mode" }));
    await user.click(screen.getByRole("option", { name: "Spread", exact: true }));
    rerender(<ClickView mnx={rehearsals} />);
    expect(screen.getByTestId("score-viewer").dataset.mnx).toBe(rehearsals);
    expect(screen.getByTestId("score-viewer").dataset.zoom).toBe("1.2");
    expect(screen.getByTestId("score-viewer").dataset.scoreIndex).toBe("0");
    expect(screen.getByTestId("score-viewer").dataset.fit).toBe("page");
    expect(screen.getByTestId("score-viewer").dataset.mode).toBe("spread");
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("replaces navigation and settings with the current bar and Stop during playback", async () => {
    await renderClick(rehearsals);
    const transport = within(screen.getByRole("region", { name: "Click player" }));
    expect(transport.getByRole("listbox", { name: "Start bar" })).toBeTruthy();
    expect(transport.getByRole("listbox", { name: "Rehearsal" })).toBeTruthy();
    expect(transport.queryByRole("slider", { name: "Session tempo %" })).toBeNull();
    const tempo = within(settings()).getByRole("slider", { name: "Session tempo %" });
    expect(tempo).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Bar 3, rehearsal B" }));
    expect(transport.getByRole("option", { name: "Bar 3, rehearsal B" }).getAttribute("aria-selected")).toBe("true");
    expect(audio.create).not.toHaveBeenCalled();
    fireEvent.click(transport.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    expect(tempo.closest("fieldset")?.disabled).toBe(true);
    await waitFor(() => expect(transport.getByRole("status", { name: "Current bar" }).textContent).toBe("3"));
    expect(screen.queryByRole("group", { name: "Click settings" })).toBeNull();
    expect(transport.queryByRole("listbox")).toBeNull();
    expect(transport.queryByRole("radiogroup", { name: "Countoff" })).toBeNull();
    expect(transport.queryByRole("group", { name: "Selected start" })).toBeNull();
    expect(transport.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Click player" }).dataset.compact).toBe("true");
    fireEvent.click(transport.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(transport.getByRole("listbox", { name: "Start bar" })).toBeTruthy());
    expect(settings()).toBeTruthy();
    expect(within(settings()).getByRole("slider", { name: "Session tempo %" })).toBe(tempo);
    expect(transport.getByRole("listbox", { name: "Rehearsal" })).toBeTruthy();
    expect(transport.getByRole("radiogroup", { name: "Countoff" })).toBeTruthy();
    expect(transport.getByRole("option", { name: "Bar 3, rehearsal B" }).getAttribute("aria-selected")).toBe("true");
    expect(transport.queryByRole("status", { name: "Current bar" })).toBeNull();
    expect(screen.getByRole("region", { name: "Click player" }).dataset.compact).toBeUndefined();
  });

  it("uses the score as its main surface and follows the click clock without restarting audio", async () => {
    await renderClick();
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
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Counting off"),
    );
    expect(playhead.dataset.beat).toBe("0");
    act(() => {
      audio.context.currentTime = 5.25;
    });
    await waitFor(() => expect(playhead.dataset.measure).toBe("1"));
    expect(Number(playhead.dataset.beat)).toBeCloseTo(0.5);
    expect(audio.start).toHaveBeenCalledOnce();
    expect(audio.load).toHaveBeenCalledOnce();
    audio.stop.mockResolvedValueOnce(4.25);
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Ready"));
    expect(playhead.dataset.measure).toBe("1");
    expect(playhead.dataset.beat).toBe("0");
  });

  it("loads the open document without audio and toggles Start and Stop with a fresh countoff", async () => {
    await renderClick();
    const navigation = within(settings());
    expect(navigation.getByRole("heading", { name: "Click" })).toBeTruthy();
    expect(navigation.queryByRole("button", { name: "Open MNX" })).toBeNull();
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
    expect(settings()).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Start bar" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Current bar" })).toBeNull();
  });

  it("reports an invalid document instead of playing stale data", async () => {
    const { rerender } = await renderClick();
    rerender(<ClickView mnx="{}" />);
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(screen.queryByTestId("score-viewer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start", exact: true })).toBeNull();
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("shows an empty state when no document is open", () => {
    render(<ClickView mnx="" />);
    expect(screen.getByText("Open or create a score to set up a click track.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Click player" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Click settings" })).toBeNull();
  });

  it("adopts document edits only while stopped and keeps a valid start bar", async () => {
    const { rerender } = await renderClick(rehearsals);
    fireEvent.click(screen.getByRole("option", { name: "Bar 3, rehearsal B" }));
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    const edited = JSON.stringify(JSON.parse(rehearsals));
    rerender(<ClickView mnx={edited} />);
    expect(screen.getByTestId("score-viewer").dataset.mnx).toBe(rehearsals);
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByTestId("score-viewer").dataset.mnx).toBe(edited));
    expect(screen.getByRole("option", { name: "Bar 3, rehearsal B" }).getAttribute("aria-selected")).toBe("true");
    rerender(<ClickView mnx={score} />);
    expect(screen.getByRole("option", { name: "Bar 1" }).getAttribute("aria-selected")).toBe("true");
  });

  it("releases editor audio before the click engine is created", async () => {
    const order: string[] = [];
    playback.releaseAudio.mockImplementation(async () => {
      order.push("release");
    });
    audio.create.mockImplementationOnce(async () => {
      order.push("create");
      return { ...audio, onEvent: () => () => {} };
    });
    await renderClick();
    expect(playback.releaseAudio).toHaveBeenCalled();
    order.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    expect(order).toEqual(["release", "create"]);
  });

  it("releases editor audio again if instrument playback starts while open", async () => {
    await renderClick();
    playback.releaseAudio.mockClear();
    act(() => playback.statusListener?.("playing"));
    expect(playback.releaseAudio).toHaveBeenCalledOnce();
  });

  it("toggles the click with Space ahead of the editor play/pause shortcut", async () => {
    const editorPlay = vi.fn();
    const teardownEditor = keyboardRegistry.register({
      id: "test.editorPlayPause",
      key: "Space",
      context: "global",
      when: () => true,
      handler: editorPlay,
    });
    const uninstall = keyboardRegistry.install();
    try {
      await renderClick();
      fireEvent.keyDown(document.body, { key: " ", code: "Space" });
      await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
      fireEvent.keyDown(document.body, { key: " ", code: "Space" });
      await waitFor(() => expect(audio.stop).toHaveBeenCalledOnce());
      expect(editorPlay).not.toHaveBeenCalled();
    } finally {
      uninstall();
      teardownEditor();
    }
  });

  it("toggles the countoff cue and plays both bars before the selected start", async () => {
    await renderClick();
    const transport = within(screen.getByRole("region", { name: "Click player" }));
    expect(transport.queryByText("Countoff", { exact: true })).toBeNull();
    expect(transport.getByRole("radiogroup", { name: "Countoff" })).toBeTruthy();
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
    expect(screen.queryByRole("radiogroup", { name: "Countoff" })).toBeNull();
    act(() => {
      audio.context.currentTime = 4.6;
    });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Counting off"),
    );
    expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("2");
    act(() => {
      audio.context.currentTime = 5.1;
    });
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Playing"));
    expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByText("8 clicks free")).toBeTruthy());
    expect(screen.getByRole("radio", { name: "2 bars" }).getAttribute("aria-checked")).toBe("true");
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
    await renderClick(JSON.stringify(mixedMeter));
    const startDetails = screen.getByRole("group", { name: "Selected start" });
    const details = within(startDetails);
    expect(startDetails.textContent).toBe("4/4Quarter = 120");
    expect(details.getByText("4/4")).toBeTruthy();
    expect(details.getByText("Quarter = 120")).toBeTruthy();
    expect(screen.getByText("4 clicks free")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Bar 2" }));
    expect(startDetails.textContent).toBe("3/4Quarter = 90");
    expect(details.getByText("3/4")).toBeTruthy();
    expect(details.getByText("Quarter = 90")).toBeTruthy();
    expect(screen.getByText("3 clicks free")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Session tempo %" }), { target: { value: "50" } });
    expect(details.getByText("Quarter = 45")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "2 bars" }));
    expect(screen.getByText("6 clicks free")).toBeTruthy();
  });

  it("uses a 0–100% tempo scale and requires a positive tempo to start", async () => {
    await renderClick();

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
    expect(screen.getByRole("status", { name: "Session tempo percentage" }).textContent).toBe("100%");

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
    await renderClick(rehearsals);
    const dial = screen.getByRole("listbox", { name: "Start bar" });
    const play = screen.getByRole("button", { name: "Start", exact: true });

    fireEvent.pointerDown(dial, { pointerId: 1, pointerType: "touch", clientX: 300 });
    expect(play.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerMove(dial, { pointerId: 1, clientX: 140 });
    expect(play.hasAttribute("disabled")).toBe(true);
    await holdStill();
    fireEvent.pointerUp(dial, { pointerId: 1, clientX: 140 });
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
    await waitFor(() => expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("3"));
  });

  it("selects a repeated bar visit rather than silently starting its first occurrence", async () => {
    const repeated = JSON.parse(score) as {
      global: { measures: { repeatStart?: object; repeatEnd?: object }[] };
    };
    repeated.global.measures[0]!.repeatStart = {};
    repeated.global.measures[1]!.repeatEnd = {};
    await renderClick(JSON.stringify(repeated));
    fireEvent.click(screen.getByRole("option", { name: "Bar 1, visit 2 of 2" }));
    fireEvent.change(screen.getByRole("slider", { name: "Session tempo %" }), { target: { value: "50" } });
    expect(screen.getByRole("option", { name: "Bar 1, visit 2 of 2" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.load).toHaveBeenCalledWith(expect.any(Array), 12));
    await waitFor(() => expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("1"));
    expect(screen.getByRole("status", { name: "Current bar" }).getAttribute("aria-description")).toBe(
      "Bar 1, visit 2 of 2",
    );
    audio.stop.mockResolvedValueOnce(8.5);
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start", exact: true })).toBeTruthy());
    expect(screen.getByRole("option", { name: "Bar 2, visit 2 of 2" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.load).toHaveBeenLastCalledWith(expect.any(Array), 8));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop", exact: true })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start", exact: true })).toBeTruthy());
    expect(screen.getByRole("option", { name: "Bar 2, visit 2 of 2" }).getAttribute("aria-selected")).toBe("true");
  });

  it("scrolls through rehearsals independently and synchronizes the selected bar", async () => {
    await renderClick(rehearsals);
    const rehearsalTrack = screen.getByRole("listbox", { name: "Rehearsal" });
    const barTrack = screen.getByRole("listbox", { name: "Start bar" });
    expect(within(rehearsalTrack).getAllByRole("option")).toHaveLength(4);
    fireEvent.pointerDown(rehearsalTrack, { pointerId: 1, pointerType: "touch", clientX: 300 });
    fireEvent.pointerMove(rehearsalTrack, { pointerId: 1, clientX: 220 });
    expect(within(barTrack).getByRole("option", { name: "Bar 1, rehearsal A" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Start", exact: true }).hasAttribute("disabled")).toBe(true);
    await holdStill();
    fireEvent.pointerUp(rehearsalTrack, { pointerId: 1, clientX: 220 });
    await waitFor(() =>
      expect(within(barTrack).getByRole("option", { name: "Bar 3, rehearsal B" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(
      within(rehearsalTrack).getByRole("option", { name: "Rehearsal B, Bar 3" }).getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.click(within(barTrack).getByRole("option", { name: "Bar 2" }));
    expect(
      within(rehearsalTrack).getByRole("option", { name: "Rehearsal A, Bar 1" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(within(barTrack).getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps Start disabled until both tracks have settled", async () => {
    await renderClick(rehearsals);
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

  it("follows the current performed bar without showing navigation or restarting the playing take", async () => {
    await renderClick(rehearsals);
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    act(() => {
      audio.context.currentTime = 7.1;
    });
    await waitFor(() => expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("3"));
    expect(screen.queryByRole("listbox", { name: "Rehearsal" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Start bar" })).toBeNull();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.start).toHaveBeenCalledOnce();
  });

  it("uses the acknowledged Stop position even ahead of the UI clock and restarts that bar with a countoff", async () => {
    await renderClick();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toContain("Counting off"),
    );

    act(() => {
      audio.context.currentTime = 3.1;
    });
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Playing"));
    expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("1");

    audio.stop.mockResolvedValueOnce(4.1);
    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Ready"));
    expect(screen.getByRole("option", { name: "Bar 2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("playhead").dataset.measure).toBe("1");
    expect(screen.getByTestId("playhead").dataset.beat).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() =>
      expect(audio.load).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          { time: 0, level: "accent" },
          { time: 2, level: "accent" },
        ]),
        4,
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Counting off"),
    );
    expect(screen.getByRole("status", { name: "Current bar" }).textContent).toBe("2");
  });

  it("reports worklet errors and permits an explicit fresh retry", async () => {
    audio.create.mockRejectedValueOnce(new Error("Worklet unavailable"));
    await renderClick();
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Worklet unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Start", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toContain("Counting off"),
    );
    await act(async () => audio.listener?.({ type: "failed", message: "Audio processor failed" }));
    expect(screen.getByRole("alert").textContent).toBe("Audio processor failed");
    expect(settings()).toBeTruthy();
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(screen.getByRole("listbox", { name: "Start bar" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Current bar" })).toBeNull();
  });
});
