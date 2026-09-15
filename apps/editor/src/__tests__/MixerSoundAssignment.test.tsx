// @vitest-environment happy-dom
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resolvePartDisplayNames, type Score } from "@viritura/core";
import type { VstInstrumentProfile } from "@viritura/instrument-profiles";
import type { validateRawScore } from "@viritura/format";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { MixerPanel } from "../components/MixerPanel";
import { updatePartSoundSource } from "../components/mixerSoundPicker";
import { assignAllPartsToProfile, useInstrumentProfileStore } from "../instrumentProfiles";
import { useMixerActions, useMixerPartSync } from "../store/mixerStore";

vi.mock("../instrumentProfiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../instrumentProfiles")>()),
  loadInstrumentProfiles: vi.fn(),
  isDesktopHost: () => true,
  useAudioRenderModeStore: (selector: (state: { mode: "native" }) => unknown) => selector({ mode: "native" }),
}));

const profile: VstInstrumentProfile = {
  id: "user-mixer-regression",
  version: 3,
  displayName: "Regression Orchestra",
  slots: [1, 2].map((number) => ({
    slotId: `clarinet-slot-${number}`,
    catalogInstrumentId: "bflat-clarinet",
    section: "woodwinds",
    label: `Clarinet slot ${number}`,
    binding: {
      luaScriptPath: "C:\\regression-fixture\\mapper.lua",
      pluginPath: "C:\\regression-fixture\\instrument.vst3",
      stateRef: "fixture-state",
      baseChannel: 0,
    },
  })),
};

function rawScore() {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [1, 2].map((number) => ({
      id: `clarinet-${number}`,
      name: "Clarinet",
      transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
      _x: { viritura: { instrumentId: "bflat-clarinet" } },
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  id: `event-${number}`,
                  duration: { base: "whole" },
                  notes: [{ id: `note-${number}`, pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    })),
  };
}

let bundleUrl: string;

beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: "export { parseMnx, DeltaSerializer, validateRawScore } from '@viritura/format';",
      resolveDir: resolve(__dirname, ".."),
      sourcefile: "mixer-repro.mts",
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
  });
  bundleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString("base64")}`;
});

interface BrowserRequest {
  operation: "parse" | "validate" | "roundtrip";
  value: unknown;
  previous?: Score;
}

// Native Node ESM executes the browser bundle without Vitest's CJS interop.
// Both the bundle and requests travel over stdin; no bundle files are written.
function browserCall<T>(request: BrowserRequest): T {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { readFileSync } from "node:fs";
    const { url, request } = JSON.parse(readFileSync(0, "utf8"));
    try {
      const api = await import(url);
      let value;
      switch (request.operation) {
        case "validate": value = api.validateRawScore(request.value); break;
        case "parse": value = api.parseMnx(request.value); break;
        case "roundtrip": {
          const serializer = new api.DeltaSerializer();
          serializer.serialize(request.previous);
          value = api.parseMnx(JSON.parse(serializer.serialize(request.value).json));
          break;
        }
      }
      process.stdout.write(JSON.stringify({ value }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.name + ": " + error.message }));
    }
  `,
    ],
    {
      input: JSON.stringify({ url: bundleUrl, request }),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr || `Native ESM exited with ${child.status}`);
  const response = JSON.parse(child.stdout) as { value: T; error?: string };
  if (response.error) throw new Error(response.error);
  return response.value;
}

function roundtrip(previous: Score, value: Score): Score {
  return browserCall<Score>({ operation: "roundtrip", previous, value });
}

function MixerHarness({ initialScore }: { initialScore: Score }) {
  const [score, setScore] = useState<Score | null>(initialScore);
  const [error, setError] = useState<string>();
  const actions = useMixerActions();
  useMixerPartSync(score?.parts.length ?? 0);
  const names = resolvePartDisplayNames(score?.parts ?? []);
  const parts = names.map((name, index) => ({ index, name: name.displayName }));
  function update(next: Score) {
    try {
      setScore(roundtrip(score!, next));
      setError(undefined);
    } catch (cause) {
      // Match main.tsx's failed deferred parse and the bridge's empty-parts fallback.
      setScore(null);
      setError(String(cause));
    }
  }
  return (
    <TooltipPrimitives.Provider delayDuration={0}>
      <MixerPanel
        parts={parts}
        score={score}
        onSoundSourceChange={(change) => update(updatePartSoundSource(score!, change))}
        onAssignAllToProfile={(selected) => update(assignAllPartsToProfile(score!, selected))}
      />
      {error && <div role="alert">{error}</div>}
      <output data-testid="parsed-score">{JSON.stringify(score)}</output>
      <Button onClick={actions.reset}>Reset test mixer</Button>
    </TooltipPrimitives.Provider>
  );
}

beforeEach(() => {
  useInstrumentProfileStore.setState({ profiles: [profile], loaded: true });
});

afterEach(async () => {
  const reset = screen.queryByRole("button", { name: "Reset test mixer" });
  if (reset) await userEvent.setup().click(reset);
  cleanup();
  useInstrumentProfileStore.setState({ profiles: [], loaded: false });
});

function expectPreserved(initial: Score): Score {
  expect(screen.queryByRole("alert")?.textContent).toBeUndefined();
  expect(screen.getAllByTestId(/^mixer-channel-\d+$/)).toHaveLength(2);
  const parsed = JSON.parse(screen.getByTestId("parsed-score").textContent!) as Score;
  expect(parsed.parts).toEqual(initial.parts);
  expect(parsed.global).toEqual(initial.global);
  for (const number of [1, 2]) {
    expect(screen.getByRole("slider", { name: `Volume Clarinet in B♭ ${number}` })).toBeTruthy();
  }
  expect(screen.getByRole("button", { name: "Mute Clarinet in B♭ 1" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("slider", { name: "Volume Clarinet in B♭ 1" }).getAttribute("aria-valuetext")).toBe(
    "-6.5 dB",
  );
  expect(screen.getByRole("slider", { name: "Volume Clarinet in B♭ 2" }).getAttribute("aria-valuetext")).toBe(
    "-6.0 dB",
  );
  return parsed;
}

async function mountMixer() {
  const initial = browserCall<Score>({ operation: "parse", value: rawScore() });
  const user = userEvent.setup();
  render(<MixerHarness initialScore={initial} />);
  await user.click(await screen.findByRole("button", { name: "Mute Clarinet in B♭ 1" }));
  screen.getByRole("slider", { name: "Volume Clarinet in B♭ 1" }).focus();
  await user.keyboard("{ArrowDown}");
  expectPreserved(initial);
  return { initial, user };
}

async function selectSound(user: ReturnType<typeof userEvent.setup>, number: number, reset = false) {
  const trigger = screen.getByRole("button", { name: new RegExp(`^Sound for Clarinet in B♭ ${number}:`) });
  trigger.focus();
  await user.keyboard("{Enter}");
  const pack = await screen.findByRole("menuitem", { name: "VirituraSounds" });
  pack.focus();
  await user.keyboard("{ArrowRight}");
  if (reset) {
    await user.click(await screen.findByRole("menuitem", { name: "Notation default: B-flat Clarinet" }));
  } else {
    const section = await screen.findByRole("menuitem", { name: "Brass" });
    section.focus();
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "Tuba" }));
  }
}

describe("Mixer sound assignments through browser-bundled MNX", () => {
  it("parses the initial notation before any soundProfile is assigned", () => {
    const score = browserCall<Score>({ operation: "parse", value: rawScore() });
    expect(score.parts.map((part) => part.id)).toEqual(["clarinet-1", "clarinet-2"]);
    expect(score.parts[0]!.measures).toHaveLength(1);
    expect(score.soundProfile).toBeUndefined();
  });

  it("keeps channels, notation, mute and volume after a real Sound selection and reset", async () => {
    const { initial, user } = await mountMixer();
    await selectSound(user, 1);
    expect(expectPreserved(initial).soundProfile).toEqual({
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { "clarinet-1": { sourceId: "tuba-primary" } },
    });
    await selectSound(user, 1, true);
    expect(expectPreserved(initial).soundProfile).toBeUndefined();
  });

  it("keeps every channel when a single instrument switches to a VST slot", async () => {
    const { initial, user } = await mountMixer();
    screen.getByRole("button", { name: /^Sound for Clarinet in B♭ 1:/ }).focus();
    await user.keyboard("{Enter}");
    (await screen.findByRole("menuitem", { name: profile.displayName })).focus();
    await user.keyboard("{ArrowRight}");
    (await screen.findByRole("menuitem", { name: "Winds" })).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: "Clarinet slot 1" }));
    expect(expectPreserved(initial).soundProfile).toEqual({
      profileId: profile.id,
      profileVersion: profile.version,
      parts: { "clarinet-1": { sourceId: "clarinet-slot-1" } },
    });
    await selectSound(user, 1, true);
    expect(expectPreserved(initial).soundProfile).toBeUndefined();
  });

  it("keeps all channels through bulk assignment, mixed profiles and partial/final reset", async () => {
    const { initial, user } = await mountMixer();
    await user.click(screen.getByRole("button", { name: "Assign all instruments to a profile" }));
    await user.click(await screen.findByRole("menuitem", { name: profile.displayName }));
    expect(expectPreserved(initial).soundProfile).toEqual({
      profileId: profile.id,
      profileVersion: profile.version,
      parts: {
        "clarinet-1": { sourceId: "clarinet-slot-1", profileId: profile.id, profileVersion: profile.version },
        "clarinet-2": { sourceId: "clarinet-slot-2", profileId: profile.id, profileVersion: profile.version },
      },
    });
    await selectSound(user, 1);
    const mixed = expectPreserved(initial).soundProfile;
    expect(mixed).toEqual({
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: {
        "clarinet-1": { sourceId: "tuba-primary" },
        "clarinet-2": { sourceId: "clarinet-slot-2", profileId: profile.id, profileVersion: profile.version },
      },
    });
    await selectSound(user, 1, true);
    expect(expectPreserved(initial).soundProfile?.parts).toEqual({ "clarinet-2": mixed!.parts["clarinet-2"] });
    await selectSound(user, 2, true);
    expect(expectPreserved(initial).soundProfile).toBeUndefined();
  });

  it.each(["viritura-sounds", "𝄞"])("accepts nonempty profile and source IDs: %s", (id) => {
    const value = {
      ...rawScore(),
      _x: {
        viritura: {
          soundProfile: {
            profileId: id,
            profileVersion: 1,
            parts: { "clarinet-1": { sourceId: id, profileId: id, profileVersion: 1 } },
          },
        },
      },
    };
    expect(browserCall<ReturnType<typeof validateRawScore>>({ operation: "validate", value }).ok).toBe(true);
    expect(browserCall<Score>({ operation: "parse", value }).soundProfile?.profileId).toBe(id);
  });

  it.each([
    { field: "profileId", pointer: "/_x/viritura/soundProfile/profileId" },
    { field: "sourceId", pointer: "/_x/viritura/soundProfile/parts/clarinet-1/sourceId" },
    { field: "partProfileId", pointer: "/_x/viritura/soundProfile/parts/clarinet-1/profileId" },
  ])("rejects empty $field with a minLength schema error, not a runtime exception", ({ field, pointer }) => {
    const value = {
      ...rawScore(),
      _x: {
        viritura: {
          soundProfile: {
            profileId: field === "profileId" ? "" : "viritura-sounds",
            profileVersion: 1,
            parts: {
              "clarinet-1": {
                sourceId: field === "sourceId" ? "" : "tuba-primary",
                profileId: field === "partProfileId" ? "" : "viritura-sounds",
                profileVersion: 1,
              },
            },
          },
        },
      },
    };
    const result = browserCall<ReturnType<typeof validateRawScore>>({ operation: "validate", value });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(expect.objectContaining({ keyword: "minLength", pointer }));
    }
  });
});
