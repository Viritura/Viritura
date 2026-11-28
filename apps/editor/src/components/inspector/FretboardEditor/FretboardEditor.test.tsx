import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Fretboard } from "@viritura/core";
import { FretboardEditor } from "./FretboardEditor";

afterEach(cleanup);

it("keeps a lower barre endpoint when editing the played fret on that string", () => {
  const value: Fretboard = {
    partId: "guitar",
    frameStrings: 6,
    frameFrets: 5,
    frameNotes: [
      { string: 6, fret: 3, barre: "start" },
      { string: 1, fret: 3, barre: "stop" },
      { string: 1, fret: 5 },
    ],
  };
  const onChange = vi.fn();
  render(<FretboardEditor partId="guitar" value={value} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Set string 1 to fret 4" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply diagram" }));

  expect(onChange).toHaveBeenCalledWith({
    ...value,
    frameNotes: [
      { string: 6, fret: 3, barre: "start" },
      { string: 1, fret: 3, barre: "stop" },
      { string: 1, fret: 4 },
    ],
  });
});

it("removes synthetic barre contacts when clearing a barre endpoint", () => {
  const value: Fretboard = {
    partId: "guitar",
    frameStrings: 6,
    frameFrets: 5,
    frameNotes: [
      { string: 6, fret: 3, barre: "start" },
      { string: 1, fret: 3, barre: "stop" },
      { string: 1, fret: 5 },
    ],
  };
  const onChange = vi.fn();
  render(<FretboardEditor partId="guitar" value={value} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Set string 1 to fret 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply diagram" }));

  expect(onChange).toHaveBeenCalledWith({
    ...value,
    frameNotes: [
      { string: 6, fret: 3 },
      { string: 1, fret: 5 },
    ],
  });
});

it.each(["open", "unplayed"])("preserves the other played endpoint when setting a string to %s", (state) => {
  const value: Fretboard = {
    partId: "guitar",
    frameStrings: 6,
    frameFrets: 5,
    frameNotes: [
      { string: 6, fret: 3, barre: "start" },
      { string: 1, fret: 3, barre: "stop" },
      { string: 1, fret: 5 },
    ],
  };
  const onChange = vi.fn();
  render(<FretboardEditor partId="guitar" value={value} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: `Set string 1 to ${state}` }));
  fireEvent.click(screen.getByRole("button", { name: "Apply diagram" }));

  expect(onChange).toHaveBeenCalledWith({
    ...value,
    frameNotes: [{ string: 6, fret: 3 }, ...(state === "open" ? [{ string: 1, fret: 0 }] : [])],
  });
});
