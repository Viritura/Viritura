import {
  DURATION_BEATS,
  plainTextContent,
  textContentFromPlain,
  type NoteValueBase,
  type SystemText,
  type TempoNoteValue,
} from "@viritura/core";

const NOTE_PREFIXES: Record<string, NoteValueBase> = {
  b: "breve",
  w: "whole",
  h: "half",
  q: "quarter",
  e: "eighth",
  s: "16th",
  t: "32nd",
};
const NOTE_TOKENS = [...Object.keys(DURATION_BEATS), ...Object.keys(NOTE_PREFIXES)].join("|");
const NUMBER = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const BPM_NUMBER = new RegExp(`^${NUMBER}$`);
const EXPLICIT_TEMPO = new RegExp(`^(.*?)\\b(${NOTE_TOKENS})(\\.*)\\s*=\\s*(.*?)$`, "i");
const SHORT_TEMPO = new RegExp(`^(.*?)\\b([bwhqest])(\\.*)\\s*(${NUMBER})$`, "i");

interface ParsedInstruction {
  text: string;
  tempo?: { bpm: number; value: TempoNoteValue };
}

type InlineInstructionResult = { ok: true; instruction: ParsedInstruction } | { ok: false; error: string };

function isNoteValue(value: string): value is NoteValueBase {
  return Object.hasOwn(DURATION_BEATS, value);
}

export function parseInlineInstruction(input: string): InlineInstructionResult {
  const trimmed = input.trim();
  const match = EXPLICIT_TEMPO.exec(trimmed) ?? SHORT_TEMPO.exec(trimmed);
  if (!match && !BPM_NUMBER.test(trimmed)) {
    return { ok: true, instruction: { text: trimmed } };
  }
  const rawBpm = (match?.[4] ?? trimmed).trim();
  const bpm = Number(rawBpm);
  if (!BPM_NUMBER.test(rawBpm) || !Number.isFinite(bpm) || bpm <= 0) {
    return { ok: false, error: "Enter a BPM greater than zero, for example q=180." };
  }
  const token = match?.[2]?.toLowerCase() ?? "q";
  const base = NOTE_PREFIXES[token] ?? (isNoteValue(token) ? token : undefined);
  if (!base) return { ok: false, error: "Use a supported tempo beat unit, for example q=180." };
  const dots = match?.[3]?.length ?? 0;
  return {
    ok: true,
    instruction: {
      text: match?.[1]?.trim() ?? "",
      tempo: { bpm, value: { base, ...(dots ? { dots } : {}) } },
    },
  };
}

export function inlineInstructionValue(instruction: SystemText): string {
  const text = plainTextContent(instruction.text);
  if (instruction.tempo?.bpm === undefined) return text;
  const { bpm, value } = instruction.tempo;
  const token = Object.entries(NOTE_PREFIXES).find(([, base]) => base === value.base)?.[0] ?? value.base;
  return [text, `${token}${".".repeat(value.dots ?? 0)}=${bpm}`].filter(Boolean).join(" ");
}

export function applyInlineInstruction(instruction: SystemText, input: string): SystemText {
  const parsed = parseInlineInstruction(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const { tempo: _tempo, ...textInstruction } = instruction;
  const { text, tempo } = parsed.instruction;
  return {
    ...textInstruction,
    text: text === plainTextContent(instruction.text) ? instruction.text : textContentFromPlain(text),
    ...(tempo ? { tempo: { ...instruction.tempo, ...tempo } } : {}),
  };
}
