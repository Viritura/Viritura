import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickEngineEvent } from "@viritura/audio/click";
import score from "../../../../packages/format/fixtures/mnx/c-major-scale.mnx?raw";
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
  it("opens MNX without audio, counts off on Play, resumes in place, and restarts after Stop", async () => {
    render(<ClickPage />);
    await openFile();
    expect(screen.getByRole("heading", { name: "practice.mnx" })).toBeTruthy();
    expect(screen.getByText("Bar 1, 4 clicks free")).toBeTruthy();
    expect(audio.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Play", exact: true }));
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

    fireEvent.click(screen.getByRole("button", { name: "Pause", exact: true }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Paused"));
    fireEvent.click(screen.getByRole("button", { name: "Resume", exact: true }));
    await waitFor(() => expect(audio.start).toHaveBeenLastCalledWith(0.75));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Click player" }).getAttribute("aria-busy")).toBe("false"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop", exact: true }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Ready"));
    fireEvent.click(screen.getByRole("button", { name: "Play", exact: true }));
    await waitFor(() => expect(audio.load).toHaveBeenCalledTimes(2));
    expect(audio.start).toHaveBeenLastCalledWith();
  });

  it("clears the previous file and reports invalid MNX instead of playing stale data", async () => {
    render(<ClickPage />);
    await openFile();
    await openFile("{}", "invalid.mnx");
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "practice.mnx" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play", exact: true })).toBeNull();
    expect(audio.create).not.toHaveBeenCalled();
  });

  it("uses a 0–100% tempo scale and requires a positive tempo to play", async () => {
    render(<ClickPage />);
    await openFile();

    const slider = screen.getByRole("slider", { name: "Session tempo %" });
    const play = screen.getByRole("button", { name: "Play", exact: true });
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe("100");

    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByText("0%")).toBeTruthy();
    expect(play.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status", { name: "Playback status" }).textContent).toBe("Set tempo above 0% to play");
    fireEvent.click(play);
    expect(audio.create).not.toHaveBeenCalled();

    fireEvent.change(slider, { target: { value: "1" } });
    expect(screen.getByText(/Quarter = 1\.2/)).toBeTruthy();
    expect(play.hasAttribute("disabled")).toBe(false);

    fireEvent.change(slider, { target: { value: "50" } });
    expect(screen.getByText(/Quarter = 60/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset to 100%" }));
    expect(screen.getByText(/Quarter = 120/)).toBeTruthy();

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

  it("reports worklet errors and permits an explicit fresh retry", async () => {
    audio.create.mockRejectedValueOnce(new Error("Worklet unavailable"));
    render(<ClickPage />);
    await openFile();
    fireEvent.click(screen.getByRole("button", { name: "Play", exact: true }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Worklet unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Play", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Playback status" }).textContent).toContain("Counting off"),
    );
    await act(async () => audio.listener?.({ type: "failed", message: "Audio processor failed" }));
    expect(screen.getByRole("alert").textContent).toBe("Audio processor failed");
    expect(audio.dispose).toHaveBeenCalledOnce();
  });
});
