import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EffectiveStaffMeter } from "@viritura/core";
import { StaffMeterSection } from "../components/inspector/StaffMeterSection";
import type { StaffMeterInspectorState } from "../components/inspector/useStaffMeterInspector";

afterEach(cleanup);

function effectiveMeter(count: number, unit: number): EffectiveStaffMeter {
  return {
    staff: 1,
    timeSignature: { count, unit },
    synchronization: "sharedDuration",
    ratioToGlobal: { num: 1, den: 1 },
  };
}

function makeState(overrides: Partial<StaffMeterInspectorState>): StaffMeterInspectorState {
  return {
    isAvailable: true,
    measureIndex: 0,
    partIndex: 0,
    staff: 1,
    staffLabel: "Staff 1",
    globalTimeSignature: { count: 4, unit: 4 },
    effective: undefined,
    issue: undefined,
    handleSetStaffMeter: () => {},
    handleResetToGlobal: () => {},
    ...overrides,
  };
}

/** Mirrors NotationInspector's `<StaffMeterSection key={...} state={...} />`
 *  wiring so the identity key changes exactly when it would in the real
 *  inspector — this is what forces React to remount (and thus reset the
 *  local draft state) across a staff/measure selection change. */
function keyFor(state: StaffMeterInspectorState): string {
  return `${state.partIndex}:${state.measureIndex}:${state.staff}:${state.effective?.timeSignature.count}:${state.effective?.timeSignature.unit}:${state.effective?.synchronization}`;
}

function countInputValue(): string {
  return (screen.getByLabelText("Staff-local meter count") as HTMLInputElement).value;
}

describe("StaffMeterSection draft resync across selection changes", () => {
  it("resets the count/unit drafts when the keyed identity changes to a different staff/measure", () => {
    const state1 = makeState({
      measureIndex: 0,
      partIndex: 0,
      staff: 1,
      effective: effectiveMeter(6, 8),
    });
    const { rerender } = render(<StaffMeterSection key={keyFor(state1)} state={state1} />);

    expect(countInputValue()).toBe("6");

    const state2 = makeState({
      measureIndex: 1,
      partIndex: 0,
      staff: 2,
      effective: effectiveMeter(4, 4),
    });
    rerender(<StaffMeterSection key={keyFor(state2)} state={state2} />);

    // Without a remount, the count input would still read "6" (the first
    // render's local useState draft) even though the selection now targets a
    // different staff/measure whose effective meter is 4/4.
    expect(countInputValue()).toBe("4");
  });

  it("resets the draft back to the placeholder default when moving to a staff with no declaration", () => {
    const state1 = makeState({
      measureIndex: 0,
      partIndex: 0,
      staff: 1,
      effective: effectiveMeter(12, 8),
    });
    const { rerender } = render(<StaffMeterSection key={keyFor(state1)} state={state1} />);
    expect(countInputValue()).toBe("12");

    const state2 = makeState({
      measureIndex: 0,
      partIndex: 0,
      staff: 2,
      effective: undefined,
    });
    rerender(<StaffMeterSection key={keyFor(state2)} state={state2} />);

    // No declaration on staff 2 -> falls back to the component's default
    // draft (6/8), not staff 1's stale 12.
    expect(countInputValue()).toBe("6");
  });

  it("keeps the same key (and therefore the draft) when the identity is unchanged", () => {
    const state = makeState({ measureIndex: 0, partIndex: 0, staff: 1, effective: effectiveMeter(6, 8) });
    const key1 = keyFor(state);
    const key2 = keyFor(makeState({ measureIndex: 0, partIndex: 0, staff: 1, effective: effectiveMeter(6, 8) }));
    expect(key1).toBe(key2);
  });

  it("changes the key when only the effective meter changes at the same selection (e.g. after Apply)", () => {
    const before = keyFor(makeState({ measureIndex: 2, partIndex: 1, staff: 3, effective: effectiveMeter(6, 8) }));
    const after = keyFor(makeState({ measureIndex: 2, partIndex: 1, staff: 3, effective: effectiveMeter(12, 8) }));
    expect(before).not.toBe(after);
  });
});
