import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDocumentStore } from "../store/documentStore";
import { useDocumentStoreApi } from "../store/DocumentContext";
import { McpProposalReview } from "./McpProposalReview";
import { useMcpSessionStore, type McpProposal } from "./sessionStore";

vi.mock("../store/DocumentContext", () => ({ useDocumentStoreApi: vi.fn() }));
vi.mock("@viritura/monaco-react", () => ({ DiffEditor: () => <div data-testid="mock-diff-editor" /> }));

const MNX = '{"mnx":{"version":1},"global":{"measures":[{}]},"parts":[]}';
const PROPOSED = '{"mnx":{"version":1},"global":{"measures":[{},{}]},"parts":[]}';
let documentStore: ReturnType<typeof createDocumentStore>;

beforeEach(() => {
  useMcpSessionStore.setState(useMcpSessionStore.getInitialState());
  documentStore = createDocumentStore();
  documentStore.getState().commitDocument(MNX);
  vi.mocked(useDocumentStoreApi).mockReturnValue(documentStore);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stage(mode: "diff" | "patch" | "document") {
  const proposal: McpProposal = {
    id: "proposal-1",
    summary: "Test change",
    originalMnx: documentStore.getState().mnxJson,
    originalRevision: documentStore.getState().scoreRevision,
    proposedMnx: mode === "diff" ? PROPOSED : null,
    patches: [],
    status: "pending",
    ...(mode === "document" ? { document: { proposedMnx: PROPOSED, diff: { metrics: [] } } } : {}),
  };
  useMcpSessionStore.getState().addProposal(proposal);
}

describe.each(["diff", "patch", "document"] as const)("%s MCP proposal review", (mode) => {
  it("ignores outside clicks without rejecting, then allows explicit rejection", async () => {
    const user = userEvent.setup();
    stage(mode);
    render(<McpProposalReview />);

    const overlay = document.querySelector<HTMLElement>("[data-dialog-overlay]")!;
    await user.click(overlay);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(useMcpSessionStore.getState().proposals["proposal-1"]?.status).toBe("pending");
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(useMcpSessionStore.getState().proposals["proposal-1"]?.status).toBe("rejected");
  });

  it("retains Escape as explicit rejection", async () => {
    const user = userEvent.setup();
    stage(mode);
    render(<McpProposalReview />);

    await user.keyboard("{Escape}");

    expect(useMcpSessionStore.getState().proposals["proposal-1"]?.status).toBe("rejected");
  });

  it("accepts once through the normal commit path", async () => {
    const user = userEvent.setup();
    const commit = vi.spyOn(documentStore.getState(), mode === "document" ? "commitDocument" : "commitPatches");
    stage(mode);
    render(<McpProposalReview />);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(useMcpSessionStore.getState().proposals["proposal-1"]?.status).toBe("accepted");
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("refuses stale proposals without committing", async () => {
    const user = userEvent.setup();
    stage(mode);
    documentStore.getState().commitDocument(PROPOSED);
    const commit = vi.spyOn(documentStore.getState(), mode === "document" ? "commitDocument" : "commitPatches");
    render(<McpProposalReview />);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(useMcpSessionStore.getState().proposals["proposal-1"]?.status).toBe("stale");
    expect(commit).not.toHaveBeenCalled();
  });
});
