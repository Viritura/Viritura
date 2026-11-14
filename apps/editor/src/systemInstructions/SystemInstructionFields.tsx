import type { ResolvedTempoSwing, Swing, SystemText, Tempo } from "@viritura/core";
import type { ReactNode } from "react";
import { FormField, Select } from "@viritura/ui";
import { TempoSection } from "../components/inspector/TempoSection";
import { inheritedStyleForExpression } from "../components/inspector/TextContentEditor";
import { StaffTextFrameFields } from "../components/textFrames";
import { withInstructionBpm } from "./editing";

export function SystemInstructionFields({
  instruction,
  onChange,
  positioning,
  effectiveSwing,
}: {
  instruction: SystemText;
  onChange: (instruction: SystemText) => void;
  positioning?: ReactNode;
  effectiveSwing?: ResolvedTempoSwing;
}) {
  const playback = instruction.tempo;
  const tempo: Tempo = playback
    ? { ...playback, text: instruction.text, showText: instruction.showText }
    : { text: instruction.text, showText: instruction.showText };
  const setSwing = (swing: Swing | undefined) => {
    if (playback?.bpm !== undefined) onChange({ ...instruction, tempo: { ...playback, swing } });
    else onChange({ ...instruction, tempo: swing ? { swing } : undefined });
  };
  return (
    <>
      <TempoSection
        title="System instruction"
        tempo={tempo}
        effectiveSwing={effectiveSwing}
        onTempoEnabledChange={(enabled) => onChange(withInstructionBpm(instruction, enabled ? 120 : undefined))}
        onBpmChange={(bpm) => onChange(withInstructionBpm(instruction, bpm))}
        onSwingChange={setSwing}
        onValueBaseChange={(base) => {
          if (playback?.bpm !== undefined) {
            onChange({ ...instruction, tempo: { ...playback, value: { ...playback.value, base } } });
          }
        }}
        onDotsChange={(dots) => {
          if (playback?.bpm !== undefined) {
            onChange({ ...instruction, tempo: { ...playback, value: { ...playback.value, dots: dots || undefined } } });
          }
        }}
        onTextChange={(text) => onChange({ ...instruction, text: text.length ? text : [{ text: "" }] })}
        onShowTextChange={(show) => onChange({ ...instruction, showText: show ? undefined : false })}
        onShowMetronomeChange={(show) => {
          if (playback?.bpm !== undefined) {
            onChange({ ...instruction, tempo: { ...playback, showMetronomeMark: show ? undefined : false } });
          }
        }}
        inheritedStyle={inheritedStyleForExpression(instruction.placement)}
        offset={{
          value: instruction.manualOffset ?? [0, 0],
          onChange: (axis, value) => {
            const offset: [number, number] = [...(instruction.manualOffset ?? [0, 0])];
            offset[axis] = value;
            onChange({ ...instruction, manualOffset: offset });
          },
          onReset: () => onChange({ ...instruction, manualOffset: undefined }),
          avoidCollisions: {
            value: instruction.avoidCollisions !== false,
            onChange: (avoid) => onChange({ ...instruction, avoidCollisions: avoid ? undefined : false }),
          },
        }}
      />
      {positioning}
      <FormField label="Placement">
        <Select
          aria-label="Placement"
          value={instruction.placement ?? "below"}
          options={[
            { value: "above", label: "Above system" },
            { value: "below", label: "Below system" },
          ]}
          onValueChange={(placement) => {
            if (placement !== "above" && placement !== "below") throw new Error("Unsupported system placement.");
            onChange({ ...instruction, placement });
          }}
        />
      </FormField>
      <StaffTextFrameFields
        id="system-instruction-frame"
        label="System instruction frame"
        value={instruction.frame}
        onChange={(frame) => onChange({ ...instruction, frame })}
      />
    </>
  );
}
