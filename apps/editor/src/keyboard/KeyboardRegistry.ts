/**
 * KeyboardRegistry — central registry for all editor keyboard shortcuts.
 *
 * Every editor shortcut goes through this registry. Conflicts (same key in
 * the same context with overlapping `when` predicates) throw at registration
 * so we catch duplicates at startup, not at runtime.
 *
 * Modal dialogs (JumpBar, LyricInput, etc.) intentionally use their own
 * capture-phase listeners — they're modal-scoped, not editor shortcuts.
 *
 * Combo grammar (case-insensitive on letter keys):
 *   "Ctrl+S", "Ctrl+Shift+S", "Shift+C", "Alt+ArrowUp", "Space", "F1", "."
 * Modifiers: Ctrl (= Ctrl on Win/Linux, Cmd on Mac), Shift, Alt.
 * Special keys: ArrowUp/Down/Left/Right, Home, End, Escape, Space, Backspace,
 *   Delete, Enter, Tab, F1–F12. Single chars match e.key case-insensitively.
 */

export type KeyboardContext = "global" | "normal" | "noteInput";

export interface KeyBinding {
  /** Unique stable id for the binding (debugging + conflict reports). */
  readonly id: string;
  /** Key combo string, e.g. "Ctrl+S", "Shift+C", "ArrowLeft", "Space". */
  readonly key: string;
  /** Mode the binding is active in. */
  readonly context: KeyboardContext;
  /**
   * Optional gate. When two bindings share (key, context), they MUST each
   * provide a `when` predicate that's mutually exclusive at dispatch time.
   * Returning false means "skip me".
   */
  readonly when?: (e: KeyboardEvent) => boolean;
  /** Handler. Return true if handled (default true). */
  readonly handler: (e: KeyboardEvent) => boolean | void;
  /** Whether to call preventDefault when handled. Default true. */
  readonly preventDefault?: boolean;
  /** Whether to allow firing while focus is in INPUT/TEXTAREA/SELECT. Default false. */
  readonly allowInTextInput?: boolean;
  /** Capture-phase priority. "high" attaches to a capture-phase listener
   *  that runs before the bubble dispatcher. Default "normal". */
  readonly priority?: "normal" | "high";
}

interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Normalized key — uppercase single chars, "Space", "ArrowUp", … */
  key: string;
}

const SPECIAL_KEY_ALIASES: Record<string, string> = {
  space: "Space",
  esc: "Escape",
  escape: "Escape",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
};

function normalizeKey(raw: string): string {
  const lower = raw.toLowerCase();
  if (SPECIAL_KEY_ALIASES[lower]) return SPECIAL_KEY_ALIASES[lower]!;
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
}

export function parseKeyCombo(combo: string): ParsedCombo {
  // Split on "+" but treat a trailing "+" (or standalone "+") as the key name.
  // e.g. "Ctrl++" → modifiers=["Ctrl"], key="+"
  //      "Shift+=" → modifiers=["Shift"], key="="
  //      "+"        → modifiers=[], key="+"
  let raw = combo;
  let trailingPlus = false;
  if (raw.endsWith("+")) {
    trailingPlus = true;
    raw = raw.slice(0, -1);
  }
  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (trailingPlus) parts.push("+");

  const out: ParsedCombo = { ctrl: false, shift: false, alt: false, key: "" };
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === "ctrl" || lower === "cmd" || lower === "mod") out.ctrl = true;
    else if (lower === "shift") out.shift = true;
    else if (lower === "alt" || lower === "option") out.alt = true;
    else out.key = normalizeKey(p);
  }
  if (!out.key) throw new Error(`Invalid key combo: "${combo}"`);
  return out;
}

/**
 * When Shift is held, browsers report the shifted character (e.g. "%" for
 * Shift+5, "_" for Shift+-). Bindings are declared with the unshifted form
 * (e.g. "Shift+5"), so we map shifted chars back to their US-keyboard base.
 * Letters are unaffected — Shift just upper-cases them, which we already
 * normalise via toUpperCase().
 */
const SHIFTED_TO_BASE: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

/** Normalize an event into the same shape as a parsed combo. */
function eventToCombo(e: KeyboardEvent): ParsedCombo {
  let key = e.key;
  if (key === " ") key = "Space";
  else if (e.shiftKey && SHIFTED_TO_BASE[key]) key = SHIFTED_TO_BASE[key]!;
  else if (key.length === 1) key = key.toUpperCase();
  return {
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key,
  };
}

function _comboMatches(parsed: ParsedCombo, e: ParsedCombo): boolean {
  return parsed.ctrl === e.ctrl && parsed.shift === e.shift && parsed.alt === e.alt && parsed.key === e.key;
}

/** Stringified key for the conflict map (key+context only — `when` is checked at dispatch). */
function bindingSlot(parsed: ParsedCombo, context: KeyboardContext): string {
  return `${context}::${parsed.ctrl ? "C" : ""}${parsed.shift ? "S" : ""}${parsed.alt ? "A" : ""}::${parsed.key}`;
}

interface InternalBinding extends KeyBinding {
  parsed: ParsedCombo;
}

export class KeyboardRegistry {
  private bindings: InternalBinding[] = [];
  private slots = new Map<string, InternalBinding[]>();
  private isInputCallback: () => boolean = () => false;
  private getContextCallback: () => KeyboardContext = () => "normal";
  private listenerInstalled = false;

  /**
   * Register a binding. Returns a teardown function.
   *
   * Conflict rules:
   * - Same `id` re-registered → silently replaces (handles React re-mount cycles).
   * - Different `id`, same (key, context), no `when` guard → throws (true conflict).
   */
  register(binding: KeyBinding): () => void {
    // If this exact ID is already registered (e.g. React re-mount before cleanup
    // fired), replace it silently rather than throwing.
    if (this.bindings.some((b) => b.id === binding.id)) {
      this.unregister(binding.id);
    }

    const parsed = parseKeyCombo(binding.key);
    const internal: InternalBinding = { ...binding, parsed };
    const slot = bindingSlot(parsed, binding.context);
    const existing = this.slots.get(slot);
    if (existing && existing.length > 0) {
      // Only flag as a conflict when a *different* binding occupies the slot
      // and neither side has a `when` discriminator.
      const differentId = existing.some((b) => b.id !== binding.id);
      const lacksGuard = !binding.when || existing.some((b) => !b.when);
      if (differentId && lacksGuard) {
        throw new Error(
          `Keyboard shortcut conflict: "${binding.key}" in context "${binding.context}" ` +
            `is already registered by "${existing[0]!.id}". New binding "${binding.id}" ` +
            `must provide a mutually-exclusive \`when\` predicate (and so must existing ones).`,
        );
      }
    }
    if (existing) existing.push(internal);
    else this.slots.set(slot, [internal]);
    this.bindings.push(internal);
    return () => this.unregister(binding.id);
  }

  unregister(id: string): boolean {
    const idx = this.bindings.findIndex((b) => b.id === id);
    if (idx < 0) return false;
    const removed = this.bindings.splice(idx, 1)[0]!;
    const slot = bindingSlot(removed.parsed, removed.context);
    const list = this.slots.get(slot);
    if (list) {
      const j = list.findIndex((b) => b.id === id);
      if (j >= 0) list.splice(j, 1);
      if (list.length === 0) this.slots.delete(slot);
    }
    return true;
  }

  list(): readonly KeyBinding[] {
    return this.bindings;
  }

  setIsInputCallback(fn: () => boolean): void {
    this.isInputCallback = fn;
  }

  setContextCallback(fn: () => KeyboardContext): void {
    this.getContextCallback = fn;
  }

  /** Install the global window listeners. Returns a teardown function. */
  install(): () => void {
    if (this.listenerInstalled) return () => {};
    this.listenerInstalled = true;
    const captureHandler = (e: KeyboardEvent) => this.dispatch(e, "high");
    const bubbleHandler = (e: KeyboardEvent) => this.dispatch(e, "normal");
    window.addEventListener("keydown", captureHandler, { capture: true });
    window.addEventListener("keydown", bubbleHandler);
    return () => {
      window.removeEventListener("keydown", captureHandler, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", bubbleHandler);
      this.listenerInstalled = false;
    };
  }

  private dispatch(e: KeyboardEvent, phase: "high" | "normal"): void {
    if (e.defaultPrevented) return;
    const evCombo = eventToCombo(e);
    const ctx = this.getContextCallback();
    const isInput = this.isInputCallback();

    // Try the active context first, then fall back to global.
    const contexts: KeyboardContext[] = ctx === "global" ? ["global"] : [ctx, "global"];

    for (const c of contexts) {
      const slot = bindingSlot(evCombo, c);
      const list = this.slots.get(slot);
      if (!list) continue;
      for (const b of list) {
        if ((b.priority ?? "normal") !== phase) continue;
        if (isInput && !b.allowInTextInput) continue;
        if (b.when && !b.when(e)) continue;
        const result = b.handler(e);
        if (result !== false) {
          if (b.preventDefault !== false) e.preventDefault();
          return;
        }
      }
    }
  }
}

/** Singleton — the editor uses this. Tests can construct their own. */
export const keyboardRegistry = new KeyboardRegistry();
