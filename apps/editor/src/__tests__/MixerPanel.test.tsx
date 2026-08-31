// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipPrimitives } from "@viritura/ui";
import { resolvePartDisplayNames, type Score } from "@viritura/core";
import { MixerPanel } from "../components/MixerPanel";
import { updatePartSoundSource, revertVstAssignmentsToNotationDefault } from "../components/mixerSoundPicker";
import { useMixerPartSync } from "../store/mixerStore";

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [] },
  parts: [
    {
      id: "clarinet-1",
      name: "Clarinet",
      measures: [],
      transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
      _x: { viritura: { instrumentId: "bflat-clarinet" } },
    },
    {
      id: "clarinet-2",
      name: "Clarinet",
      measures: [],
      transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
      _x: { viritura: { instrumentId: "bflat-clarinet" } },
    },
  ],
};

function MixerHarness({
  score: scoreToRender = score,
  onSoundSourceChange = vi.fn(),
}: {
  score?: Score;
  onSoundSourceChange?: Parameters<typeof MixerPanel>[0]["onSoundSourceChange"];
}) {
  useMixerPartSync(scoreToRender.parts.length);
  const displayNames = resolvePartDisplayNames(scoreToRender.parts);
  const parts = scoreToRender.parts.map((part, index) => ({
    index,
    name: displayNames[index]!.displayName,
  }));
  return <MixerPanel parts={parts} score={scoreToRender} onSoundSourceChange={onSoundSourceChange} />;
}

afterEach(cleanup);

describe("MixerPanel sound profiles", () => {
  it("shows a keyboard-operable sound-pack hierarchy and sends the selected stable source ID", async () => {
    const user = userEvent.setup();
    const onSoundSourceChange = vi.fn();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <MixerHarness onSoundSourceChange={onSoundSourceChange} />
      </TooltipPrimitives.Provider>,
    );

    for (const name of ["Clarinet in B♭ 1", "Clarinet in B♭ 2"]) {
      const picker = (await screen.findByRole("button", {
        name: new RegExp(`^Sound for ${name}:`),
      })) as HTMLButtonElement;
      expect(picker.disabled).toBe(false);
      expect(picker.textContent).toBe("Sound");
    }

    const picker = screen.getByRole("button", { name: /^Sound for Clarinet in B♭ 1:/ });
    picker.focus();
    await user.keyboard("{Enter}");
    expect(picker.getAttribute("aria-expanded")).toBe("true");

    const pack = await screen.findByRole("menuitem", { name: "VirituraSounds" });
    expect(pack.getAttribute("aria-haspopup")).toBe("menu");
    await user.keyboard("{ArrowRight}");

    const brass = await screen.findByRole("menuitem", { name: "Brass" });
    expect(brass.getAttribute("aria-haspopup")).toBe("menu");
    brass.focus();
    await user.keyboard("{ArrowRight}");

    await user.click(await screen.findByRole("menuitem", { name: "Tuba" }));
    expect(onSoundSourceChange).toHaveBeenCalledWith({
      partId: "clarinet-1",
      sourceId: "tuba-primary",
      profileId: "viritura-sounds",
      profileVersion: 1,
    });
  });

  it("resets the source assignment from the notation-default menu item and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    const onSoundSourceChange = vi.fn();
    const scoreWithTuba = updatePartSoundSource(score, {
      partId: "clarinet-1",
      sourceId: "tuba-primary",
      profileId: "viritura-sounds",
      profileVersion: 1,
    });
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <MixerHarness onSoundSourceChange={onSoundSourceChange} />
      </TooltipPrimitives.Provider>,
    );

    const picker = await screen.findByRole("button", { name: /^Sound for Clarinet in B♭ 1:/ });
    expect(picker.getAttribute("aria-label")).toContain("VirituraSounds — Notation default: B-flat Clarinet");
    picker.focus();
    await user.keyboard("{Space}");
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(picker);

    cleanup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <MixerHarness score={scoreWithTuba} onSoundSourceChange={onSoundSourceChange} />
      </TooltipPrimitives.Provider>,
    );

    const selectedPicker = await screen.findByRole("button", { name: /^Sound for Clarinet in B♭ 1:/ });
    expect(selectedPicker.getAttribute("aria-label")).toContain("VirituraSounds — Tuba");
    selectedPicker.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "Notation default: B-flat Clarinet" }));
    expect(onSoundSourceChange).toHaveBeenLastCalledWith({
      partId: "clarinet-1",
      sourceId: undefined,
      profileId: "viritura-sounds",
      profileVersion: 1,
    });
  });

  it("shows dB faders and compact Mute, Solo, Sound, and spatial-mode controls", async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <MixerHarness />
      </TooltipPrimitives.Provider>,
    );

    const channel = await screen.findByTestId("mixer-channel-0");
    const fader = screen.getByRole("slider", { name: "Volume Clarinet in B♭ 1" });
    expect(fader.getAttribute("aria-valuetext")).toBe("-6.0 dB");
    fader.focus();
    await user.keyboard("{ArrowDown}");
    expect(fader.getAttribute("aria-valuetext")).toBe("-6.5 dB");
    expect(channel.textContent).toContain("Sound");
    expect(screen.getByRole("button", { name: "Mute Clarinet in B♭ 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Solo Clarinet in B♭ 1" })).toBeTruthy();

    const mode = screen.getByRole("button", { name: "Clarinet in B♭ 1 spatial mode: Stage" });
    expect(mode.textContent).toBe("3D");
    await user.click(mode);
    expect(screen.getByRole("button", { name: "Clarinet in B♭ 1 spatial mode: Stereo" }).textContent).toBe("2D");
  });

  it("writes and resets only the stable part-ID-keyed source assignment", () => {
    const withTuba = updatePartSoundSource(score, {
      partId: "clarinet-1",
      sourceId: "tuba-primary",
      profileId: "viritura-sounds",
      profileVersion: 1,
    });
    expect(withTuba.parts[0]!._x?.viritura?.instrumentId).toBe("bflat-clarinet");
    expect(withTuba.soundProfile).toEqual({
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { "clarinet-1": { sourceId: "tuba-primary" } },
    });

    const reset = updatePartSoundSource(withTuba, {
      partId: "clarinet-1",
      profileId: "viritura-sounds",
      profileVersion: 1,
    });
    expect(reset.soundProfile).toBeUndefined();
  });
});

describe("revertVstAssignmentsToNotationDefault", () => {
  it("drops VST-profile parts but keeps VirituraSounds selections", () => {
    const assigned: Score = {
      ...score,
      soundProfile: {
        profileId: "my-vst",
        profileVersion: 3,
        parts: {
          "clarinet-1": { sourceId: "slot-a" },
          "clarinet-2": { sourceId: "flute-primary", profileId: "viritura-sounds", profileVersion: 1 },
        },
      },
    };
    const reverted = revertVstAssignmentsToNotationDefault(assigned, "viritura-sounds", 1);
    expect(reverted.soundProfile).toEqual({
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { "clarinet-2": { sourceId: "flute-primary" } },
    });
  });

  it("drops the assignment entirely when no VirituraSounds parts remain", () => {
    const assigned: Score = {
      ...score,
      soundProfile: {
        profileId: "my-vst",
        profileVersion: 3,
        parts: { "clarinet-1": { sourceId: "slot-a" } },
      },
    };
    const reverted = revertVstAssignmentsToNotationDefault(assigned, "viritura-sounds", 1);
    expect(reverted.soundProfile).toBeUndefined();
  });

  it("returns the same score reference when nothing targets a VST profile", () => {
    const onlyVs: Score = {
      ...score,
      soundProfile: {
        profileId: "viritura-sounds",
        profileVersion: 1,
        parts: { "clarinet-1": { sourceId: "tuba-primary" } },
      },
    };
    expect(revertVstAssignmentsToNotationDefault(onlyVs, "viritura-sounds", 1)).toBe(onlyVs);
    expect(revertVstAssignmentsToNotationDefault(score, "viritura-sounds", 1)).toBe(score);
  });
});
