// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChordSymbolText } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { TooltipPrimitives } from "@viritura/ui";
import userEvent from "@testing-library/user-event";
import { ChordTrackPrototype } from "./ChordTrackPrototype";
import { paintTrackSystem } from "./trackPainter";

vi.mock("./trackPainter", () => ({
  paintTrackSystem: vi.fn(),
  laneTop: () => 12,
}));

const displayList: DisplayList = {
  width: 700,
  height: 300,
  commands: [],
  measureBounds: [
    {
      index: 0,
      partIndex: 0,
      partId: "melody",
      staffIndex: 0,
      systemIndex: 0,
      x: 100,
      y: 140,
      width: 300,
      height: 48,
      prefixWidth: 40,
      totalBeats: 4,
      beatAnchors: [
        [0, 140],
        [1, 210],
        [2, 320],
        [4, 400],
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("isolated chord track editing", () => {
  it("disables Horizon-only placement settings in the wrapped-system prototype", () => {
    render(<ChordTrackPrototype displayList={displayList} initialChords={[]} viewMode="page" />, {
      wrapper: TooltipPrimitives.Provider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Chord settings" }));
    expect(screen.getByRole<HTMLInputElement>("switch", { name: "Sticky chord track" }).disabled).toBe(true);
    expect(screen.getByRole("combobox", { name: "Chord track position" }).getAttribute("data-disabled")).not.toBeNull();
  });

  it("paints a temporary fine ruler during Alt dragging and restores the Quarter grid after a drop", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 400));
    const initial = [{ measureIndex: 0, symbol: parseChordSymbolText("Cmaj7", { fraction: [0, 1] }) }];
    render(<ChordTrackPrototype displayList={displayList} initialChords={initial} viewMode="horizon" />, {
      wrapper: TooltipPrimitives.Provider,
    });
    function pointer(type: string, x: number, altKey = false) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 30,
        button: 0,
        buttons: 1,
        altKey,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    }
    const source = screen.getByRole("button", { name: "Chord Cmaj7, bar 1, beat 1" });
    fireEvent(source, pointer("pointerdown", 105));
    fireEvent(window, pointer("pointermove", 178));
    expect(screen.getByText("Move to bar 1, beat 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    expect(screen.getByText("Move to bar 1, beat 2.25")).toBeTruthy();
    expect(vi.mocked(paintTrackSystem).mock.lastCall?.[0].points).toHaveLength(16);
    fireEvent(window, pointer("pointerup", 178, true));
    expect(screen.getByRole("button", { name: "Bar 1, beat 2.25, Cmaj7" })).toBeTruthy();
    expect(vi.mocked(paintTrackSystem).mock.lastCall?.[0].points).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Chord settings" }));
    expect(screen.getByRole("combobox", { name: "Chord entry grid" }).textContent).toContain("Quarter");
    expect(screen.queryByRole("switch", { name: "Sticky CHORDS header" })).toBeNull();
  });

  it("steps by bars with Space on a fine grid and keeps semicolon stepping by beats", async () => {
    const user = userEvent.setup();
    const twoBars: DisplayList = {
      ...displayList,
      width: 1100,
      measureBounds: [
        ...displayList.measureBounds!,
        {
          ...displayList.measureBounds![0]!,
          index: 1,
          x: 400,
          beatAnchors: [
            [0, 440],
            [1, 510],
            [2, 620],
            [4, 700],
          ],
        },
      ],
    };
    render(
      <ChordTrackPrototype
        displayList={twoBars}
        initialChords={[{ measureIndex: 1, symbol: parseChordSymbolText("G7", { fraction: [0, 1] }) }]}
        viewMode="horizon"
      />,
      { wrapper: TooltipPrimitives.Provider },
    );
    fireEvent.click(screen.getByRole("button", { name: "Chord settings" }));
    await user.click(screen.getByRole("combobox", { name: "Chord entry grid" }));
    await user.click(await screen.findByRole("option", { name: "Sixteenths", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Bar 1, beat 2, add chord" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "F7" } });
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByText("Chord · Bar 2, beat 1")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("G7");
    expect(screen.getByRole("button", { name: "Bar 1, beat 2, F7" })).toBeTruthy();
    fireEvent.keyDown(window, { key: ";" });
    expect(screen.getByText("Chord · Bar 2, beat 2")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C7" } });
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    expect(screen.getByText("Chord · Bar 1, beat 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bar 2, beat 2, C7" })).toBeTruthy();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Bar 1, beat 1, add chord" })).toBeTruthy();
  });

  it("selects on click or Space and edits on Enter", () => {
    const initial = [{ measureIndex: 0, symbol: parseChordSymbolText("Cmaj7", { fraction: [0, 1] }) }];
    render(<ChordTrackPrototype displayList={displayList} initialChords={initial} viewMode="horizon" />, {
      wrapper: TooltipPrimitives.Provider,
    });
    const chord = screen.getByRole("button", { name: "Chord Cmaj7, bar 1, beat 1" });
    fireEvent.click(chord);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(chord, { key: " " });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(chord, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("adds a chord at an empty tick without selecting a score event", () => {
    render(<ChordTrackPrototype displayList={displayList} initialChords={[]} viewMode="horizon" />, {
      wrapper: TooltipPrimitives.Provider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Bar 1, beat 2, add chord" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Dm7" } });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Bar 1, beat 2, Dm7" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("replaces, removes, and resets local mock chords", () => {
    const initial = [{ measureIndex: 0, symbol: parseChordSymbolText("Cmaj7", { fraction: [0, 1] }) }];
    render(<ChordTrackPrototype displayList={displayList} initialChords={initial} viewMode="horizon" />, {
      wrapper: TooltipPrimitives.Provider,
    });
    fireEvent.doubleClick(screen.getByRole("button", { name: "Bar 1, beat 1, Cmaj7" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "G7" } });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.doubleClick(screen.getByRole("button", { name: "Bar 1, beat 1, G7" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove chord" }));
    expect(screen.getByRole("button", { name: "Bar 1, beat 1, add chord" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset mock chords" }));
    expect(screen.getByRole("button", { name: "Bar 1, beat 1, Cmaj7" })).toBeTruthy();
  });

  it("keeps chord-label editing available on a finer grid and cancels without mutation", async () => {
    const user = userEvent.setup();
    const initial = [{ measureIndex: 0, symbol: parseChordSymbolText("Cmaj7", { fraction: [0, 1] }) }];
    render(<ChordTrackPrototype displayList={displayList} initialChords={initial} viewMode="horizon" />, {
      wrapper: TooltipPrimitives.Provider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Chord settings" }));
    await user.click(screen.getByRole("combobox", { name: "Chord entry grid" }));
    await user.click(await screen.findByRole("option", { name: "Sixteenths", exact: true }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Chord Cmaj7, bar 1, beat 1" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "G7" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Bar 1, beat 1, Cmaj7" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bar 1, beat 1, G7" })).toBeNull();
  });
});
