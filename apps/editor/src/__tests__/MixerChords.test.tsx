// @vitest-environment happy-dom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as core from "@viritura/core";
import { type ChordSymbol, type GlobalMeasure, type Score, CHORDS_PART_ID } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { MixerPanel } from "../components/MixerPanel";
import { MIXER_DEFAULT_GAIN, MIXER_MAX_GAIN } from "../store/mixerGain";
import { useMixer, useMixerActions } from "../store/mixerStore";
import mixerStory from "../stories/app/Mixer.stories";

const WARNING = "Unsupported chord: cannot play this symbol.";
const onSoundSourceChange = vi.fn();

function chord(rawText: string): ChordSymbol {
  return { position: { fraction: [0, 1] }, rawText };
}

function scoreWith(measures: GlobalMeasure[] = [{ chordSymbols: [chord("C")] }], count = 2): Score {
  return {
    mnx: { version: 1 },
    global: { measures },
    parts: Array.from({ length: count }, (_, index) => ({
      id: `part-${index}`,
      name: index === 0 ? "Flute" : "Violin",
      measures: [],
    })),
  };
}

function Harness({ score }: { score?: Score | null }) {
  const parts = score?.parts.map((part, index) => ({ index, name: part.name! })) ?? [];
  return (
    <StrictMode>
      <TooltipPrimitives.Provider delayDuration={0}>
        <MixerPanel parts={parts} score={score} onSoundSourceChange={onSoundSourceChange} />
      </TooltipPrimitives.Provider>
    </StrictMode>
  );
}

beforeEach(() => {
  const { result, unmount } = renderHook(useMixerActions);
  act(() => result.current.reset());
  unmount();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Mixer Chords row", () => {
  it.each([
    { name: "no measures", measures: [] },
    { name: "no global symbols", measures: [{}] },
    { name: "empty global symbols", measures: [{ chordSymbols: [] }] },
  ])("omits Chords with $name", ({ measures }) => {
    render(<Harness score={scoreWith(measures)} />);
    expect(screen.queryByRole("slider", { name: "Volume Chords" })).toBeNull();
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(screen.getAllByTestId(/^mixer-channel-/)).toHaveLength(2);
  });

  it.each([undefined, null])("does not invent Chords without a score (%s)", (score) => {
    render(<Harness score={score} />);
    expect(screen.queryByRole("slider", { name: "Volume Chords" })).toBeNull();
  });

  it("ignores legacy part-local symbols", () => {
    const score = scoreWith([{}]);
    const legacyMeasure = { sequences: [], chordSymbols: [chord("H7")] };
    score.parts[0]!.measures = [legacyMeasure];
    render(<Harness score={score} />);
    expect(screen.queryByRole("slider", { name: "Volume Chords" })).toBeNull();
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it.each(["C", "H7", "NC", "N.C."])("appends one row for global %s, with stable ID and no fake Part", (text) => {
    const score = scoreWith([{}, { chordSymbols: [chord(text), chord(text)] }]);
    const original = structuredClone(score);
    Object.freeze(score.parts);
    const state = renderHook(useMixer).result;
    render(<Harness score={score} />);
    const rows = screen.getAllByTestId(/^mixer-channel-/);
    expect(rows).toHaveLength(3);
    const row = rows.at(-1)!;
    expect(row.getAttribute("data-testid")).toBe("mixer-channel-2");
    expect(row.getAttribute("data-part-id")).toBe(CHORDS_PART_ID);
    expect(within(row).getByRole("slider", { name: "Volume Chords" }).textContent).toContain("Chords");
    expect(state.current.channels[2]).toMatchObject({ volume: MIXER_DEFAULT_GAIN, muted: false, solo: false });
    expect(within(row).queryByRole("button", { name: /^Sound for/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /spatial mode/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Sound for/ })).toHaveLength(2);
    expect(score).toEqual(original);
    expect(score.parts.some((part) => part.id === CHORDS_PART_ID)).toBe(false);
    expect(onSoundSourceChange).not.toHaveBeenCalled();
    expect(screen.queryByText(WARNING) !== null).toBe(text === "H7");
  });

  it("uses resolver diagnostics, updates on global edits, and never diagnoses NC", () => {
    const view = render(<Harness score={scoreWith([{ chordSymbols: [chord("C"), chord("NC")] }])} />);
    expect(screen.queryByRole("status")).toBeNull();
    const contradictory: ChordSymbol = { ...chord("C"), root: { step: "D" }, quality: "major" };
    view.rerender(<Harness score={scoreWith([{ chordSymbols: [chord("C")] }, { chordSymbols: [contradictory] }])} />);
    expect(screen.getByRole("status").textContent).toBe(WARNING);
    expect(screen.getAllByText(WARNING)).toHaveLength(1);
    view.rerender(<Harness score={scoreWith([{ chordSymbols: [chord("NC"), chord("N.C.")] }])} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("slider", { name: "Volume Chords" })).toBeTruthy();
  });

  it("uses standard keyboard gain, mute and solo controls without changing authored parts", async () => {
    const user = userEvent.setup();
    const score = scoreWith();
    const before = structuredClone(score);
    const state = renderHook(useMixer).result;
    render(<Harness score={score} />);
    const fader = screen.getByRole("slider", { name: "Volume Chords" });
    expect(fader.getAttribute("aria-valuetext")).toBe("-6.0 dB");
    fader.focus();
    await user.keyboard("{End}");
    expect(state.current.channels[2]!.volume).toBeCloseTo(MIXER_MAX_GAIN);
    await user.keyboard("{Home}");
    expect(state.current.channels[2]!.volume).toBe(0);
    await user.keyboard("{End}{ArrowDown}");
    expect(fader.getAttribute("aria-valuetext")).toBe("+5.5 dB");
    await user.click(screen.getByRole("button", { name: "Mute Chords" }));
    await user.click(screen.getByRole("button", { name: "Solo Chords" }));
    expect(state.current.channels[2]).toMatchObject({ muted: true, solo: true });
    expect(screen.getByTestId("mixer-channel-0").getAttribute("data-dimmed")).toBe("true");
    expect(state.current.channels[0]).toMatchObject({ volume: MIXER_DEFAULT_GAIN, muted: false, solo: false });
    await user.click(screen.getByRole("button", { name: "Mute Chords" }));
    await user.click(screen.getByRole("button", { name: "Solo Chords" }));
    expect(state.current.channels[2]).toMatchObject({ muted: false, solo: false });
    expect(screen.getByTestId("mixer-channel-0").getAttribute("data-dimmed")).toBeNull();
    expect(score).toEqual(before);
    expect(onSoundSourceChange).not.toHaveBeenCalled();
  });

  it("retains hidden settings across removal, remount and real-part count changes", async () => {
    const user = userEvent.setup();
    const state = renderHook(useMixer).result;
    const view = render(<Harness score={scoreWith()} />);
    screen.getByRole("slider", { name: "Volume Chords" }).focus();
    await user.keyboard("{End}");
    await user.click(screen.getByRole("button", { name: "Mute Chords" }));
    await user.click(screen.getByRole("button", { name: "Solo Chords" }));
    const saved = state.current.channels[2];
    view.rerender(<Harness score={scoreWith([{}])} />);
    expect(screen.queryByRole("slider", { name: "Volume Chords" })).toBeNull();
    expect(state.current.channels).toHaveLength(2);
    expect(screen.getByTestId("mixer-channel-0").getAttribute("data-dimmed")).toBeNull();
    view.unmount();
    render(<Harness score={scoreWith(undefined, 3)} />);
    expect(screen.getByTestId("mixer-channel-3").getAttribute("data-part-id")).toBe(CHORDS_PART_ID);
    expect(state.current.channels[3]).toEqual(saved);
    expect(state.current.channels[2]).toMatchObject({ volume: MIXER_DEFAULT_GAIN, muted: false, solo: false });
    expect(screen.getByRole("slider", { name: "Volume Chords" }).getAttribute("aria-valuetext")).toBe("+6.0 dB");
  });

  it("does not rescan harmony on mixer changes or unrelated score edits", async () => {
    const resolve = vi.spyOn(core, "resolveChordSymbol");
    const score = scoreWith();
    const view = render(<Harness score={score} />);
    const calls = resolve.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole("button", { name: "Mute Chords" }));
    view.rerender(<Harness score={{ ...score, parts: [...score.parts] }} />);
    expect(resolve).toHaveBeenCalledTimes(calls);
    view.rerender(<Harness score={scoreWith([{ chordSymbols: [chord("H7")] }])} />);
    expect(resolve.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByRole("status").textContent).toBe(WARNING);
  });

  it("dims Chords when an authored part is soloed", async () => {
    render(<Harness score={scoreWith()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Solo Flute" }));
    expect(screen.getByTestId("mixer-channel-2").getAttribute("data-dimmed")).toBe("true");
    await userEvent.setup().click(screen.getByRole("button", { name: "Solo Chords" }));
    expect(screen.getByTestId("mixer-channel-2").getAttribute("data-dimmed")).toBeNull();
  });

  it("supports the derived runtime index even with no authored parts", () => {
    render(<Harness score={scoreWith(undefined, 0)} />);
    expect(screen.getAllByTestId(/^mixer-channel-/)).toHaveLength(1);
    expect(screen.getByTestId("mixer-channel-0").getAttribute("data-part-id")).toBe(CHORDS_PART_ID);
    expect(screen.getByRole("button", { name: "Mute Chords" })).toBeTruthy();
  });
});

describe("app Mixer story", () => {
  const Story = mixerStory.component!;

  it.each([false, true])("renders the real mixer with unsupported=%s", (unsupported) => {
    render(<Story unsupported={unsupported} />);
    expect(screen.getByRole("slider", { name: "Volume Chords" })).toBeTruthy();
    expect(screen.queryByText(WARNING) !== null).toBe(unsupported);
  });

  it("demonstrates retained controls and diagnostics when global chords are removed and restored", async () => {
    const user = userEvent.setup();
    render(<Story unsupported />);
    screen.getByRole("slider", { name: "Volume Chords" }).focus();
    await user.keyboard("{End}");
    await user.click(screen.getByRole("button", { name: "Remove global chords" }));
    expect(screen.queryByRole("slider", { name: "Volume Chords" })).toBeNull();
    expect(screen.queryByText(WARNING)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore global chords" }));
    expect(screen.getByRole("slider", { name: "Volume Chords" }).getAttribute("aria-valuetext")).toBe("+6.0 dB");
    expect(screen.getByRole("status").textContent).toBe(WARNING);
  });
});
