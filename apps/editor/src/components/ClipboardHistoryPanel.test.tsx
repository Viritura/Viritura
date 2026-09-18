import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TooltipPrimitives } from "@viritura/ui";
import { ClipboardHistoryPanel } from "./ClipboardHistoryPanel";
import { writeClipboardFragment } from "../clipboard/notationClipboard";
import { FRAGMENT_VERSION, type ClipboardFragment } from "../clipboard/ClipboardFragment";
import { addClipboardEntry, clearClipboardHistory } from "../store/clipboardHistoryStore";

vi.mock("../clipboard/notationClipboard", () => ({ writeClipboardFragment: vi.fn() }));
vi.mock("../store/historyStore", () => ({ useHistoryStore: () => 0 }));
vi.mock("./UndoHistorySection", () => ({ UndoHistorySection: () => null }));
vi.mock("./ClipboardPreview", () => ({ ClipboardPreview: () => <span>Score preview</span> }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

function fragment(): ClipboardFragment {
  return {
    type: "viritura/fragment",
    version: FRAGMENT_VERSION,
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    content: [{ type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 1 } }] }],
    clef: { sign: "F", staffPosition: 2 },
    transposition: { interval: { halfSteps: 12, staffDistance: 7 }, prefersWrittenPitches: true },
  };
}

function renderPanel(): void {
  render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <ClipboardHistoryPanel />
    </TooltipPrimitives.Provider>,
  );
}

beforeEach(() => {
  clearClipboardHistory();
  vi.mocked(writeClipboardFragment).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  clearClipboardHistory();
  vi.resetAllMocks();
});

describe("clipboard history interoperability", () => {
  it("restores the complete fragment through the shared notation adapter", async () => {
    const source = fragment();
    addClipboardEntry(source);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Score preview/ }));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    expect(writeClipboardFragment).toHaveBeenCalledExactlyOnceWith(source, expect.any(Function));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows export warnings without treating a successful JSON restore as failure", async () => {
    vi.mocked(writeClipboardFragment).mockImplementation(async (_fragment, warn) => {
      warn?.("Unsupported notation was preserved as Viritura JSON.");
    });
    addClipboardEntry(fragment());
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Score preview/ }));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith("Unsupported notation was preserved as Viritura JSON.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports clipboard write failures without showing a successful restore", async () => {
    vi.mocked(writeClipboardFragment).mockRejectedValue(new Error("Clipboard unavailable"));
    addClipboardEntry(fragment());
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Score preview/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not restore this clipboard entry."));
    expect(screen.queryByText("Copied")).toBeNull();
  });
});
