import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { StyleWorkbench } from "./StyleWorkbench";

afterEach(cleanup);

describe("style workbench", () => {
  it("keeps the edited profile when changing the preview and allows switching profiles", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" />);

    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: /^Horn in F/ }));
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
    render(<StyleWorkbench initialDestination="house" />);

    await user.click(screen.getByRole("combobox", { name: "Staff size" }));
    await user.click(screen.getByRole("option", { name: "8 mm" }));
    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: /^Cello/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("combobox", { name: "Inside margin" }).textContent).toContain("20 mm");
    expect(screen.getByRole("combobox", { name: "Staff size" }).textContent).toContain("8 mm");
  });

  it("resets a layout override and jumps along the source trail", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench />);

    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: /^Cello/ }));
    await user.click(screen.getByRole("button", { name: /^Bar numbers/ }));
    expect(screen.getByRole("combobox", { name: "Frequency" }).textContent).toContain("Every bar");
    await user.click(screen.getByRole("button", { name: "Frequency actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset to System starts" }));
    expect(screen.getByRole("combobox", { name: "Frequency" }).textContent).toContain("System starts");

    const trail = screen.getByRole("list", { name: "Frequency sources" });
    await user.click(within(trail).getByRole("button", { name: "House: System starts" }));
    expect(screen.getByText("Editing house style")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Editing" }).textContent).toContain("Shared settings");
  });

  it("shows house values as the baseline and resets edits to the selected preset", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" />);

    await user.click(screen.getByRole("combobox", { name: "Editing" }));
    await user.click(screen.getByRole("option", { name: "Shared settings" }));
    await user.click(screen.getByRole("button", { name: /^Bar numbers/ }));
    expect(screen.queryByText("Default")).toBeNull();
    expect(screen.queryByRole("list", { name: "Frequency sources" })).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Frequency" }));
    await user.click(screen.getByRole("option", { name: "Hidden" }));
    await user.click(screen.getByRole("button", { name: "Frequency actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset to System starts" }));
    expect(screen.getByRole("combobox", { name: "Frequency" }).textContent).toContain("System starts");
  });

  it("shows downstream custom settings and clears them so house edits propagate", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench initialDestination="house" />);

    await user.click(screen.getByRole("combobox", { name: "Editing" }));
    await user.click(screen.getByRole("option", { name: "Shared settings" }));
    await user.click(screen.getByRole("button", { name: /^Bar numbers/ }));
    expect(screen.getByRole("button", { name: "Cello custom setting" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Frequency actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Clear 1 downstream custom setting" }));
    expect(screen.queryByRole("button", { name: "Frequency actions" })).toBeNull();
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
    await user.click(screen.getByRole("option", { name: /^Cello/ }));
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

  it("shows layout role, profile, and custom count in the single layout picker", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench />);

    expect(screen.queryByText("Layout switching")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    const cello = screen.getByRole("option", { name: /^Cello · Part/ });
    expect(cello.textContent).toContain("Part · 2 custom");
    expect(screen.getByRole("option", { name: /^Full score · Score/ }).textContent).toContain("Score · 1 custom");
  });

  it("groups field reset and promotion actions in one menu", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench />);

    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: /^Cello · Part/ }));
    await user.click(screen.getByRole("button", { name: "Inside margin actions" }));
    expect(screen.getByRole("menuitem", { name: "Reset to 15 mm" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Move to Part" }));

    expect(screen.getByRole("combobox", { name: "Inside margin" }).textContent).toContain("20 mm");
    expect(screen.queryByRole("button", { name: "Inside margin actions" })).toBeNull();
  });

  it("groups section reset and copy actions in one menu", async () => {
    const user = userEvent.setup();
    render(<StyleWorkbench />);

    await user.click(screen.getByRole("combobox", { name: "Active layout" }));
    await user.click(screen.getByRole("option", { name: /^Cello · Part/ }));
    await user.click(screen.getByRole("button", { name: "Page and staff actions" }));
    expect(screen.getByRole("menuitem", { name: "Reset section" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy settings to layouts" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Reset section" }));

    expect(screen.getByRole("combobox", { name: "Inside margin" }).textContent).toContain("15 mm");
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
    await user.click(screen.getByRole("option", { name: /^Cello/ }));
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
