/**
 * Helper hooks for NotationInspector — auto-scroll + tie/slur form bindings.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Score } from "@viritura/core";
import type { SelectableElementType } from "../../score/elementTypes";
import { sectionForElementType, type InspectorSection } from "./notationInspectorMeta";
import {
  setPrimarySlurProperties,
  setPrimaryTieProperties,
  type NotationSelectionTarget,
} from "../../commands/notationInspectorCommands";
import {
  applyColorToSelection,
  normalizeHexColor,
  resolveColorSelectionTarget,
  type ColorSelectionTarget,
} from "../../commands/colorCommands";

interface AutoScrollArgs {
  preferredSection: InspectorSection | null | undefined;
  selectedElementType: SelectableElementType | null;
  tieSectionRef: RefObject<HTMLFieldSetElement | null>;
  slurSectionRef: RefObject<HTMLFieldSetElement | null>;
  layoutSectionRef: RefObject<HTMLFieldSetElement | null>;
  setFocusedSection: (s: InspectorSection | null) => void;
}

function scrollToSection(
  section: InspectorSection,
  refs: {
    tie: RefObject<HTMLFieldSetElement | null>;
    slur: RefObject<HTMLFieldSetElement | null>;
    layout: RefObject<HTMLFieldSetElement | null>;
  },
): void {
  const map: Partial<Record<InspectorSection, HTMLFieldSetElement | null>> = {
    tie: refs.tie.current,
    slur: refs.slur.current,
    layout: refs.layout.current,
  };
  const el = map[section] ?? null;
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

export function useInspectorAutoScroll({
  preferredSection,
  selectedElementType,
  tieSectionRef,
  slurSectionRef,
  layoutSectionRef,
  setFocusedSection,
}: AutoScrollArgs): void {
  // Explicit preferred section (from props)
  useEffect(() => {
    if (!preferredSection) return;
    setFocusedSection(preferredSection);
    const timer = window.setTimeout(() => setFocusedSection(null), 1200);
    scrollToSection(preferredSection, { tie: tieSectionRef, slur: slurSectionRef, layout: layoutSectionRef });
    return () => window.clearTimeout(timer);
  }, [preferredSection, setFocusedSection, tieSectionRef, slurSectionRef, layoutSectionRef]);

  // Element-type driven auto-scroll
  useEffect(() => {
    if (preferredSection) return;
    if (!selectedElementType) {
      setFocusedSection(null);
      return;
    }
    const targetSection = sectionForElementType(selectedElementType);
    if (!targetSection) {
      setFocusedSection(null);
      return;
    }
    setFocusedSection(targetSection);
    const timer = window.setTimeout(() => setFocusedSection(null), 1200);
    scrollToSection(targetSection, { tie: tieSectionRef, slur: slurSectionRef, layout: layoutSectionRef });
    return () => window.clearTimeout(timer);
  }, [selectedElementType, preferredSection, setFocusedSection, tieSectionRef, slurSectionRef, layoutSectionRef]);
}

interface TieSlurHandlersArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (s: Score) => void;
}

export interface TieSlurHandlers {
  tieError: string | null;
  slurError: string | null;
  handleTieTargetChange: (v: string) => void;
  handleTieTargetTypeChange: (v: string) => void;
  handleTieSideChange: (v: string) => void;
  handleTieLvChange: (checked: boolean) => void;
  handleSlurTargetChange: (v: string) => void;
  handleSlurSideChange: (v: string) => void;
  handleSlurSideEndChange: (v: string) => void;
  handleSlurLineTypeChange: (v: string) => void;
  handleSlurStartNoteChange: (v: string) => void;
  handleSlurEndNoteChange: (v: string) => void;
}

function parseSide(value: string): "up" | "down" | null {
  return value === "up" || value === "down" ? value : null;
}

function parseLineType(value: string): "solid" | "dashed" | "dotted" | null {
  return value === "solid" || value === "dashed" || value === "dotted" ? value : null;
}

export function useTieSlurHandlers({ score, target, updateScore }: TieSlurHandlersArgs): TieSlurHandlers {
  const [tieError, setTieError] = useState<string | null>(null);
  const [slurError, setSlurError] = useState<string | null>(null);

  const applyTie = useCallback(
    (patch: Parameters<typeof setPrimaryTieProperties>[2], errorMsg: string) => {
      if (!score || !target) return;
      const result = setPrimaryTieProperties(score, target, patch);
      if (!result.ok || !result.score) {
        setTieError(result.error ?? errorMsg);
        return;
      }
      setTieError(null);
      updateScore(result.score);
    },
    [score, target, updateScore],
  );

  const applySlur = useCallback(
    (patch: Parameters<typeof setPrimarySlurProperties>[2], errorMsg: string) => {
      if (!score || !target) return;
      const result = setPrimarySlurProperties(score, target, patch);
      if (!result.ok || !result.score) {
        setSlurError(result.error ?? errorMsg);
        return;
      }
      setSlurError(null);
      updateScore(result.score);
    },
    [score, target, updateScore],
  );

  return {
    tieError,
    slurError,
    handleTieTargetChange: (v: string) =>
      applyTie({ target: v.trim() === "" ? null : v.trim() }, "Unable to update tie target."),
    handleTieTargetTypeChange: (v: string) =>
      applyTie({ targetType: v.trim() === "" ? null : v.trim() }, "Unable to update tie target type."),
    handleTieSideChange: (v: string) =>
      applyTie({ side: v.trim() === "" ? null : v.trim() }, "Unable to update tie side."),
    handleTieLvChange: (checked: boolean) =>
      applyTie({ lv: checked ? true : null }, "Unable to update tie laissez vibrer."),
    handleSlurTargetChange: (v: string) => {
      const trimmed = v.trim();
      if (!trimmed) {
        setSlurError("Slur target is required.");
        return;
      }
      applySlur({ target: trimmed }, "Unable to update slur target.");
    },
    handleSlurSideChange: (v: string) => applySlur({ side: parseSide(v) }, "Unable to update slur side."),
    handleSlurSideEndChange: (v: string) => applySlur({ sideEnd: parseSide(v) }, "Unable to update slur end side."),
    handleSlurLineTypeChange: (v: string) =>
      applySlur({ lineType: parseLineType(v) }, "Unable to update slur line type."),
    handleSlurStartNoteChange: (v: string) =>
      applySlur({ startNote: v.trim() === "" ? null : v.trim() }, "Unable to update slur start note."),
    handleSlurEndNoteChange: (v: string) =>
      applySlur({ endNote: v.trim() === "" ? null : v.trim() }, "Unable to update slur end note."),
  };
}

interface ColorHandlersArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (s: Score) => void;
}

export interface ColorHandlers {
  selectionTarget: ColorSelectionTarget | null;
  colorInput: string;
  setColorInput: (v: string) => void;
  colorError: string | null;
  setColorError: (v: string | null) => void;
  applySelectedColor: (rawColor: string | null) => void;
}

export function useColorHandlers({ score, target, updateScore }: ColorHandlersArgs): ColorHandlers {
  const selectionTarget = score ? resolveColorSelectionTarget(score, target) : null;
  const [colorInput, setColorInput] = useState("#000000");
  const [colorError, setColorError] = useState<string | null>(null);

  useEffect(() => {
    setColorInput(selectionTarget?.color ?? "#000000");
    setColorError(null);
  }, [selectionTarget?.color, selectionTarget?.kind, target?.elementId]);

  const applySelectedColor = useCallback(
    (rawColor: string | null) => {
      if (!score || !target || !selectionTarget) return;
      if (rawColor === null) {
        setColorInput("#000000");
        setColorError(null);
        const newScore = applyColorToSelection(score, target, null);
        if (newScore !== score) updateScore(newScore);
        return;
      }
      const parsed = normalizeHexColor(rawColor);
      if (!parsed) {
        setColorError("Use #RRGGBB");
        return;
      }
      setColorInput(parsed);
      setColorError(null);
      const newScore = applyColorToSelection(score, target, parsed);
      if (newScore !== score) updateScore(newScore);
    },
    [score, target, selectionTarget, updateScore],
  );

  return {
    selectionTarget,
    colorInput,
    setColorInput,
    colorError,
    setColorError,
    applySelectedColor,
  };
}
