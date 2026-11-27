import { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseMnx } from "@viritura/format";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentProvider, useDocumentStoreApi } from "../store/DocumentContext";
import { useProjectStore } from "../store/projectStore";
import { GistShareDialog } from "./GistShareDialog";

const mocks = vi.hoisted(() => ({ create: vi.fn(), signIn: vi.fn() }));
vi.mock("../github/useGitHubAccount", () => ({
  useGitHubAccount: () => ({ session: { connected: true, viewer: { login: "musician" } }, signIn: mocks.signIn }),
}));
vi.mock("../github/api", () => ({ createGitHubGist: mocks.create }));

const MNX = JSON.stringify({ mnx: { version: 1 }, global: { measures: [] }, parts: [] });
const ID = "0123456789abcdef0123456789abcdef";

function LoadedDialog() {
  const store = useDocumentStoreApi();
  useEffect(() => {
    store.getState().loadScore(parseMnx(JSON.parse(MNX)), "score.mnx", MNX);
  }, [store]);
  return <GistShareDialog open onClose={vi.fn()} />;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  useProjectStore.setState({ projectFolder: null, projectScores: [], activeScorePath: null });
});

it("creates a secret Gist and presents the Click setlist link", async () => {
  mocks.create.mockResolvedValue({ id: ID, htmlUrl: `https://gist.github.com/musician/${ID}` });
  const user = userEvent.setup();
  render(
    <DocumentProvider>
      <LoadedDialog />
    </DocumentProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Create secret Gist and link" }));
  expect(mocks.create).toHaveBeenCalledWith({ files: { "score.mnx": MNX } });
  expect((await screen.findByLabelText("Viritura preview link")).getAttribute("value")).toContain(
    `/?open=gist-setlist#id=${ID}`,
  );
});

it("offers reconnect guidance when GitHub rejects the app permission", async () => {
  mocks.create.mockRejectedValue(new Error("Reconnect GitHub to approve Gists permission."));
  const user = userEvent.setup();
  render(
    <DocumentProvider>
      <LoadedDialog />
    </DocumentProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Create secret Gist and link" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Reconnect GitHub");
  await user.click(screen.getByRole("button", { name: "Reconnect GitHub" }));
  expect(mocks.signIn).toHaveBeenCalledWith("activity");
});
