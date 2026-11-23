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
