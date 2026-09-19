import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ClipboardSelection } from "../../commands/clipboardCommands";
import { copyToClipboard, pasteFromClipboard } from "../../commands/clipboardCommands";
import { MuseScoreConversionError } from "@viritura/musescore-clipboard";
import { readNotationClipboard, writeClipboardFragment, writeNotationClipboard } from ".";

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

  it("writes only text in a native transaction", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    await writeNotationClipboard({ text: "json" });
    expect(invoke).toHaveBeenCalledWith("notation_clipboard_write", {
      text: "json",
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(["application/musescore/stafflist", "application/musescore/symbol", "application/musescore/symbollist"])(
    "does not forward an extra %s payload from a legacy caller",
    async (mime) => {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({ supported: true });
      const legacyPayload = { text: "json", museScore: { mime, xml: "<StaffList/>" } };
      await writeNotationClipboard(legacyPayload);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text: "json" });
      expect(writeText).not.toHaveBeenCalled();
    },
  );

  it("falls back to browser text and never claims native MIME access", async () => {
    readText.mockResolvedValue("browser text");
    await expect(readNotationClipboard()).resolves.toEqual({
      text: "browser text",
      museScore: null,
      nativeFormatsSupported: false,
    });
    await writeNotationClipboard({ text: "plain lyric" });
    expect(writeText).toHaveBeenCalledWith("plain lyric");
  });

  it("uses browser text when the native host reports unsupported clipboard formats", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: false, text: null, museScore: null });
    readText.mockResolvedValue("browser text");
    await expect(readNotationClipboard()).resolves.toEqual({
      text: "browser text",
      museScore: null,
      nativeFormatsSupported: false,
    });
    await writeNotationClipboard({ text: "json" });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("json");
  });

  it("never attempts unsupported browser custom MIME writes", async () => {
    const write = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText, readText, write } });
    await copyToClipboard(selection());
    expect(write).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({ type: "viritura/fragment" });
  });
});

describe("clipboard command integration", () => {
  it("writes only Viritura JSON as native text", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    await expect(copyToClipboard(selection())).resolves.toBe(true);
    const payload = vi.mocked(invoke).mock.calls[0]?.[1] as {
      text: string;
    };
    expect(JSON.parse(payload.text)).toMatchObject({ type: "viritura/fragment", version: 5 });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text: payload.text });
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

  it.each([false, true])("preserves Viritura-only notation as JSON (native=%s)", async (native) => {
    if (native) {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({ supported: true });
    }
    const source = selection();
    const event = source.events[0];
    if (event?.type !== "event") throw new Error("Expected a note event");
    event.lyrics = { lines: { verse: { text: "Sing" } } };
    await expect(copyToClipboard(source)).resolves.toBe(true);
    const text = native ? (vi.mocked(invoke).mock.calls[0]![1] as { text: string }).text : writeText.mock.calls[0]![0];
    expect(JSON.parse(text).content[0].lyrics.lines.verse.text).toBe("Sing");
    if (native) {
      expect(invoke).toHaveBeenCalledWith("notation_clipboard_write", {
        text,
      });
      expect(writeText).not.toHaveBeenCalled();
    }
  });

  it("restores history fragments with primary transposition in JSON only", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    const source = selection();
    const transposition = { interval: { halfSteps: 12, staffDistance: 7 }, prefersWrittenPitches: true };
    await writeClipboardFragment({
      content: source.events,
      timeSignature: source.timeSignature,
      keySignature: source.keySignature,
      transposition,
    });
    const payload = vi.mocked(invoke).mock.calls[0]![1] as {
      text: string;
    };
    expect(JSON.parse(payload.text).transposition).toEqual(transposition);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text: payload.text });
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
    expect(writeText).not.toHaveBeenCalled();

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

  it.each([false, true])("retains reader transposition through normal paste (native=%s)", async (native) => {
    const xml =
      `<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1"><Staff id="0">` +
      `<transposeChromatic>-12</transposeChromatic><transposeDiatonic>-7</transposeDiatonic>` +
      `<voiceOffset><voice id="0">0</voice></voiceOffset><Chord><durationType>quarter</durationType>` +
      `<Note><pitch>29</pitch><tpc>13</tpc></Note></Chord></Staff></StaffList>`;
    if (native) {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({
        supported: true,
        text: "",
        museScore: { mime: "application/musescore/stafflist", xml },
      });
    } else {
      readText.mockResolvedValue(xml);
    }
    const result = await pasteFromClipboard();
    const transposition = { interval: { halfSteps: 12, staffDistance: 7 }, prefersWrittenPitches: true };
    expect(result?.transposition).toEqual(transposition);
    expect(result?.tracks?.[0]?.transposition).toEqual(transposition);
    expect(result?.content[0]).toMatchObject({ notes: [{ pitch: { step: "F", octave: 1 } }] });
    expect(result?.content).toBe(result?.tracks?.[0]?.content);
    expect(result?.sourceTimeSignature).toBeUndefined();
    expect(result?.sourceKeySignature).toBeUndefined();
  });

  it("does not treat truncated plain-text StaffList as ordinary text", async () => {
    readText.mockResolvedValue("<StaffList");
    await expect(pasteFromClipboard()).rejects.toBeInstanceOf(MuseScoreConversionError);
  });
});
