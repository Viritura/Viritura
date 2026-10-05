import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipPrimitives } from "@viritura/ui";
import type { Part } from "@viritura/core";
import { TranspositionPitchFields, type TranspositionPitchFieldsProps } from "./index";
import { RosterPartRow } from "../roster/RosterPartRow";

afterEach(cleanup);

function ControlledFields(props: TranspositionPitchFieldsProps) {
  const [interval, setInterval] = useState({ halfSteps: props.halfSteps, staffDistance: props.staffDistance });
  return (
    <TranspositionPitchFields
      instrumentId={props.instrumentId}
      {...interval}
      onChange={(halfSteps, staffDistance) => {
        setInterval({ halfSteps, staffDistance });
        props.onChange(halfSteps, staffDistance);
      }}
    />
  );
}

describe("pitch transposition fields", () => {
  it("offers common spellings while retaining an existing uncommon enharmonic", async () => {
    const user = userEvent.setup();
    render(<TranspositionPitchFields halfSteps={1} staffDistance={0} onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Sounding pitch" }));
    expect(screen.getAllByRole("option")).toHaveLength(18);
    expect(screen.getByRole("option", { name: "C♭", exact: true })).toBeTruthy();
    expect(screen.getByRole("option", { name: "E♭", exact: true })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "E♯", exact: true })).toBeNull();
    expect(screen.queryByRole("option", { name: "F♭♭", exact: true })).toBeNull();
  });

  it("shows concise presets with a default badge and no duplicate C trumpet", async () => {
    const user = userEvent.setup();
    render(
      <TranspositionPitchFields instrumentId="brass.trumpet.c" halfSteps={0} staffDistance={0} onChange={vi.fn()} />,
    );
    const preset = screen.getByRole("combobox", { name: "Transposition preset" });
    expect(preset.textContent).toBe("Trumpet in CDefault");
    await user.click(preset);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Trumpet in C" }).textContent).toContain("Default");
    expect(screen.queryByRole("option", { name: /—/ })).toBeNull();
  });

  it("does not replace an existing custom interval with an instrument default", () => {
    const onChange = vi.fn();
    render(
      <TranspositionPitchFields
        instrumentId="wind.reed.clarinet.eflat"
        halfSteps={1}
        staffDistance={0}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Written C4 sounds as C♭4")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Transposition preset" }).textContent).toBe("Custom pitch");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Chromatic")).toBeNull();
    expect(screen.queryByLabelText("Staff distance")).toBeNull();
  });

  it("selects a family preset atomically without changing identity", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledFields instrumentId="brass.french-horn" halfSteps={7} staffDistance={4} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Transposition preset" }));
    await user.click(screen.getByRole("option", { name: "Horn in B♭ (basso)" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(14, 8);
    expect(screen.getByText("Written C4 sounds as B♭2")).toBeTruthy();
  });

  it("allows enharmonic spelling and octave changes independently", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledFields halfSteps={-1} staffDistance={0} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Sounding pitch" }));
    await user.click(screen.getByRole("option", { name: "D♭", exact: true }));
    expect(onChange).toHaveBeenLastCalledWith(-1, -1);
    const octave = screen.getByRole("spinbutton", { name: "Sounding octave" });
    await user.clear(octave);
    await user.type(octave, "3");
    expect(onChange).toHaveBeenLastCalledWith(11, 6);
    expect(screen.getByText("Written C4 sounds as D♭3")).toBeTruthy();
  });

  it("preserves uncommon accidentals when customizing octaves", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledFields halfSteps={-3} staffDistance={0} onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Sounding pitch" }).textContent).toBe("C♯♯♯");
    const octave = screen.getByRole("spinbutton", { name: "Sounding octave" });
    await user.clear(octave);
    expect(onChange).not.toHaveBeenCalled();
    await user.type(octave, "3");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(9, 7);
  });

  it("restores an empty octave on blur without replacing the interval", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledFields halfSteps={14} staffDistance={8} onChange={onChange} />);
    const octave = screen.getByRole("spinbutton", { name: "Sounding octave" });
    await user.clear(octave);
    await user.tab();
    expect((octave as HTMLInputElement).value).toBe("2");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("updates from external interval and instrument changes without emitting an edit", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TranspositionPitchFields halfSteps={2} staffDistance={1} onChange={onChange} />);
    rerender(
      <TranspositionPitchFields
        instrumentId="wind.reed.clarinet.eflat"
        halfSteps={-3}
        staffDistance={-2}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Written C4 sounds as E♭4")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Sounding octave" }).getAttribute("value")).toBe("4");
    expect(screen.getByRole("combobox", { name: "Transposition preset" }).textContent).toContain("Default");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Setup roster shared pitch picker", () => {
  it("passes the instrument ID and writes only transposition, retaining written-pitch preference", async () => {
    const part: Part = {
      id: "clarinet",
      name: "My E-flat clarinet",
      shortName: "Custom",
      measures: [],
      _x: { viritura: { instrumentId: "wind.reed.clarinet.eflat" } },
      transposition: {
        interval: { halfSteps: -3, staffDistance: -2 },
        keyFifthsFlipAt: -4,
        prefersWrittenPitches: true,
      },
    };
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider>
        <RosterPartRow part={part} expanded onToggle={() => {}} onUpdate={onUpdate} />
      </TooltipPrimitives.Provider>,
    );
    await user.click(screen.getByRole("combobox", { name: "Transposition preset" }));
    await user.click(screen.getByRole("option", { name: "Alto clarinet in E♭" }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith("clarinet", {
      transposition: {
        interval: { halfSteps: 9, staffDistance: 5 },
        keyFifthsFlipAt: -4,
        prefersWrittenPitches: true,
      },
    });
    expect(part._x?.viritura?.instrumentId).toBe("wind.reed.clarinet.eflat");
    expect(screen.getByLabelText("Name").getAttribute("value")).toBe("My E-flat clarinet");
  });
});
