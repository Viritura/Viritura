import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipPrimitives } from "@viritura/ui";
import { StartCenter } from "../components/StartCenter";

afterEach(cleanup);

const PROJECT_PARENT = { name: "Scores" } as FileSystemDirectoryHandle;
const ALTERNATE_PROJECT_PARENT = { name: "Projects" } as FileSystemDirectoryHandle;

describe("StartCenter samples", () => {
  it("lists the bundled scores under Samples and dispatches the selected score", async () => {
    const onSelectSample = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <StartCenter
          open
          recentScores={[]}
          projectsSupported
          suppressOnLaunch={false}
          onSuppressOnLaunchChange={vi.fn()}
          onSignIn={vi.fn()}
          onOpenAccountSettings={vi.fn()}
          onChooseProjectLocation={vi.fn(async () => null)}
          onNewScore={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFolder={vi.fn()}
          onImport={vi.fn()}
          onSelectRecent={vi.fn()}
          onForgetRecent={vi.fn()}
          onSelectSample={onSelectSample}
          onClose={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByText("Samples")).toBeTruthy();
    expect(screen.getByText("Rhapsody in Blue")).toBeTruthy();
    expect(screen.queryByText("Beethoven 5 Finale")).toBeNull();
    expect(screen.getByText("Beethoven's Symphony No. 5, Mvt. I")).toBeTruthy();
    expect(screen.getByText("Llamigos")).toBeTruthy();
    expect(screen.queryByText("Open Sample…")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Llamigos/ }));
    expect(onSelectSample).toHaveBeenCalledWith(
      expect.objectContaining({ id: "llamigos", file: "caminandes-llamigos-cue.mnx" }),
    );
  });

  it("prioritizes project creation and labels standalone MNX opening explicitly", () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <StartCenter
          open
          recentScores={[]}
          projectsSupported
          suppressOnLaunch={false}
          onSuppressOnLaunchChange={vi.fn()}
          onSignIn={vi.fn()}
          onOpenAccountSettings={vi.fn()}
          onChooseProjectLocation={vi.fn(async () => null)}
          onNewScore={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFolder={vi.fn()}
          onImport={vi.fn()}
          onSelectRecent={vi.fn()}
          onForgetRecent={vi.fn()}
          onSelectSample={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByRole("button", { name: /Recent Projects/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /New Project/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: /Open Project Folder/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open MNX file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
    expect(screen.getByText("Create a blank score, or open a sample below.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
  });

  it("keeps project naming inside the Start Center before invoking creation", async () => {
    const onNewScore = vi.fn(async () => false);
    const onChooseProjectLocation = vi
      .fn<() => Promise<FileSystemDirectoryHandle | null>>()
      .mockResolvedValueOnce(PROJECT_PARENT)
      .mockResolvedValueOnce(ALTERNATE_PROJECT_PARENT);
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <StartCenter
          open
          recentScores={[]}
          projectsSupported
          suppressOnLaunch={false}
          onSuppressOnLaunchChange={vi.fn()}
          onSignIn={vi.fn()}
          onOpenAccountSettings={vi.fn()}
          onChooseProjectLocation={onChooseProjectLocation}
          onNewScore={onNewScore}
          onOpenFile={vi.fn()}
          onOpenFolder={vi.fn()}
          onImport={vi.fn()}
          onSelectRecent={vi.fn()}
          onForgetRecent={vi.fn()}
          onSelectSample={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    await user.click(screen.getByRole("button", { name: /New Project/ }));
    expect(screen.getByRole("button", { name: /New Project/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /Recent Projects/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { name: "New Project" })).toBeTruthy();
    expect(screen.getByLabelText("Project name")).toBeTruthy();
    expect((screen.getByLabelText("Project name") as HTMLInputElement).required).toBe(true);
    expect(screen.getByText("Choose the folder that should contain your new project.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Project name"));
    expect(screen.getByRole("button", { name: "Create project" }).hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("Project name"), "Film Cue 12");
    await user.click(screen.getByLabelText("Project location"));

    expect(onChooseProjectLocation).toHaveBeenCalledOnce();
    expect(onNewScore).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Project location").textContent).toContain("Scores");
    expect(screen.getByText("New folder: Scores / Film Cue 12")).toBeTruthy();

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Film Cue 13");
    expect(screen.getByText("New folder: Scores / Film Cue 13")).toBeTruthy();

    await user.click(screen.getByLabelText("Project location"));
    expect(onChooseProjectLocation).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Project location").textContent).toContain("Projects");

    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(onNewScore).toHaveBeenCalledWith("Film Cue 13", ALTERNATE_PROJECT_PARENT);
    expect(screen.getByRole("heading", { name: "New Project" })).toBeTruthy();
  });

  it("opens directly into the new-project view when requested by a command", () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <StartCenter
          open
          initialView="newProject"
          recentScores={[]}
          projectsSupported
          suppressOnLaunch={false}
          onSuppressOnLaunchChange={vi.fn()}
          onSignIn={vi.fn()}
          onOpenAccountSettings={vi.fn()}
          onChooseProjectLocation={vi.fn(async () => null)}
          onNewScore={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFolder={vi.fn()}
          onImport={vi.fn()}
          onSelectRecent={vi.fn()}
          onForgetRecent={vi.fn()}
          onSelectSample={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByRole("heading", { name: "New Project" })).toBeTruthy();
    expect(screen.getByLabelText("Project name")).toBeTruthy();
  });

  it("shows name validation inline and resets the form when navigating back", async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <StartCenter
          open
          recentScores={[]}
          projectsSupported
          suppressOnLaunch={false}
          onSuppressOnLaunchChange={vi.fn()}
          onSignIn={vi.fn()}
          onOpenAccountSettings={vi.fn()}
          onChooseProjectLocation={vi.fn(async () => null)}
          onNewScore={vi.fn(async () => false)}
          onOpenFile={vi.fn()}
          onOpenFolder={vi.fn()}
          onImport={vi.fn()}
          onSelectRecent={vi.fn()}
          onForgetRecent={vi.fn()}
          onSelectSample={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    await user.click(screen.getByRole("button", { name: /New Project/ }));
    await user.tab();
    expect(screen.queryByText("Enter a project name.")).toBeNull();
    expect(screen.getByText("Choose the folder that should contain your new project.")).toBeTruthy();

    await user.click(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "x");
    await user.clear(screen.getByLabelText("Project name"));
    expect(screen.queryByText("Enter a project name.")).toBeNull();
    await user.tab();
    expect(screen.getByText("Enter a project name.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Recent Projects/ }));
    await user.click(screen.getByRole("button", { name: /New Project/ }));
    await user.type(screen.getByLabelText("Project name"), "Cue:12");
    expect(screen.queryByText(/Project names cannot contain/)).toBeNull();
    await user.tab();
    expect(screen.getByText(/Project names cannot contain/)).toBeTruthy();
    expect(screen.queryByText("Choose the folder that should contain your new project.")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Recent Projects/ }));
    expect(screen.queryByRole("heading", { name: "Recent projects" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /New Project/ }));
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("");
  });

  it("explains project alternatives when folder access is unavailable", () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <StartCenter
          open
          recentScores={[]}
          projectsSupported={false}
          suppressOnLaunch={false}
          onSuppressOnLaunchChange={vi.fn()}
          onSignIn={vi.fn()}
          onOpenAccountSettings={vi.fn()}
          onChooseProjectLocation={vi.fn(async () => null)}
          onNewScore={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenFolder={vi.fn()}
          onImport={vi.fn()}
          onSelectRecent={vi.fn()}
          onForgetRecent={vi.fn()}
          onSelectSample={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipPrimitives.Provider>,
    );

    expect(screen.getByRole("button", { name: /New Project/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Open Project Folder/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Create project" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Open this app in Chrome or Edge/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open MNX file" }).hasAttribute("disabled")).toBe(false);
  });
});
