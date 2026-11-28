import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { StyleWorkbench } from "./StyleWorkbench";

afterEach(cleanup);

describe("style workbench", () => {
  it("keeps the edited profile when changing the preview and allows switching profiles", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" initialNavigator="list" />);

    await user.click(screen.getByRole("button", { name: "View Horn in F" }));
    expect(screen.getByText(/Horn in F uses Large-print part/)).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("combobox", { name: "Editing" }).textContent).toContain(
      "Part profile",
    );

    await user.click(screen.getByRole("button", { name: "Edit Large-print part" }));
    expect(within(screen.getByRole("main")).getByRole("combobox", { name: "Editing" }).textContent).toContain(
      "Large-print part profile",
    );
    expect(screen.queryByText(/Horn in F uses Large-print part/)).toBeNull();

    await user.click(within(screen.getByRole("main")).getByRole("combobox", { name: "Editing" }));
    await user.click(screen.getByRole("option", { name: "Shared settings" }));
    expect(screen.queryByRole("button", { name: /^Page and staff/ })).toBeNull();
    expect(screen.getByRole("img", { name: "Horn in F first page" })).toBeTruthy();
  });

  it("updates profile previews while preserving layout overrides", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" initialNavigator="list" />);

    await user.click(screen.getByRole("combobox", { name: "Staff size" }));
    await user.click(screen.getByRole("option", { name: "8 mm" }));
    expect(
      within(screen.getByRole("navigation", { name: "Layouts" })).getAllByText("Part / 5 pp").length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /View Cello/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("combobox", { name: "Inside margin" }).textContent).toContain("20 mm");
    expect(screen.getByRole("combobox", { name: "Staff size" }).textContent).toContain("8 mm");
  });

  it("can pin an inherited value and restore inheritance", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" />);

    await user.click(screen.getByRole("button", { name: "Customize orientation" }));
    await user.click(screen.getByRole("button", { name: "Use inherited orientation" }));
    expect(screen.getByRole("button", { name: "Customize orientation" })).toBeTruthy();
  });

  it("opens house style from the project bar instead of a layout tab", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench />);

    const main = screen.getByRole("main");
    expect(
      within(main)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Layout", "Selection"]);
    expect(within(main).getByRole("combobox", { name: "Layout profile" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit house style" }));
    expect(within(main).queryAllByRole("tab")).toHaveLength(0);
    expect(within(main).getByText("Editing house style")).toBeTruthy();

    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: "Cello" }));
    expect(within(main).getByText("Editing house style")).toBeTruthy();
    expect(within(main).getByRole("combobox", { name: "Editing" }).textContent).toContain("Part profile");
    expect(screen.getByRole("img", { name: "Cello first page" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(within(main).getByRole("heading", { name: "Cello" })).toBeTruthy();
  });

  it("keeps the preview focused on one layout with no all-layouts toggle", () => {
    render(<StyleWorkbench />);

    expect(screen.queryByRole("radiogroup", { name: "Preview mode" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "All layouts" })).toBeNull();
    expect(screen.getByRole("img", { name: "Violin I first page" })).toBeTruthy();
  });

  it("applies built-in presets without saving project edits and preserves layout overrides", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" />);

    await user.click(screen.getByRole("combobox", { name: "Staff size" }));
    await user.click(screen.getByRole("option", { name: "8 mm" }));
    await user.click(screen.getByRole("button", { name: "Presets" }));
    let dialog = screen.getByRole("dialog", { name: "House style presets" });
    expect(within(dialog).getByRole("button", { name: /^Classical/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Film/ })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /save/i })).toBeNull();
    expect(within(dialog).getByText(/Your house style edits and profiles will be replaced/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /^Film/ }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("combobox", { name: "Staff size" }).textContent).toContain("8 mm");

    await user.click(screen.getByRole("button", { name: "Presets" }));
    dialog = screen.getByRole("dialog", { name: "House style presets" });
    await user.click(within(dialog).getByRole("button", { name: /^Film/ }));
    await user.click(within(dialog).getByRole("button", { name: "Apply Film" }));
    expect(screen.getByRole("combobox", { name: "Staff size" }).textContent).toContain("6.5 mm");

    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: "Cello" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("combobox", { name: "Inside margin" }).textContent).toContain("20 mm");
    expect(screen.getByRole("combobox", { name: "Staff size" }).textContent).toContain("6.5 mm");

    await user.click(screen.getByRole("button", { name: "Undo change" }));
    expect(screen.getByRole("combobox", { name: "Staff size" }).textContent).toContain("8 mm");
    expect(screen.getByRole("combobox", { name: "Inside margin" }).textContent).toContain("20 mm");
  });

  it("searches across collapsed sections and restores them when cleared", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" />);

    expect(screen.queryByRole("combobox", { name: "Slur thickness" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Search settings" }), "thickness");
    expect(screen.getByRole("combobox", { name: "Slur thickness" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Tie placement" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Staff size" })).toBeNull();

    await user.clear(screen.getByRole("textbox", { name: "Search settings" }));
    expect(screen.queryByRole("combobox", { name: "Slur thickness" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Staff size" })).toBeTruthy();
  });
});
