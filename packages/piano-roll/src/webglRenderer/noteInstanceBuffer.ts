/**
 * Note-instance buffer packing.
 *
 * Each piano-roll note becomes one instance with this attribute layout:
 *
 *   offset  bytes  attribute      meaning
 *   ------  -----  -------------  ----------------------------------
 *        0     12  a_pitchTime    (midi, startSec, endSec) — vec3
 *       12     16  a_color        (r, g, b, a) in 0..1     — vec4
 *       28      4  a_flags        bitfield                  — float
 *   ------  -----
 *   total:    32 bytes per note (8 floats).
 *
 * The pack function is exported separately so it can be unit-tested
 * without a GL context. The renderer calls it once per note-set change
 * and uploads the resulting Float32Array via `bufferData` /
 * `bufferSubData`.
 */

import type { PianoRollNote } from "../types";
import { FLAG_FROM_REPEAT, FLAG_SELECTED } from "./shaders";

/** Bytes per packed instance. Keep in sync with the layout above. */
export const NOTE_INSTANCE_BYTES = 32;
/** Floats per packed instance. */
export const NOTE_INSTANCE_FLOATS = NOTE_INSTANCE_BYTES / 4;

/** Resolves a `partIndex` to an opaque RGBA tuple in 0..1. */
export interface NoteColorResolver {
  (partIndex: number): readonly [number, number, number, number];
}

export interface PackNotesArgs {
  notes: readonly PianoRollNote[];
  resolveColor: NoteColorResolver;
  /** Set of selected `noteId`s, may be empty. */
  selection: ReadonlySet<string>;
}

/**
 * Pack `notes` into a freshly-allocated Float32Array suitable for
 * `gl.bufferData(ARRAY_BUFFER, …)`.
 */
export function packNoteInstances({ notes, resolveColor, selection }: PackNotesArgs): Float32Array {
  const out = new Float32Array(notes.length * NOTE_INSTANCE_FLOATS);
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    const base = i * NOTE_INSTANCE_FLOATS;
    const color = resolveColor(note.partIndex);
    let flags = 0;
    if (selection.has(note.noteId)) flags |= FLAG_SELECTED;
    if (note.fromRepeat) flags |= FLAG_FROM_REPEAT;
    out[base + 0] = note.midiNote;
    out[base + 1] = note.startSeconds;
    out[base + 2] = note.endSeconds;
    out[base + 3] = color[0];
    out[base + 4] = color[1];
    out[base + 5] = color[2];
    out[base + 6] = color[3];
    out[base + 7] = flags;
  }
  return out;
}

/**
 * Wire the note-instance VAO bindings on the currently bound program.
 * Assumes the caller has already bound the instance VBO via
 * `gl.bindBuffer(ARRAY_BUFFER, instanceBuffer)` and the quad VBO is
 * available at attrib 0 elsewhere.
 *
 * Attribute locations match `shaders.ts`:
 *   1 → a_pitchTime (vec3)
 *   2 → a_color     (vec4)
 *   3 → a_flags     (float)
 */
export function bindNoteInstanceAttributes(gl: WebGL2RenderingContext): void {
  const stride = NOTE_INSTANCE_BYTES;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);

  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 12);
  gl.vertexAttribDivisor(2, 1);

  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
  gl.vertexAttribDivisor(3, 1);
}
