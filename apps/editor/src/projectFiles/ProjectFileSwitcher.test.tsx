import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useProjectStore } from "../store/projectStore";
import { DocumentProvider } from "../store/DocumentContext";
import { useGistSetlistStore, type LoadedGistSetlist } from "../gistShare";
import { ProjectFileSwitcher } from "./ProjectFileSwitcher";
import { useProjectFileSwitchStore } from "./projectFileSwitchStore";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const originalRescan = useProjectStore.getState().rescanProjectScores;
const first = { name: "one.mnx", relativePath: "one.mnx" };
const second = { name: "two.mnx", relativePath: "two.mnx" };

afterEach(() => {
  cleanup();
  useProjectStore.setState({ projectScores: [], activeScorePath: null, rescanProjectScores: originalRescan });
  useProjectFileSwitchStore.setState({ switchTo: null, switching: false });
  useGistSetlistStore.getState().clear();
  vi.restoreAllMocks();
});

it("can discover new scores when the project initially contains only one", async () => {
  const rescan = vi.fn(async () => useProjectStore.setState({ projectScores: [first, second] }));
  useProjectStore.setState({
    projectScores: [first],
    activeScorePath: first.relativePath,
    rescanProjectScores: rescan,
  });
  useProjectFileSwitchStore.setState({ switchTo: vi.fn(async () => true) });
  const user = userEvent.setup();
  render(
    <DocumentProvider>
      <ProjectFileSwitcher />
    </DocumentProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Select project file: one" }));
  expect(rescan).toHaveBeenCalledOnce();
  expect(await screen.findByRole("option", { name: "two" })).toBeTruthy();
});

it("reports unexpected errors from a score switch", async () => {
  const failure = new Error("Save failed unexpectedly");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  useProjectStore.setState({ projectScores: [first, second], activeScorePath: first.relativePath });
  useProjectFileSwitchStore.setState({ switchTo: vi.fn(async () => Promise.reject(failure)) });
  const user = userEvent.setup();
  render(
    <DocumentProvider>
      <ProjectFileSwitcher />
    </DocumentProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Select project file: one" }));
  await user.click(screen.getByRole("option", { name: "two" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not switch project scores"));
  expect(log).toHaveBeenCalledWith("Project score switch failed:", failure);
});

it("reports a failed project rescan", async () => {
  const failure = new Error("Permission denied");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  useProjectStore.setState({
    projectScores: [first],
    activeScorePath: first.relativePath,
    rescanProjectScores: vi.fn(async () => Promise.reject(failure)),
  });
  useProjectFileSwitchStore.setState({ switchTo: vi.fn(async () => true) });
  const user = userEvent.setup();
  render(
    <DocumentProvider>
      <ProjectFileSwitcher />
    </DocumentProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Select project file: one" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not refresh project files"));
  expect(log).toHaveBeenCalledWith("Could not refresh project files:", failure);
});

it("routes Gist selection through the guarded file switcher", async () => {
  const setlist = { files: [{ fileName: "one.mnx" }, { fileName: "two.mnx" }] } as LoadedGistSetlist;
  useGistSetlistStore.getState().open(setlist, 0);
  const switchTo = vi.fn(async () => true);
  useProjectFileSwitchStore.setState({ switchTo });
  const user = userEvent.setup();
  render(
    <DocumentProvider>
      <ProjectFileSwitcher />
    </DocumentProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Select setlist file: one" }));
  await user.click(screen.getByRole("option", { name: "two" }));
  expect(switchTo).toHaveBeenCalledWith("two.mnx");
});
