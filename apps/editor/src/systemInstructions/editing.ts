import {
  generateId,
  DEFAULT_TEXT_STYLES,
  measureTempoInstructions,
  resolveTempoSwing,
  type Score,
  type SystemText,
  type SystemTempo,
  type Tempo,
  type TextStyles,
  type ResolvedTempoSwing,
} from "@viritura/core";
import { produce } from "../score/scoreClone";

export function resolveInstructionSwing(
  score: Score,
  measureIndex: number,
  instruction: SystemText,
  legacyTempoIndex?: number,
): ResolvedTempoSwing {
  const measure = score.global.measures[measureIndex];
  if (!measure) throw new RangeError("The instruction's bar no longer exists.");
  const tempos: Tempo[] = measureTempoInstructions({
    ...measure,
    tempos: measure.tempos?.filter((_, index) => index !== legacyTempoIndex),
    systemText: measure.systemText?.filter((text) => text.id !== instruction.id),
  });
  tempos.push({ ...instruction.tempo, text: instruction.text, location: instruction.position });
  const measures = [...score.global.measures];
  measures[measureIndex] = { ...measure, tempos, systemText: undefined };
  return resolveTempoSwing(measures, measureIndex, tempos.length - 1);
}

export function instructionFromTempo(tempo: Tempo, id = generateId(), textStyles?: TextStyles): SystemText {
  const playback: SystemTempo | undefined =
    tempo.bpm !== undefined
      ? {
          bpm: tempo.bpm,
          value: tempo.value,
          swing: tempo.swing,
          showMetronomeMark: tempo.showMetronomeMark,
        }
      : tempo.swing
        ? { swing: tempo.swing }
        : undefined;
  const role = { ...DEFAULT_TEXT_STYLES.tempo!, ...textStyles?.tempo };
  const text = tempo.text?.length
    ? tempo.text
    : [
        {
          text: tempo.bpm === undefined && tempo.swing ? (tempo.swing.mode === "straight" ? "Straight" : "Swing") : "",
        },
      ];
  return {
    id,
    text: text.map((chunk) => ({
      ...chunk,
      style: {
        ...chunk.style,
        font: chunk.style?.font ?? role.family,
        // Music-relative text uses a 2sp base instead of the legacy tempo role.
        size: ((chunk.style?.size ?? 1) * role.size) / 2,
        weight: chunk.style?.weight ?? (role.bold ? "bold" : "normal"),
        fontStyle: chunk.style?.fontStyle ?? (role.italic ? "italic" : "normal"),
        color: chunk.style?.color ?? role.color,
      },
    })),
    position: tempo.location ?? { fraction: [0, 1] },
    placement: "above",
    manualOffset: tempo.manualOffset,
    avoidCollisions: tempo.avoidCollisions,
    showText: tempo.showText,
    ...(playback ? { tempo: playback } : {}),
  };
}

export function withInstructionBpm(instruction: SystemText, bpm: number | undefined): SystemText {
  const current = instruction.tempo;
  if (bpm !== undefined) {
    if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError("BPM must be greater than zero.");
    return {
      ...instruction,
      tempo: {
        bpm,
        value: current?.value ?? { base: "quarter" },
        swing: current?.swing,
        showMetronomeMark: current?.showMetronomeMark,
      },
    };
  }
  const { tempo: _tempo, ...text } = instruction;
  return current?.swing ? { ...text, tempo: { swing: current.swing } } : text;
}

export function saveSystemInstruction(
  score: Score,
  measureIndex: number,
  instruction: SystemText,
  legacyTempoIndex?: number,
): Score {
  if (!score.global.measures[measureIndex]) throw new RangeError("The instruction's bar no longer exists.");
  if (!instruction.text.length) throw new Error("System instructions require a text-content array.");
  if (instruction.tempo?.bpm !== undefined && (!Number.isFinite(instruction.tempo.bpm) || instruction.tempo.bpm <= 0)) {
    throw new RangeError("BPM must be greater than zero.");
  }
  return produce(score, (draft) => {
    const measure = draft.global.measures[measureIndex]!;
    if (legacyTempoIndex !== undefined) {
      if (!measure.tempos?.[legacyTempoIndex]) throw new Error("The tempo marking no longer exists.");
      measure.tempos.splice(legacyTempoIndex, 1);
      if (!measure.tempos.length) delete measure.tempos;
    }
    const texts = (measure.systemText ??= []);
    const index = texts.findIndex((text) => text.id === instruction.id);
    if (index < 0) texts.push(instruction);
    else texts[index] = instruction;
  });
}
