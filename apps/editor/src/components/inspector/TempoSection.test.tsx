import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipPrimitives } from "@viritura/ui";
import type { Tempo } from "@viritura/core";
import { TempoSection } from "./TempoSection";

afterEach(cleanup);

function setup(tempo: Tempo = { bpm: 90, value: { base: "quarter" } }) {
  const handlers = {
    onBpmChange: vi.fn(),
    onValueBaseChange: vi.fn(),
    onDotsChange: vi.fn(),
    onTextChange: vi.fn(),
    onShowTextChange: vi.fn(),
    onShowMetronomeChange: vi.fn(),
    onSwingChange: vi.fn(),
  };
  render(
    <TooltipPrimitives.Provider>
      <TempoSection tempo={tempo} {...handlers} />
    </TooltipPrimitives.Provider>,
  );
  return handlers;
}

describe("tempo inspector hierarchy", () => {
  it("puts metronome controls before playback, with printed text and visibility together under Appearance", () => {
    setup();
    const bpm = screen.getByRole("spinbutton", { name: "BPM" });
    const playback = screen.getByRole("group", { name: "Playback" });
    const appearance = screen.getByRole("group", { name: "Appearance" });
    expect(bpm.compareDocumentPosition(playback) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(playback.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(appearance.contains(screen.getByRole("textbox", { name: "Printed text" }))).toBe(true);
    expect(appearance.contains(screen.getByRole("checkbox", { name: "Show metronome mark" }))).toBe(true);
  });

  it("keeps beat unit and dots editable independently of BPM and swing", async () => {
    const user = userEvent.setup();
    const handlers = setup();
    await user.click(screen.getByRole("combobox", { name: "Beat unit" }));
    await user.click(screen.getByRole("option", { name: "half" }));
    expect(handlers.onValueBaseChange).toHaveBeenCalledWith("half");
    await user.click(screen.getByRole("combobox", { name: "Dots" }));
    await user.click(screen.getByRole("option", { name: "2 dots" }));
    expect(handlers.onDotsChange).toHaveBeenCalledWith(2);
    expect(handlers.onBpmChange).not.toHaveBeenCalled();
    expect(handlers.onSwingChange).not.toHaveBeenCalled();
  });

  it("displays existing less-common metronome values rather than replacing them with a placeholder", () => {
    setup({ bpm: 90, value: { base: "64th", dots: 3 } });
    expect(screen.getByRole("combobox", { name: "Beat unit" }).textContent).toContain("64th");
    expect(screen.getByRole("combobox", { name: "Dots" }).textContent).toContain("3 dots");
  });

  it("keeps BPM-free tempo instructions editable without showing or inventing a metronome value", () => {
    setup({
      swing: { mode: "swing", subdivision: "16th", ratio: [7, 4] },
      text: [{ text: "Keep moving" }],
    });
    expect(screen.queryByRole("spinbutton", { name: "BPM" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Beat unit" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Show metronome mark" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Custom ratio" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Printed text" }).textContent).toBe("Keep moving");
  });
});
