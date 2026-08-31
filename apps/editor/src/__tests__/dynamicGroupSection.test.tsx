import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DynamicGroup } from "@viritura/core";
import { DynamicGroupSection } from "../components/inspector/DynamicGroupSection";

const hairpin: DynamicGroup = {
  id: "hairpin",
  type: "gradual",
  position: { fraction: [0, 1] },
  end: { measure: "m1", position: { fraction: [1, 1] } },
  wedgeType: "increasing",
  staff: 1,
  staffEnd: 2,
};

const handlers = {
  onValueChange: vi.fn(),
  onResidualValueChange: vi.fn(),
  onAccentPrefixChange: vi.fn(),
  onAccentSuffixChange: vi.fn(),
  onRelativeValueChange: vi.fn(),
  onWedgeTypeChange: vi.fn(),
  onPrefixChange: vi.fn(),
  onSuffixChange: vi.fn(),
  onOrientationChange: vi.fn(),
  onStaffChange: vi.fn(),
  onStaffEndChange: vi.fn(),
  onVisuallyContinuesChange: vi.fn(),
  onVoiceChange: vi.fn(),
  offset: {
    value: [0, 0] as [number, number],
    onChange: vi.fn(),
    onReset: vi.fn(),
    avoidCollisions: { value: true, onChange: vi.fn() },
  },
};

afterEach(cleanup);

describe("DynamicGroupSection staff controls", () => {
  it("uses bounded start/end staff dropdowns for a multi-staff hairpin", () => {
    render(<DynamicGroupSection dynamic={hairpin} staffCount={2} {...handlers} />);

    const startLabel = screen.getByText("Start staff").closest("label");
    const endLabel = screen.getByText("End staff").closest("label");
    expect(startLabel?.querySelector("input")).toBeNull();
    expect(startLabel?.querySelector("button")).not.toBeNull();
    expect(endLabel?.querySelector("input")).toBeNull();
    expect(endLabel?.querySelector("button")).not.toBeNull();
  });

  it("hides redundant staff controls for a single-staff part", () => {
    render(
      <DynamicGroupSection
        dynamic={{ ...hairpin, staff: undefined, staffEnd: undefined }}
        staffCount={1}
        {...handlers}
      />,
    );

    expect(screen.queryByText("Start staff")).toBeNull();
    expect(screen.queryByText("End staff")).toBeNull();
  });

  it("exposes and edits the raw visuallyContinues id", () => {
    const onVisuallyContinuesChange = vi.fn();
    render(
      <DynamicGroupSection
        dynamic={{ ...hairpin, visuallyContinues: "previous-dynamic-id" }}
        staffCount={2}
        {...handlers}
        onVisuallyContinuesChange={onVisuallyContinuesChange}
      />,
    );

    const input = screen.getByDisplayValue("previous-dynamic-id");
    fireEvent.change(input, { target: { value: "replacement-id" } });
    expect(onVisuallyContinuesChange).toHaveBeenCalledWith("replacement-id");
  });

  it("uses a bounded voice selector", () => {
    render(
      <DynamicGroupSection
        dynamic={{ ...hairpin, voice: "v2" }}
        staffCount={2}
        voiceOptions={["v1", "v2"]}
        {...handlers}
      />,
    );

    const voiceLabel = screen.getByText("Voice").closest("label");
    expect(voiceLabel?.querySelector("input")).toBeNull();
    expect(voiceLabel?.querySelector("button")).not.toBeNull();
  });
});
