import { useState } from "react";
import type { Score } from "@viritura/core";
import { generateId } from "@viritura/core";
import type { NotationSelectionTarget } from "../commands/notationInspectorCommands";
import { systemTextId } from "../score/ElementPath";
import { useSelectionActions } from "../store/selectionStore";
import { StaffTextPositioningField } from "../components/textFrames";
import { SystemInstructionFields } from "./SystemInstructionFields";
import { instructionFromTempo, resolveInstructionSwing, saveSystemInstruction } from "./editing";

export function SystemInstructionProperties({
  score,
  target,
  updateScore,
}: {
  score: Score;
  target: NotationSelectionTarget;
  updateScore: (score: Score) => void;
}) {
  const [id] = useState(generateId);
  const { selectElement } = useSelectionActions();
  const tempoMatch = /^tempo(\d+)$/.exec(target.elementType);
  const tempoIndex = tempoMatch ? Number(tempoMatch[1]) : undefined;
  const measure = score.global.measures[target.measureIndex];
  const legacy = tempoIndex === undefined ? undefined : measure?.tempos?.[tempoIndex];
  const instruction = legacy
    ? instructionFromTempo(legacy, id, score.textStyles)
    : measure?.systemText?.find((text) => text.id === target.systemTextId);
  if (!instruction) return null;
  return (
    <SystemInstructionFields
      instruction={instruction}
      effectiveSwing={resolveInstructionSwing(score, target.measureIndex, instruction, tempoIndex)}
      positioning={
        target.systemTextId ? (
          <StaffTextPositioningField score={score} target={target} updateScore={updateScore} />
        ) : undefined
      }
      onChange={(next) => {
        updateScore(saveSystemInstruction(score, target.measureIndex, next, tempoIndex));
        selectElement(systemTextId(target.measureIndex, next.id));
      }}
    />
  );
}
