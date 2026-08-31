/**
 * Binding definitions for the editor keyboard handler.
 *
 * Each binding is registered through KeyboardRegistry. Conflicts in
 * (key, context) throw at startup.
 *
 * Sub-handlers (noteInputHandlers, normalModeHandlers, navigationHandlers)
 * remain untouched — bindings here simply route into them.
 */

import type { KeyBinding } from "./KeyboardRegistry";
import type { KeyboardHandlerContext } from "./types";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { RefObject } from "react";
import { DURATION_KEY_MAP } from "../commands/noteInputCommands";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import { isAnnotationId, getParentEventId, findNextAnnotation, findPrevAnnotation } from "../navigation/annotationNav";
import { handleNoteInputKey, handleNoteInputArrowUpDown } from "./noteInputHandlers";
import {
  handleArrowUpDown,
  handleSlurKey,
  handleTieKey,
  handleDurationChange,
  applyEditTransform,
  applyAccidentalToSelection,
  stepAccidentalOnSelection,
  handleFlip,
} from "./normalModeHandlers";
import { handleDelete } from "./normalModeDelete";
import { handleArrowLeftRight, handleHomeEnd } from "./navigationHandlers";

// ─── Config interface (passed in from the hook) ─────────────────────

export interface EditorBindingConfig {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  getCurrentZoom: () => number;
  ctx: KeyboardHandlerContext;
  appCallbacks: {
    onShowHelp: () => void;
    onOpenJumpBar?: () => void;
    onOpenFile: () => void;
    onOpenMnxFile?: () => void;
    onOpenPublish?: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onTogglePanels?: () => void;
    onToggleCondensingPopover?: () => void;
    onSetTempo?: () => void;
    onAddStaffText?: () => void;
    onRepeat?: () => void;
    onPreviousScoreOrPart?: () => void;
    onNextScoreOrPart?: () => void;
    onOpenRadialMenu?: (cat: import("../radialMenu").RadialMenuCategory) => void;
  };
  selectAll: () => void;
  setVoice: (v: 1 | 2 | 3 | 4) => void;
  toggleNoteInput: () => void;
  selectElement: (id: string) => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  setAccidental: (acc: import("@viritura/core").AccidentalType) => void;
}

/** Build the binding list from current handlers + config. */
export function buildEditorBindings(cfg: EditorBindingConfig): KeyBinding[] {
  return [
    ...buildGlobalAlwaysActiveBindings(cfg),
    ...buildGlobalGuardedBindings(cfg),
    ...buildNoteInputBindings(cfg),
    ...buildNormalModeBindings(cfg),
    ...buildNormalAccidentalBindings(cfg),
    ...buildNormalDurationBindings(cfg),
  ];
}

// ─── Section builders ────────────────────────────────────────────────

function buildGlobalAlwaysActiveBindings(cfg: EditorBindingConfig): KeyBinding[] {
  const { ctx, appCallbacks: cb } = cfg;
  const bindings: KeyBinding[] = [];

  // ═══════════════════════════════════════════
  // Global — always active, fire even in text inputs (browser shortcuts)
  // ═══════════════════════════════════════════

  bindings.push(
    {
      id: "global.escape",
      key: "Escape",
      context: "global",
      allowInTextInput: true,
      handler: () => {
        const ni = ctx.getNoteInput();
        if (ni.active) {
          cfg.toggleNoteInput();
          return;
        }
        const sel = ctx.getSelection();
        if (sel.kind === "single" && isAnnotationId(sel.elementId)) {
          const parentId = getParentEventId(sel.elementId);
          if (parentId) {
            cfg.selectElement(parentId);
            return;
          }
        }
        cfg.clearSelection();
      },
    },
    {
      id: "global.help",
      key: "F1",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onShowHelp(),
    },
    {
      id: "global.jumpBar",
      key: "Ctrl+Space",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onOpenJumpBar?.(),
    },
    {
      id: "global.openProject",
      key: "Ctrl+O",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onOpenFile(),
    },
    {
      id: "global.openMnxFile",
      key: "Ctrl+Shift+O",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onOpenMnxFile?.(),
    },
    {
      id: "global.publish",
      key: "Ctrl+P",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onOpenPublish?.(),
    },
    {
      id: "global.save",
      key: "Ctrl+S",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onSave(),
    },
    {
      id: "global.saveAs",
      key: "Ctrl+Shift+S",
      context: "global",
      allowInTextInput: true,
      handler: () => cb.onSaveAs(),
    },
    {
      id: "global.undo",
      key: "Ctrl+Z",
      context: "global",
      allowInTextInput: true,
      handler: () => cfg.undo(),
    },
    {
      id: "global.redo",
      key: "Ctrl+Y",
      context: "global",
      allowInTextInput: true,
      handler: () => cfg.redo(),
    },
    {
      id: "global.redo.alt",
      key: "Ctrl+Shift+Z",
      context: "global",
      allowInTextInput: true,
      handler: () => cfg.redo(),
    },
  );

  return bindings;
}

function buildGlobalGuardedBindings(cfg: EditorBindingConfig): KeyBinding[] {
  const { appCallbacks: cb } = cfg;
  const bindings: KeyBinding[] = [];

  // ═══════════════════════════════════════════
  // Global — disabled inside text inputs
  // ═══════════════════════════════════════════

  bindings.push(
    {
      id: "global.toggleNoteInput",
      key: "N",
      context: "global",
      handler: () => cfg.toggleNoteInput(),
    },
    {
      id: "global.selectAll",
      key: "Ctrl+A",
      context: "global",
      handler: () => cfg.selectAll(),
    },
    {
      id: "global.copy",
      key: "Ctrl+C",
      context: "global",
      handler: () => cb.onCopy(),
    },
    {
      id: "global.cut",
      key: "Ctrl+X",
      context: "global",
      handler: () => cb.onCut(),
    },
    {
      id: "global.paste",
      key: "Ctrl+V",
      context: "global",
      handler: () => cb.onPaste(),
    },
    {
      id: "global.togglePanels",
      key: "Ctrl+\\",
      context: "global",
      handler: () => cb.onTogglePanels?.(),
    },
    {
      id: "global.zoomIn",
      key: "Ctrl+=",
      context: "global",
      handler: () => {
        const z = Math.min(cfg.getCurrentZoom() * 1.25, MAX_ZOOM);
        cfg.canvasRef.current?.setZoom(z);
      },
    },
    {
      id: "global.zoomIn.plus",
      key: "Ctrl++",
      context: "global",
      handler: () => {
        const z = Math.min(cfg.getCurrentZoom() * 1.25, MAX_ZOOM);
        cfg.canvasRef.current?.setZoom(z);
      },
    },
    {
      id: "global.zoomOut",
      key: "Ctrl+-",
      context: "global",
      handler: () => {
        const z = Math.max(cfg.getCurrentZoom() / 1.25, MIN_ZOOM);
        cfg.canvasRef.current?.setZoom(z);
      },
    },
    {
      id: "global.zoomReset",
      key: "Ctrl+0",
      context: "global",
      handler: () => cfg.canvasRef.current?.resetViewport(),
    },
    {
      id: "global.voice1",
      key: "Alt+1",
      context: "global",
      handler: () => cfg.setVoice(1),
    },
    {
      id: "global.voice2",
      key: "Alt+2",
      context: "global",
      handler: () => cfg.setVoice(2),
    },
    {
      id: "global.voice3",
      key: "Alt+3",
      context: "global",
      handler: () => cfg.setVoice(3),
    },
    {
      id: "global.voice4",
      key: "Alt+4",
      context: "global",
      handler: () => cfg.setVoice(4),
    },
    {
      id: "global.condensing",
      key: "Alt+C",
      context: "global",
      handler: () => cb.onToggleCondensingPopover?.(),
    },
  );

  return bindings;
}

function buildNoteInputBindings(cfg: EditorBindingConfig): KeyBinding[] {
  const { ctx } = cfg;
  const bindings: KeyBinding[] = [];

  // ═══════════════════════════════════════════
  // Note input mode — Dorico-style ArrowUp/Down (staff travel / transpose)
  // ═══════════════════════════════════════════

  for (const arrow of ["ArrowUp", "ArrowDown"]) {
    for (const mod of ["", "Alt+", "Shift+Alt+", "Ctrl+Alt+"]) {
      bindings.push({
        id: `noteInput.arrow.${mod}${arrow}`,
        key: `${mod}${arrow}`,
        context: "noteInput",
        handler: (e) => handleNoteInputArrowUpDown(e, ctx),
      });
    }
  }

  // ═══════════════════════════════════════════
  // Note input mode — letters A-G (note entry + Shift = chord tone)
  // ═══════════════════════════════════════════

  for (const letter of ["A", "B", "C", "D", "E", "F", "G"]) {
    bindings.push({
      id: `noteInput.letter.${letter}`,
      key: letter,
      context: "noteInput",
      handler: (e) => handleNoteInputKey(e, ctx),
    });
    bindings.push({
      id: `noteInput.letter.shift.${letter}`,
      key: `Shift+${letter}`,
      context: "noteInput",
      handler: (e) => handleNoteInputKey(e, ctx),
    });
  }

  // ═══════════════════════════════════════════
  // Note input mode — durations 1-9 + rest 0
  // ═══════════════════════════════════════════

  for (let n = 0; n <= 9; n++) {
    bindings.push({
      id: `noteInput.digit.${n}`,
      key: String(n),
      context: "noteInput",
      handler: (e) => handleNoteInputKey(e, ctx),
    });
  }

  // ═══════════════════════════════════════════
  // Note input mode — accidentals & misc
  // ═══════════════════════════════════════════

  bindings.push(
    { id: "noteInput.flat", key: "-", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.sharp", key: "=", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.natural", key: "\\", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.stepAccDown", key: "Shift+-", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.stepAccUp", key: "Shift+=", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.doubleFlat", key: "Z", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.doubleSharp", key: "X", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.dot", key: ".", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.grace", key: "/", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.backspace", key: "Backspace", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.delete", key: "Delete", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.tieFlag", key: "T", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.slurFlag", key: "S", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.tupletMenu", key: "Shift+T", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.cursorAdvance", key: "Space", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.cursorLeft", key: "ArrowLeft", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    {
      id: "noteInput.cursorRight",
      key: "ArrowRight",
      context: "noteInput",
      handler: (e) => handleNoteInputKey(e, ctx),
    },
    { id: "noteInput.prevEvent", key: "H", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
    { id: "noteInput.nextMeasure", key: "J", context: "noteInput", handler: (e) => handleNoteInputKey(e, ctx) },
  );

  return bindings;
}

function buildNormalModeBindings(cfg: EditorBindingConfig): KeyBinding[] {
  const { ctx, appCallbacks: cb } = cfg;
  const bindings: KeyBinding[] = [];

  // ═══════════════════════════════════════════
  // Normal mode — navigation, editing, transposition
  // ═══════════════════════════════════════════

  bindings.push(
    {
      id: "normal.previousScoreOrPart",
      key: "Alt+PageUp",
      context: "normal",
      handler: () => cb.onPreviousScoreOrPart?.(),
    },
    {
      id: "normal.nextScoreOrPart",
      key: "Alt+PageDown",
      context: "normal",
      handler: () => cb.onNextScoreOrPart?.(),
    },
  );

  // Delete / Backspace → replace with rest
  bindings.push({
    id: "normal.delete",
    key: "Delete",
    context: "normal",
    handler: (e) => handleDelete(e, e.ctrlKey || e.metaKey, ctx),
  });
  bindings.push({
    id: "normal.backspace",
    key: "Backspace",
    context: "normal",
    handler: (e) => handleDelete(e, e.ctrlKey || e.metaKey, ctx),
  });

  // Dorico-style ArrowUp/Down — staff navigation/extension or transposition
  for (const arrow of ["ArrowUp", "ArrowDown"]) {
    for (const mod of ["", "Shift+", "Alt+", "Shift+Alt+", "Ctrl+Alt+"]) {
      bindings.push({
        id: `normal.arrow.${mod}${arrow}`,
        key: `${mod}${arrow}`,
        context: "normal",
        handler: (e) => handleArrowUpDown(e, e.ctrlKey || e.metaKey, ctx),
      });
    }
  }

  // Alt+ArrowLeft/Right — annotation cycle
  bindings.push({
    id: "normal.annotationPrev",
    key: "Alt+ArrowLeft",
    context: "normal",
    handler: () => {
      const sel = ctx.getSelection();
      if (sel.kind === "single" && isAnnotationId(sel.elementId)) {
        const sc = ctx.getScore();
        if (sc) {
          const target = findPrevAnnotation(sc, sel.elementId);
          if (target) cfg.selectElement(target);
        }
      }
    },
  });
  bindings.push({
    id: "normal.annotationNext",
    key: "Alt+ArrowRight",
    context: "normal",
    handler: () => {
      const sel = ctx.getSelection();
      if (sel.kind === "single" && isAnnotationId(sel.elementId)) {
        const sc = ctx.getScore();
        if (sc) {
          const target = findNextAnnotation(sc, sel.elementId);
          if (target) cfg.selectElement(target);
        }
      }
    },
  });

  // ArrowLeft / ArrowRight — element navigation
  for (const arrow of ["ArrowLeft", "ArrowRight"]) {
    for (const mod of ["", "Ctrl+", "Shift+"]) {
      bindings.push({
        id: `normal.arrow.${mod}${arrow}`,
        key: `${mod}${arrow}`,
        context: "normal",
        handler: (e) => handleArrowLeftRight(e, e.ctrlKey || e.metaKey, ctx),
      });
    }
  }

  // Home / End
  bindings.push(
    { id: "normal.home", key: "Home", context: "normal", handler: (e) => handleHomeEnd(e, ctx) },
    { id: "normal.end", key: "End", context: "normal", handler: (e) => handleHomeEnd(e, ctx) },
  );

  // . dot
  bindings.push({
    id: "normal.dot",
    key: ".",
    context: "normal",
    handler: () => applyEditTransform("toggleDot", ctx),
  });

  // Q — toggle chord-mode lock (standard; A-G adds to chord instead of advancing).
  // Note input: toggles chord lock on the current state.
  // Normal mode: turns on note input AND enables chord lock immediately.
  bindings.push({
    id: "noteInput.chordLock",
    key: "Q",
    context: "noteInput",
    handler: () => ctx.toggleChordLock(),
  });
  bindings.push({
    id: "normal.chordLock",
    key: "Q",
    context: "normal",
    handler: () => {
      if (!ctx.getNoteInput().active) {
        ctx.toggleNoteInput();
      }
      ctx.setChordLock(true);
    },
  });

  // S — slur
  bindings.push({
    id: "normal.slur",
    key: "S",
    context: "normal",
    handler: (e) => handleSlurKey(e, ctx),
  });

  // T — tie
  bindings.push({
    id: "normal.tie",
    key: "T",
    context: "normal",
    handler: (e) => handleTieKey(e, ctx),
  });

  // F — flip selected notation
  bindings.push({
    id: "normal.flip",
    key: "F",
    context: "normal",
    handler: () => handleFlip(ctx),
  });

  // R — repeat selection (copy + paste after)
  bindings.push({
    id: "normal.repeatSelection",
    key: "R",
    context: "normal",
    handler: () => cb.onRepeat?.(),
  });

  // Radial menus — Shift+letter
  const radialMenus: [string, import("../radialMenu").RadialMenuCategory][] = [
    ["Shift+C", "clef"],
    ["Shift+B", "barline"],
    ["Shift+5", "key-signature"],
    ["Shift+M", "time-signature"],
    ["Shift+4", "time-signature"],
    ["Shift+D", "dynamic"],
    ["Shift+O", "ornament"],
    ["Shift+E", "ornament"],
    ["Shift+3", "tuplet"],
    ["Shift+H", "breath-fermata"],
    ["Shift+F", "fingering"],
    ["Shift+R", "repeat"],
    ["Shift+A", "articulation"],
  ];
  for (const [key, cat] of radialMenus) {
    bindings.push({
      id: `normal.radial.${cat}.${key}`,
      key,
      context: "normal",
      handler: () => cb.onOpenRadialMenu?.(cat),
    });
  }

  // Shift+T — tempo (normal only; in note input Shift+T = tuplet menu)
  bindings.push({
    id: "normal.tempo",
    key: "Shift+T",
    context: "normal",
    handler: () => cb.onSetTempo?.(),
  });

  // Shift+X — staff text
  bindings.push({
    id: "normal.staffText",
    key: "Shift+X",
    context: "normal",
    handler: () => cb.onAddStaffText?.(),
  });

  return bindings;
}

function buildNormalAccidentalBindings(cfg: EditorBindingConfig): KeyBinding[] {
  const { ctx } = cfg;
  const bindings: KeyBinding[] = [];

  // Accidentals
  bindings.push(
    {
      id: "normal.flat",
      key: "-",
      context: "normal",
      handler: () => {
        applyAccidentalToSelection("flat", ctx);
        cfg.setAccidental("flat");
      },
    },
    {
      id: "normal.sharp",
      key: "=",
      context: "normal",
      handler: () => {
        applyAccidentalToSelection("sharp", ctx);
        cfg.setAccidental("sharp");
      },
    },
    {
      id: "normal.natural",
      key: "0",
      context: "normal",
      handler: () => {
        applyAccidentalToSelection("natural", ctx);
        cfg.setAccidental("natural");
      },
    },
    {
      id: "normal.stepAccDown",
      key: "Shift+-",
      context: "normal",
      handler: () => {
        stepAccidentalOnSelection(-1, ctx);
      },
    },
    {
      id: "normal.stepAccUp",
      key: "Shift+=",
      context: "normal",
      handler: () => {
        stepAccidentalOnSelection(1, ctx);
      },
    },
  );

  return bindings;
}

function buildNormalDurationBindings(cfg: EditorBindingConfig): KeyBinding[] {
  const { ctx } = cfg;
  const bindings: KeyBinding[] = [];

  // Duration keys 1-8 (normal mode — change selected note's duration)
  for (const k of Object.keys(DURATION_KEY_MAP)) {
    bindings.push({
      id: `normal.duration.${k}`,
      key: k,
      context: "normal",
      handler: (e) => {
        const durBase = DURATION_KEY_MAP[e.key];
        if (durBase) handleDurationChange(e, durBase, ctx);
      },
    });
  }

  return bindings;
}
