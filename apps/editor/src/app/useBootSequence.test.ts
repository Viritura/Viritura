import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBootSequence } from "./useBootSequence";
import { createDocumentStore } from "../store/documentStore";
import { useOnboardingStore } from "../store/onboardingStore";
import { listRecentScores } from "../store/recentScores";

vi.mock("../store/recentScores", () => ({ listRecentScores: vi.fn(async () => []) }));

beforeEach(() => {
  vi.clearAllMocks();
  useOnboardingStore.setState({ startCenterOpen: false });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "launchQueue");
  window.history.replaceState({}, "", "/");
});

function mount(suppressStartCenter = false) {
  const loadDefaultScore = vi.fn();
  renderHook(() =>
    useBootSequence({
      store: createDocumentStore(),
      loadScore: vi.fn(),
      resetHistory: vi.fn(),
      setFileHandle: vi.fn(),
      loadDefaultScore,
      suppressStartCenter,
    }),
  );
  return loadDefaultScore;
}

describe("startup with OS-launched files", () => {
  it("does not race a launched document with the default sample or Start Center", async () => {
    window.history.replaceState({}, "", "/?open-file=1");
    Object.defineProperty(window, "launchQueue", { configurable: true, value: {} });
    const loadDefaultScore = mount(true);
    await Promise.resolve();
    expect(loadDefaultScore).not.toHaveBeenCalled();
    expect(listRecentScores).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().startCenterOpen).toBe(false);
  });

  it("keeps ordinary startup behavior without a file launch", async () => {
    mount();
    await waitFor(() => expect(useOnboardingStore.getState().startCenterOpen).toBe(true));
    expect(listRecentScores).toHaveBeenCalled();
  });

  it("does not leave unsupported browsers on an empty launch page", async () => {
    window.history.replaceState({}, "", "/?open-file=1");
    mount();
    await waitFor(() => expect(useOnboardingStore.getState().startCenterOpen).toBe(true));
  });
});
