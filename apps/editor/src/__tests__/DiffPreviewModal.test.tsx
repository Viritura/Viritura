import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DiffPreviewModal } from "../components/DiffPreviewModal";

// Mock Monaco DiffEditor - it requires a browser DOM
vi.mock("@viritura/monaco-react", () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="mock-diff-editor" data-original={original} data-modified={modified} />
  ),
}));

afterEach(cleanup);

const ORIGINAL = JSON.stringify({ mnx: { version: 1 }, global: { measures: [{}] }, parts: [] }, null, 2);
const PROPOSED = JSON.stringify({ mnx: { version: 1 }, global: { measures: [{}, {}] }, parts: [] }, null, 2);

describe("DiffPreviewModal", () => {
  it("renders the modal overlay and diff editor", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<DiffPreviewModal originalMnx={ORIGINAL} proposedMnx={PROPOSED} onAccept={onAccept} onReject={onReject} />);

    expect(screen.getByTestId("diff-preview-modal")).toBeTruthy();
    expect(screen.getByTestId("mock-diff-editor")).toBeTruthy();
    expect(screen.getByText("Preview AI Changes")).toBeTruthy();
  });

  it("calls onAccept when Accept button is clicked", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<DiffPreviewModal originalMnx={ORIGINAL} proposedMnx={PROPOSED} onAccept={onAccept} onReject={onReject} />);

    fireEvent.click(screen.getByTestId("diff-accept-btn"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("calls onReject when Reject button is clicked", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<DiffPreviewModal originalMnx={ORIGINAL} proposedMnx={PROPOSED} onAccept={onAccept} onReject={onReject} />);

    fireEvent.click(screen.getByTestId("diff-reject-btn"));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("passes original and proposed MNX to the diff editor", () => {
    render(<DiffPreviewModal originalMnx={ORIGINAL} proposedMnx={PROPOSED} onAccept={vi.fn()} onReject={vi.fn()} />);

    const diffEditor = screen.getByTestId("mock-diff-editor");
    expect(diffEditor.getAttribute("data-original")).toBe(ORIGINAL);
    expect(diffEditor.getAttribute("data-modified")).toBe(PROPOSED);
  });

  it("shows line counts in stats bar", () => {
    render(<DiffPreviewModal originalMnx={ORIGINAL} proposedMnx={PROPOSED} onAccept={vi.fn()} onReject={vi.fn()} />);

    const origLines = ORIGINAL.split("\n").length;
    const propLines = PROPOSED.split("\n").length;
    expect(screen.getByText(`Current: ${origLines} lines`)).toBeTruthy();
    expect(screen.getByText(`Proposed: ${propLines} lines`)).toBeTruthy();
  });
});
