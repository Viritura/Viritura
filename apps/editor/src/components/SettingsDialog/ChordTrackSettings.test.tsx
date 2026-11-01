// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectedChordTrackSettings } from "../ChordTrack";
import { useViewStateStore } from "../../store/viewStateStore";
import { SettingsDialog } from "./SettingsDialog";
import { availableCategories } from "./settingsCategories";
import { filterCategories } from "./categoryFilter";
import { useSettingsCategoryStore } from "./settingsCategoryStore";

const initialView = useViewStateStore.getState();
const initialCategory = useSettingsCategoryStore.getState();
afterEach(() => {
  cleanup();
  useViewStateStore.setState(initialView);
  useSettingsCategoryStore.setState(initialCategory);
});

describe("global chord-track settings", () => {
  it.each(["chords", "harmony", "entry grid", "audition", "quarter", "alt drag"])(
    "finds chord-track preferences by searching %s",
    (query) => {
      const matches = filterCategories(availableCategories(), query);
      expect(matches.some((category) => category.id === "chord-track" && category.group === "General")).toBe(true);
    },
  );

  it("offers preferences in the global dialog with the lane hidden and no document", async () => {
    const user = userEvent.setup();
    useViewStateStore.setState({ chordTrackEnabled: false, chordTrackGrid: "quarter", chordTrackAudition: true });
    useSettingsCategoryStore.setState({ activeCategoryId: "chord-track" });
    render(<SettingsDialog open onClose={() => {}} />);
    expect(screen.queryByRole("switch", { name: "Sticky CHORDS header" })).toBeNull();
    expect(screen.queryByText(/The track displays and accepts/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Chord entry grid" }).textContent).toContain("Quarter");
    fireEvent.click(screen.getByRole("switch", { name: "Audition chords" }));
    expect(useViewStateStore.getState().chordTrackAudition).toBe(false);
    await user.click(screen.getByRole("combobox", { name: "Chord entry grid" }));
    await user.click(await screen.findByRole("option", { name: "Sixteenths", exact: true }));
    expect(useViewStateStore.getState().chordTrackGrid).toBe("sixteenth");
    expect(useViewStateStore.getState().chordTrackEnabled).toBe(false);
  });

  it("keeps both surfaces synchronized without duplicate panel IDs", () => {
    const category = availableCategories().find((candidate) => candidate.id === "chord-track")!;
    const GlobalPanel = category.Panel;
    useViewStateStore.setState({ chordTrackAudition: true });
    render(
      <>
        <ConnectedChordTrackSettings />
        <GlobalPanel />
      </>,
    );
    const panels = screen.getAllByRole("region", { name: "Chord settings" });
    expect(panels.map((panel) => panel.id)).toEqual(["chord-settings-panel", "settings-chord-track-controls"]);
    fireEvent.click(within(panels[0]!).getByRole("switch", { name: "Audition chords" }));
    expect(within(panels[1]!).getByRole<HTMLInputElement>("switch", { name: "Audition chords" }).checked).toBe(false);
    fireEvent.click(within(panels[1]!).getByRole("switch", { name: "Audition chords" }));
    expect(within(panels[0]!).getByRole<HTMLInputElement>("switch", { name: "Audition chords" }).checked).toBe(true);
    act(() => useViewStateStore.getState().setChordTrackGrid("eighth"));
    for (const panel of panels) {
      expect(within(panel).getByRole("combobox", { name: "Chord entry grid" }).textContent).toContain("Eighths");
    }
  });
});
