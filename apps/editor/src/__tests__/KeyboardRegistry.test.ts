import { describe, it, expect, beforeEach } from "vitest";
import { KeyboardRegistry, parseKeyCombo } from "../keyboard/KeyboardRegistry";

describe("parseKeyCombo", () => {
  it("parses Ctrl+\\", () => {
    const p = parseKeyCombo("Ctrl+\\");
    expect(p).toEqual({ ctrl: true, shift: false, alt: false, key: "\\" });
  });
  it("parses Ctrl++", () => {
    const p = parseKeyCombo("Ctrl++");
    expect(p).toEqual({ ctrl: true, shift: false, alt: false, key: "+" });
  });
  it("parses Ctrl+=", () => {
    const p = parseKeyCombo("Ctrl+=");
    expect(p).toEqual({ ctrl: true, shift: false, alt: false, key: "=" });
  });
});

describe("KeyboardRegistry dispatch", () => {
  let r: KeyboardRegistry;
  beforeEach(() => {
    r = new KeyboardRegistry();
  });

  it("fires Ctrl+\\ binding when matching event arrives", () => {
    let fired = 0;
    r.register({
      id: "test.toggle",
      key: "Ctrl+\\",
      context: "global",
      handler: () => {
        fired++;
      },
    });
    const teardown = r.install();
    const ev = new KeyboardEvent("keydown", { key: "\\", ctrlKey: true });
    window.dispatchEvent(ev);
    expect(fired).toBe(1);
    teardown();
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ])("treats %s as Mod for a Ctrl+Alt+Arrow binding", (_label, modifiers) => {
    let fired = 0;
    r.register({
      id: "test.modAltArrow",
      key: "Ctrl+Alt+ArrowUp",
      context: "global",
      handler: () => {
        fired++;
      },
    });
    const teardown = r.install();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, ...modifiers }));
    expect(fired).toBe(1);
    teardown();
  });

  // Browsers report the shifted character (e.g. "%" for Shift+5) in e.key.
  // Bindings are declared with the unshifted form (e.g. "Shift+5"), so the
  // dispatcher must normalise shifted symbols back to their base key.
  it.each([
    ["Shift+5", "%", "5"],
    ["Shift+4", "$", "4"],
    ["Shift+3", "#", "3"],
    ["Shift+-", "_", "-"],
    ["Shift+=", "+", "="],
  ])("fires %s when shifted symbol %s is pressed", (combo, shiftedKey) => {
    let fired = 0;
    r.register({
      id: `test.${combo}`,
      key: combo,
      context: "global",
      handler: () => {
        fired++;
      },
    });
    const teardown = r.install();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: shiftedKey, shiftKey: true }));
    expect(fired).toBe(1);
    teardown();
  });
});
