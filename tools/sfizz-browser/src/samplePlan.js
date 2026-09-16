import { parseSfzOpcodes as tokenizeSfzOpcodes } from "./sfzTokenizer.js";

const noteOffsets = new Map([
  ["c", 0],
  ["c#", 1],
  ["db", 1],
  ["d", 2],
  ["d#", 3],
  ["eb", 3],
  ["e", 4],
  ["f", 5],
  ["f#", 6],
  ["gb", 6],
  ["g", 7],
  ["g#", 8],
  ["ab", 8],
  ["a", 9],
  ["a#", 10],
  ["bb", 10],
  ["b", 11],
]);

export function parseSfzOpcodes(text) {
  return tokenizeSfzOpcodes(text).opcodes;
}

export function buildSamplePlan({ filesByPath, memoryLimitBytes, sfzPath, sfzText }) {
  const parsed = tokenizeSfzOpcodes(sfzText);
  const tokens = parsed.opcodes;
  const samplesByPath = new Map();
  const replacements = [];
  let activeDefaultPath = "";
  let totalBytes = 0;

  for (const token of tokens) {
    if (token.name === "default_path") {
      activeDefaultPath = token.value;
      replacements.push({ end: token.valueEnd, start: token.start, value: "" });
      continue;
    }
    if (token.name !== "sample") {
      continue;
    }
    const sample = resolveSampleToken({ activeDefaultPath, filesByPath, samplesByPath, sfzPath, token });
    replacements.push({ end: token.valueEnd, start: token.valueStart, value: sample.sfzSamplePath });
    if (!sample.counted) {
      totalBytes += sample.file.size;
    }
  }

  if (samplesByPath.size === 0) {
    throw new Error("Selected SFZ does not reference any WAV samples.");
  }
  if (totalBytes > memoryLimitBytes) {
    throw new Error(
      `Selected patch references ${totalBytes} bytes, above the configured ${memoryLimitBytes} byte cap.`,
    );
  }

  const rewrittenSfz = applyReplacements(sfzText, replacements);
  return {
    expectedRegionCount: parsed.headers.filter((header) => header.name === "region").length,
    keyswitches: extractKeyswitches(tokens),
    rewrittenSfz,
    samples: [...samplesByPath.values()],
    tokens,
    totalBytes,
  };
}

export function extractKeyswitches(tokens) {
  const byNote = new Map();
  let pendingLast = null;
  let pendingLabel = "";
  let defaultNote = null;

  for (const token of tokens) {
    if (token.name === "sw_default") {
      defaultNote = noteNameToMidi(token.value);
      continue;
    }
    if (token.name === "sw_last") {
      pendingLast = noteNameToMidi(token.value);
      if (!byNote.has(pendingLast)) {
        byNote.set(pendingLast, { isDefault: false, label: midiToNoteName(pendingLast), note: pendingLast });
      }
      if (pendingLabel) {
        byNote.get(pendingLast).label = pendingLabel;
      }
      continue;
    }
    if (token.name === "sw_label") {
      pendingLabel = token.value;
      if (pendingLast !== null && byNote.has(pendingLast)) {
        byNote.get(pendingLast).label = token.value;
      }
    }
  }

  if (defaultNote !== null && byNote.has(defaultNote)) {
    byNote.get(defaultNote).isDefault = true;
  }
  return [...byNote.values()].sort((left, right) => left.note - right.note);
}

export function noteNameToMidi(value) {
  if (/^\d+$/.test(value.trim())) {
    return clampMidi(Number.parseInt(value, 10));
  }
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid SFZ note value: ${value}`);
  }
  const noteName = `${match[1]}${match[2]}`.toLowerCase();
  const noteOffset = noteOffsets.get(noteName);
  if (noteOffset === undefined) {
    throw new Error(`Invalid SFZ note value: ${value}`);
  }
  return clampMidi((Number.parseInt(match[3], 10) + 1) * 12 + noteOffset);
}

function resolveSampleToken({ activeDefaultPath, filesByPath, samplesByPath, sfzPath, token }) {
  const sampleValue = token.value.trim();
  if (!sampleValue || sampleValue.startsWith("*")) {
    throw new Error(`Unsupported non-WAV sample opcode: sample=${sampleValue}`);
  }
  const resolvedPath = resolveSamplePath(sfzPath, activeDefaultPath, sampleValue);
  const fileEntry = filesByPath.get(resolvedPath.toLowerCase());
  if (!fileEntry) {
    throw new Error(`Missing sample referenced by ${sfzPath}: ${resolvedPath}`);
  }
  if (samplesByPath.has(resolvedPath)) {
    return { ...samplesByPath.get(resolvedPath), counted: true };
  }
  const virtualName = `${samplesByPath.size.toString().padStart(4, "0")}-${sanitizeFileName(resolvedPath)}`;
  const sample = {
    file: fileEntry.file,
    originalPath: resolvedPath,
    sfzSamplePath: virtualName,
    virtualPath: `/vsco/${virtualName}`,
  };
  samplesByPath.set(resolvedPath, sample);
  return { ...sample, counted: false };
}

function resolveSamplePath(sfzPath, defaultPath, samplePath) {
  rejectUnsafePath(defaultPath, "default_path");
  rejectUnsafePath(samplePath, "sample");
  const baseSegments = splitPath(dirname(sfzPath));
  const joined = [...baseSegments, ...splitPath(defaultPath), ...splitPath(samplePath)];
  return normalizeSegments(joined);
}

function rejectUnsafePath(value, label) {
  const trimmed = value.trim();
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\")) {
    throw new Error(`Unsupported absolute ${label}: ${value}`);
  }
  if (trimmed.includes("\0") || /^[a-z]+:/i.test(trimmed)) {
    throw new Error(`Unsupported ${label}: ${value}`);
  }
}

function dirname(value) {
  const normalized = value.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function splitPath(value) {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeSegments(segments) {
  const output = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (output.length === 0) {
        throw new Error("SFZ sample path escapes the selected folder.");
      }
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join("/");
}

function sanitizeFileName(value) {
  const name = value.split("/").at(-1) ?? "sample.wav";
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

function applyReplacements(text, replacements) {
  let output = "";
  let cursor = 0;
  for (const replacement of replacements.toSorted((left, right) => left.start - right.start)) {
    output += text.slice(cursor, replacement.start);
    output += replacement.value;
    cursor = replacement.end;
  }
  return output + text.slice(cursor);
}

function clampMidi(value) {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new Error(`MIDI note is out of range: ${value}`);
  }
  return value;
}

function midiToNoteName(note) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}
