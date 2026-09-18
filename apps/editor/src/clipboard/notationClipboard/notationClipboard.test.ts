import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ClipboardSelection } from "../../commands/clipboardCommands";
import { copyToClipboard, pasteFromClipboard } from "../../commands/clipboardCommands";
import { MuseScoreConversionError } from "../museScore";
import { readNotationClipboard, writeNotationClipboard } from ".";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const writeText = vi.fn<(text: string) => Promise<void>>();
const readText = vi.fn<() => Promise<string>>();

beforeEach(() => {
  vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
  writeText.mockResolvedValue();
  readText.mockResolvedValue("");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function selection(): ClipboardSelection {
  return {
    events: [
      {
        type: "event",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      },
    ],
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    partIndex: 0,
    measureIndex: 0,
    sequenceIndex: 0,
    eventIndex: 0,
  };
}

describe("notation clipboard adapter", () => {
  it("uses the exact desktop read contract when native formats are supported", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      supported: true,
      text: "native-json",
      museScore: { mime: "application/musescore/stafflist", xml: "<StaffList/>" },
    });
    await expect(readNotationClipboard()).resolves.toEqual({
      text: "native-json",
      museScore: { mime: "application/musescore/stafflist", xml: "<StaffList/>" },
      nativeFormatsSupported: true,
    });
    expect(invoke).toHaveBeenCalledWith("notation_clipboard_read");
    expect(readText).not.toHaveBeenCalled();
  });

  it("writes text and StaffList in one native transaction", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    await writeNotationClipboard({
      text: "json",
      museScore: { mime: "application/musescore/stafflist", xml: "<StaffList/>" },
    });
    expect(invoke).toHaveBeenCalledWith("notation_clipboard_write", {
      text: "json",
      museScore: { mime: "application/musescore/stafflist", xml: "<StaffList/>" },
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to browser text and never claims native MIME access", async () => {
    readText.mockResolvedValue("browser text");
    await expect(readNotationClipboard()).resolves.toEqual({
      text: "browser text",
      museScore: null,
      nativeFormatsSupported: false,
    });
    await writeNotationClipboard({ text: "plain lyric", museScore: null });
    expect(writeText).toHaveBeenCalledWith("plain lyric");
  });
});

describe("clipboard command integration", () => {
  it("writes Viritura JSON as text and StaffList as native MIME", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    await expect(copyToClipboard(selection())).resolves.toBe(true);
    const payload = vi.mocked(invoke).mock.calls[0]?.[1] as {
      text: string;
      museScore: { mime: string; xml: string };
    };
    expect(JSON.parse(payload.text)).toMatchObject({ type: "viritura/fragment", version: 5 });
    expect(payload.museScore.mime).toBe("application/musescore/stafflist");
    expect(payload.museScore.xml).toContain('version="4.70"');
  });

  it("prefers full-fidelity Viritura JSON over accompanying StaffList", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      supported: true,
      text: JSON.stringify({
        type: "viritura/fragment",
        version: 5,
        timeSignature: { count: 4, unit: 4 },
        keySignature: { fifths: 0 },
        content: [{ type: "event", duration: { base: "half" }, rest: {} }],
      }),
      museScore: { mime: "application/musescore/stafflist", xml: "<invalid>" },
    });
    const result = await pasteFromClipboard();
    expect(result?.content[0]).toMatchObject({ duration: { base: "half" }, rest: {} });
  });

  it("throws for recognized malformed MuseScore data so history cannot be pasted instead", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      supported: true,
      text: "",
      museScore: {
        mime: "application/musescore/stafflist",
        xml: `<StaffList version="9.0" tick="0/1" len="1/4" staff="0" staves="1"/>`,
      },
    });
    await expect(pasteFromClipboard()).rejects.toBeInstanceOf(MuseScoreConversionError);
  });

  it("allows history on unavailable reads, without hiding native write failures", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue(new Error("native clipboard unavailable"));
    const warning = vi.fn();
    await expect(pasteFromClipboard(warning)).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith("Could not read the system clipboard.");
    await expect(copyToClipboard(selection())).rejects.toMatchObject({
      name: "NotationClipboardError",
      backend: "native",
    });

    vi.unstubAllGlobals();
    vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
    readText.mockRejectedValue(new Error("permission denied"));
    await expect(pasteFromClipboard()).resolves.toBeNull();
  });

  it.each([
    "failed to open clipboard: Access is denied. (os error 5)",
    "failed to get clipboard data: Access is denied. (os error 5)",
    "failed to close clipboard: Clipboard is not open. (os error 1418)",
    "failed to lock clipboard global memory: Access is denied. (os error 5)",
    "failed to get main window handle: unavailable",
    "failed to register clipboard format: unavailable",
  ])("allows history for documented native transport error: %s", async (message) => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue(message);
    await expect(pasteFromClipboard()).resolves.toBeNull();
    expect(readText).not.toHaveBeenCalled();
  });

  it.each([
    "MuseScore clipboard payload is invalid UTF-8: invalid utf-8 sequence",
    "MuseScore clipboard payload contains an embedded NUL byte",
    "MuseScore clipboard payload is empty",
    "MuseScore clipboard payload exceeds the 8388608-byte limit",
    "clipboard allocation is 8388700 bytes, exceeding the 8388609-byte limit",
    "clipboard data has a zero-sized global allocation",
    "CF_UNICODETEXT payload is invalid UTF-16",
    "unexpected native failure",
  ])("never falls back to history for malformed or unknown native errors: %s", async (message) => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue(message);
    const warning = vi.fn();
    await expect(pasteFromClipboard(warning)).rejects.toMatchObject({
      name: "NotationClipboardError",
      canUseHistory: false,
    });
    expect(warning).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
  });

  it("parses StaffList only when explicitly present as browser plain text", async () => {
    readText.mockResolvedValue(
      `<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1"><Staff id="0">` +
        `<voiceOffset><voice id="0">0</voice></voiceOffset><Chord><durationType>quarter</durationType>` +
        `<Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></Staff></StaffList>`,
    );
    await expect(pasteFromClipboard()).resolves.toMatchObject({
      content: [{ type: "event", duration: { base: "quarter" } }],
    });
  });

  it("does not treat truncated plain-text StaffList as ordinary text", async () => {
    readText.mockResolvedValue("<StaffList");
    await expect(pasteFromClipboard()).rejects.toBeInstanceOf(MuseScoreConversionError);
  });
});
