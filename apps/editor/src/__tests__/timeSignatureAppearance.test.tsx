import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect, type ReactNode } from "react";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { TimeSigGlyph } from "../components/palette";
import { DocumentProvider, useDocumentStore } from "../store/DocumentContext";
import {
  presetFor,
  setSettings,
  settingsFor,
  settingsForPreset,
  TimeSignatureAppearance,
} from "../components/modes/engrave/HouseStylePanel/TimeSignatureAppearance";

afterEach(cleanup);

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Flute",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Loads a score into the provider so the panel has something to edit. */
function WithScore({ score, children }: { score: Score; children: ReactNode }) {
  const loadScore = useDocumentStore((s) => s.loadScore);
  const loaded = useDocumentStore((s) => s.score !== null);
  useEffect(() => {
    loadScore(score, "test.mnx");
  }, [loadScore, score]);
  return loaded ? <>{children}</> : null;
}

function SettingsSnapshot() {
  const settings = useDocumentStore((state) => state.workingScore?.timeSignatures);
  return <output data-testid="settings-snapshot">{JSON.stringify(settings)}</output>;
}

function renderPanel(score: Score) {
  return render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <WithScore score={score}>
          <TimeSignatureAppearance />
          <SettingsSnapshot />
        </WithScore>
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
}

describe("time signature settings model", () => {
  it("reports the engine default for a document that says nothing", () => {
    expect(settingsFor(undefined, "score")).toEqual({
      renderStyle: "standard",
      distribution: "perStaff",
      grandStaff: "include",
      position: "center",
      scale: 1,
      senzaMisura: "open",
    });
  });

  it("keeps only genuine differences from the default", () => {
    expect(
      setSettings(undefined, "score", {
        ...settingsFor(undefined, "score"),
        distribution: "perGroup",
        position: "above",
        scale: 1.5,
      }),
    ).toEqual({ score: { distribution: "perGroup", position: "above", scale: 1.5 } });
  });

  it("stores a hidden senza misura treatment as a house-style override", () => {
    expect(
      setSettings(undefined, "parts", {
        ...settingsFor(undefined, "parts"),
        senzaMisura: "hidden",
      }),
    ).toEqual({ parts: { senzaMisura: "hidden" } });
  });

  it("maps recognizable presets onto the orthogonal settings", () => {
    const filmScore = settingsForPreset("filmScore")!;
    expect(filmScore).toEqual({
      renderStyle: "outsideStaff",
      distribution: "perGroup",
      grandStaff: "include",
      position: "center",
      scale: 8,
      senzaMisura: "open",
    });
    expect(presetFor(filmScore)).toBe("filmScore");
    expect(presetFor({ ...filmScore, scale: 9 })).toBe("custom");

    expect(settingsForPreset("aboveGroup")).toEqual({
      renderStyle: "standard",
      distribution: "perGroup",
      grandStaff: "include",
      position: "above",
      scale: 1,
      senzaMisura: "open",
    });
  });
});

describe("shared palette staff geometry", () => {
  it("places 4/4 at one and three spaces on a five-line staff", () => {
    const { container } = render(<TimeSigGlyph count={4} unit={4} />);
    expect(container.querySelectorAll("line")).toHaveLength(5);
    expect(Array.from(container.querySelectorAll("text")).map((text) => text.getAttribute("y"))).toEqual(["5", "15"]);
  });
});

describe("Engrave time signature appearance", () => {
  it("renders nothing when no score is open", () => {
    render(
      <TooltipPrimitives.Provider delayDuration={0}>
        <DocumentProvider>
          <TimeSignatureAppearance />
        </DocumentProvider>
      </TooltipPrimitives.Provider>,
    );
    expect(screen.queryByLabelText("Time signature appearance scope")).toBeNull();
  });

  it("starts with presets and reveals finer controls under Advanced", async () => {
    const user = userEvent.setup();
    renderPanel(makeScore());

    const scope = await screen.findByLabelText("Time signature appearance scope");
    expect(scope.textContent).toContain("Full scores");

    const styleGroup = screen.getByRole("radiogroup", { name: "Time signature style" });
    expect(styleGroup).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Standard",
      "Large on each staff",
      "Film score",
      "Above each group",
    ]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios.every((radio) => radio.querySelectorAll("line").length === 10)).toBe(true);
    expect(Array.from(radios[0]!.querySelectorAll("text")).map((text) => text.getAttribute("y"))).toEqual([
      "5",
      "15",
      "60",
      "70",
    ]);
    expect(
      Array.from(radios[2]!.querySelectorAll("text")).map((text) => ({
        glyph: text.textContent,
        y: text.getAttribute("y"),
      })),
    ).toEqual([
      { glyph: "\uF444", y: "-2.5" },
      { glyph: "\uF444", y: "77.5" },
    ]);
    expect(Array.from(radios[3]!.querySelectorAll("text")).map((text) => text.getAttribute("y"))).toEqual([
      "-20",
      "-10",
    ]);
    expect(screen.queryByLabelText("Time signature numeral design")).toBeNull();

    radios[0]!.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Large on each staff" }).getAttribute("aria-checked")).toBe("true"),
    );

    await user.click(screen.getByRole("radio", { name: "Film score" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Film score" }).getAttribute("aria-checked")).toBe("true"),
    );
    expect(screen.getByText(/practical 8× starting size/)).toBeTruthy();
    expect(screen.getByTestId("settings-snapshot").textContent).toContain(
      '"score":{"renderStyle":"outsideStaff","distribution":"perGroup","scale":8}',
    );

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    const numeralGroup = screen.getByRole("radiogroup", { name: "Time signature numeral design" });
    const numeralRadios = Array.from(numeralGroup.querySelectorAll('[role="radio"]'));
    expect(numeralRadios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Standard digits",
      "Condensed digits",
      "Film-score numerals",
      "Beat count only",
      "Note-value denominator",
    ]);
    expect(screen.getByRole("radio", { name: "Film-score numerals" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Condensed digits" }).textContent).toContain("\uF50A");
    expect(screen.getByRole("radio", { name: "Film-score numerals" }).textContent).toContain("\uF444");
    expect(screen.getByRole("radio", { name: "Beat count only" }).querySelectorAll("text")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Note-value denominator" }).textContent).toContain("\uECA5");
    expect(screen.getByLabelText("Time signature distribution").textContent).toContain("staff group");
    expect((screen.getByLabelText("Time signature grand staff behavior") as HTMLButtonElement).disabled).toBe(false);
    const scale = screen.getByLabelText("Time signature scale") as HTMLInputElement;
    expect(scale.max).toBe("12");
    expect(scale.step).toBe("0.25");
    fireEvent.change(scale, { target: { value: "99" } });
    expect(scale.value).toBe("99");
    expect(screen.getByTestId("settings-snapshot").textContent).toContain(
      '"score":{"renderStyle":"outsideStaff","distribution":"perGroup","scale":8}',
    );
    fireEvent.blur(scale);
    expect(scale.value).toBe("12");
    await waitFor(() => expect(screen.getByText("Advanced controls differ from the built-in styles.")).toBeTruthy());
    expect(
      Array.from(styleGroup.querySelectorAll('[role="radio"]')).every(
        (radio) => radio.getAttribute("aria-checked") === "false",
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("settings-snapshot").textContent).toContain(
        '"score":{"renderStyle":"outsideStaff","distribution":"perGroup","scale":12}',
      ),
    );

    fireEvent.change(scale, { target: { value: "1.13" } });
    fireEvent.blur(scale);
    expect(scale.value).toBe("1.25");
    await waitFor(() => expect(screen.getByTestId("settings-snapshot").textContent).toContain('"scale":1.25'));

    await user.click(screen.getByRole("radio", { name: "Beat count only" }));
    await waitFor(() => expect(screen.getByText("Advanced controls differ from the built-in styles.")).toBeTruthy());
  });
});
