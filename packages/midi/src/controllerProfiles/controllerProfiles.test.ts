import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { decodeMidiInputMessage } from "../midiInput";
import {
  findControllerProfile,
  listControllerProfiles,
  controllerProfileSourceUrl,
  resolveControllerAction,
  isControllerPreviewMessage,
} from "./registry";

const controllersDirectory = path.resolve(__dirname, "../../controllers");

describe("controller profile files", () => {
  it("validate against the contribution schema", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(controllersDirectory, "schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const profilePaths = fs
      .readdirSync(controllersDirectory, { recursive: true })
      .filter((entry) => typeof entry === "string" && entry.endsWith(".json") && entry !== "schema.json");

    for (const profilePath of profilePaths) {
      const profile = JSON.parse(fs.readFileSync(path.join(controllersDirectory, profilePath), "utf8"));
      expect(validate(profile), `${profilePath}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
});

describe("MPK mini IV profile", () => {
  const controlsPort = {
    id: "controls",
    name: "MIDIIN2 (MPK mini IV)",
    manufacturer: "AKAI Professional M.I. Corp.",
    state: "connected",
    connection: "open",
  } as const;

  it("matches the Windows controls endpoint", () => {
    expect(findControllerProfile(controlsPort)?.id).toBe("akai.mpk-mini-iv");
    expect(findControllerProfile({ ...controlsPort, manufacturer: "" })?.id).toBe("akai.mpk-mini-iv");
    expect(listControllerProfiles()).toHaveLength(1);
    expect(controllerProfileSourceUrl("akai.mpk-mini-iv")).toBe(
      "https://github.com/Viritura/Viritura/blob/main/packages/midi/controllers/akai/mpk-mini-iv.json",
    );
  });

  it("maps confirmed transport and undo controls", () => {
    const profile = findControllerProfile(controlsPort)!;
    expect(
      resolveControllerAction(profile, controlsPort.name, decodeMidiInputMessage("controls", 0, [0xb0, 76, 127])),
    ).toEqual({
      type: "transport.play-stop",
    });
    expect(
      resolveControllerAction(profile, controlsPort.name, decodeMidiInputMessage("controls", 0, [0xb0, 73, 127])),
    ).toEqual({
      type: "history.undo",
    });
  });

  it("maps bank buttons and the relative encoder to cursor movement", () => {
    const profile = findControllerProfile(controlsPort)!;
    const resolveCc = (number: number, value: number) =>
      resolveControllerAction(profile, controlsPort.name, decodeMidiInputMessage("controls", 0, [0xb0, number, value]));

    expect(resolveCc(81, 127)).toEqual({ type: "note-input.move-cursor", direction: "right" });
    expect(resolveCc(80, 127)).toEqual({ type: "note-input.move-cursor", direction: "left" });
    expect(resolveCc(14, 1)).toEqual({ type: "note-input.move-cursor", direction: "up" });
    expect(resolveCc(14, 127)).toEqual({ type: "note-input.move-cursor", direction: "down" });
    expect(resolveCc(14, 64)).toBeUndefined();
  });

  it("maps CC 13 to the note-entry mode toggle", () => {
    const profile = findControllerProfile(controlsPort)!;
    expect(
      resolveControllerAction(profile, controlsPort.name, decodeMidiInputMessage("controls", 0, [0xb0, 13, 127])),
    ).toEqual({
      type: "note-input.toggle",
    });
    expect(
      resolveControllerAction(profile, controlsPort.name, decodeMidiInputMessage("controls", 0, [0xb0, 13, 0])),
    ).toBeUndefined();
  });

  it("maps both pad banks from 64th through breve", () => {
    const profile = findControllerProfile(controlsPort)!;
    const durations = ["64th", "32nd", "16th", "eighth", "quarter", "half", "whole", "breve"];
    for (const bankStart of [36, 44]) {
      const actions = durations.map((_, index) =>
        resolveControllerAction(
          profile,
          controlsPort.name,
          decodeMidiInputMessage("controls", index, [0x99, bankStart + index, 100]),
        ),
      );
      expect(actions).toEqual(durations.map((duration) => ({ type: "note-input.set-duration", duration })));
    }
  });

  it("does not trigger duration actions on note-off", () => {
    const profile = findControllerProfile(controlsPort)!;
    expect(
      resolveControllerAction(profile, controlsPort.name, decodeMidiInputMessage("controls", 0, [0x89, 44, 0])),
    ).toBeUndefined();
  });

  it("previews performance-channel keys but not drum pads", () => {
    const performancePort = { ...controlsPort, id: "performance", name: "MPK mini IV" };
    const profile = findControllerProfile(performancePort)!;
    expect(
      isControllerPreviewMessage(
        profile,
        performancePort.name,
        decodeMidiInputMessage("performance", 0, [0x90, 60, 90]),
      ),
    ).toBe(true);
    expect(
      isControllerPreviewMessage(
        profile,
        performancePort.name,
        decodeMidiInputMessage("performance", 0, [0x80, 60, 0]),
      ),
    ).toBe(true);
    expect(
      isControllerPreviewMessage(
        profile,
        performancePort.name,
        decodeMidiInputMessage("performance", 0, [0x99, 44, 90]),
      ),
    ).toBe(false);
  });
});
