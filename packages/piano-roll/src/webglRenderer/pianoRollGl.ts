/**
 * `PianoRollGl` — the WebGL2 renderer for `PianoRollCanvas`.
 *
 * Lifecycle (host responsibilities):
 *
 *   const r = new PianoRollGl(canvas);
 *   r.setTheme(theme);
 *   r.resize(widthPx, heightPx, dpr);
 *   r.setNotes(notes, partColorTable);           // re-uploads instance buffer
 *   r.setSelection(selection);                   // re-uploads instance buffer
 *   r.setViewport(viewport);                     // re-derives key-layout uniform
 *   r.setPlayhead(seconds);                      // single uniform1f, no buffer touch
 *   r.render();
 *   …
 *   r.dispose();
 *
 * Context-loss is handled internally: the canvas listens for
 * `webglcontextlost` / `webglcontextrestored`. On loss all GL handles
 * are dropped + dirty flags set; on restore the renderer rebuilds and
 * the next `render()` re-uploads buffers and uniforms automatically.
 *
 * The class deliberately stays a small façade over the per-pipeline
 * modules (`shaders.ts`, `noteInstanceBuffer.ts`, `lineGeometry.ts`)
 * so each piece is testable on its own.
 */

import { buildKeyLayout, type KeyBounds } from "../pianoRollGrid";
import type { PianoRollNote, PianoRollSelection, PianoRollViewport } from "../types";
import {
  bindLineInstanceAttributes,
  buildDecorationLines,
  LINE_INSTANCE_BYTES,
  packLineInstances,
} from "./lineGeometry";
import {
  bindNoteInstanceAttributes,
  NOTE_INSTANCE_BYTES,
  packNoteInstances,
  type NoteColorResolver,
} from "./noteInstanceBuffer";
import { createUnitQuadBuffer, UNIT_QUAD_VERTEX_COUNT } from "./quadBuffer";
import { buildProgram } from "./shaderProgram";
import {
  LINES_FRAGMENT_SHADER,
  LINES_VERTEX_SHADER,
  MAX_MIDI_NOTES,
  NOTES_FRAGMENT_SHADER,
  NOTES_VERTEX_SHADER,
} from "./shaders";
import type { RollTheme } from "./theme";

/** Default no-op color resolver: returns the theme's default color. */
const DEFAULT_COLOR: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 1];

interface GlResources {
  notesProgram: WebGLProgram;
  linesProgram: WebGLProgram;
  quadBuffer: WebGLBuffer;
  noteInstanceBuffer: WebGLBuffer;
  lineInstanceBuffer: WebGLBuffer;
  notesVao: WebGLVertexArrayObject;
  linesVao: WebGLVertexArrayObject;
  uniforms: {
    notes: NoteUniforms;
    lines: LineUniforms;
  };
}

interface NoteUniforms {
  resolution: WebGLUniformLocation;
  playheadSeconds: WebGLUniformLocation;
  secondsAhead: WebGLUniformLocation;
  keyLayout: WebGLUniformLocation;
  selectionColor: WebGLUniformLocation;
}

interface LineUniforms {
  resolution: WebGLUniformLocation;
}

export class PianoRollGl {
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null;
  private resources: GlResources | null = null;

  private widthPx = 0;
  private heightPx = 0;
  private dpr = 1;

  private notes: readonly PianoRollNote[] = [];
  private selection: PianoRollSelection = new Set<string>();
  private resolveColor: NoteColorResolver = () => DEFAULT_COLOR;
  private viewport: PianoRollViewport = { secondsAhead: 4, minMidi: 21, maxMidi: 108 };
  private playheadSeconds = 0;
  private theme: RollTheme | null = null;

  /** `Float32Array(MAX_MIDI_NOTES * 2)` — packed (x, w) per MIDI note. */
  private keyLayoutUniform: Float32Array = new Float32Array(MAX_MIDI_NOTES * 2);

  /** Dirty flags: when set, the next `render()` re-uploads / re-derives. */
  private notesDirty = true;
  private linesDirty = true;
  private keyLayoutDirty = true;
  private noteInstanceCount = 0;
  private lineInstanceCount = 0;

  // Bound listeners — held so we can remove them in `dispose`.
  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.resources = null;
    this.markAllDirty();
  };
  private readonly onContextRestored = (): void => {
    this.ensureResources();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: true });
    if (!this.gl) {
      throw new Error("WebGL2 is not supported by this browser/canvas.");
    }
    canvas.addEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);
  }

  /** Drop GL resources + remove listeners. Safe to call twice. */
  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored, false);
    this.releaseResources();
    this.gl = null;
  }

  /** Drop GPU handles without dropping the GL context (used on loss). */
  private releaseResources(): void {
    const gl = this.gl;
    const r = this.resources;
    if (!gl || !r) {
      this.resources = null;
      return;
    }
    gl.deleteProgram(r.notesProgram);
    gl.deleteProgram(r.linesProgram);
    gl.deleteBuffer(r.quadBuffer);
    gl.deleteBuffer(r.noteInstanceBuffer);
    gl.deleteBuffer(r.lineInstanceBuffer);
    gl.deleteVertexArray(r.notesVao);
    gl.deleteVertexArray(r.linesVao);
    this.resources = null;
  }

  /** Mark everything dirty — used after context loss or major changes. */
  private markAllDirty(): void {
    this.notesDirty = true;
    this.linesDirty = true;
    this.keyLayoutDirty = true;
  }

  setTheme(theme: RollTheme): void {
    this.theme = theme;
    this.linesDirty = true;
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    if (widthPx === this.widthPx && heightPx === this.heightPx && dpr === this.dpr) return;
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(widthPx * dpr));
    this.canvas.height = Math.max(1, Math.floor(heightPx * dpr));
    this.canvas.style.width = `${widthPx}px`;
    this.canvas.style.height = `${heightPx}px`;
    this.keyLayoutDirty = true;
    this.linesDirty = true;
  }

  setViewport(viewport: PianoRollViewport): void {
    if (viewport === this.viewport) return;
    this.viewport = viewport;
    this.keyLayoutDirty = true;
    this.linesDirty = true;
  }

  setNotes(notes: readonly PianoRollNote[], resolveColor: NoteColorResolver): void {
    this.notes = notes;
    this.resolveColor = resolveColor;
    this.notesDirty = true;
  }

  setSelection(selection: PianoRollSelection): void {
    this.selection = selection;
    this.notesDirty = true;
  }

  setPlayhead(seconds: number): void {
    if (seconds === this.playheadSeconds) return;
    this.playheadSeconds = seconds;
    // Grid lines snap to integer seconds, so their positions move with
    // the playhead. They're tiny (<100 instances), so re-packing is
    // cheap — but the heavy note buffer is left alone.
    this.linesDirty = true;
  }

  /** Render one frame. Re-uploads dirty buffers + writes all uniforms. */
  render(): void {
    if (this.widthPx <= 0 || this.heightPx <= 0) return;
    const gl = this.gl;
    if (!gl) return;
    const resources = this.ensureResources();
    if (!resources || !this.theme) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = this.theme.canvasBg;
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.uploadDirty(gl, resources);
    this.drawNotes(gl, resources);
    this.drawLines(gl, resources);
  }

  private ensureResources(): GlResources | null {
    if (this.resources) return this.resources;
    const gl = this.gl;
    if (!gl) return null;

    const notesProgram = buildProgram(gl, NOTES_VERTEX_SHADER, NOTES_FRAGMENT_SHADER);
    const linesProgram = buildProgram(gl, LINES_VERTEX_SHADER, LINES_FRAGMENT_SHADER);

    const quadBuffer = createUnitQuadBuffer(gl);
    const noteInstanceBuffer = gl.createBuffer();
    const lineInstanceBuffer = gl.createBuffer();
    if (!noteInstanceBuffer || !lineInstanceBuffer) {
      throw new Error("gl.createBuffer returned null");
    }
    const notesVao = gl.createVertexArray();
    const linesVao = gl.createVertexArray();
    if (!notesVao || !linesVao) {
      throw new Error("gl.createVertexArray returned null");
    }

    // Notes VAO: attrib 0 = quad corner; 1/2/3 = per-instance.
    gl.bindVertexArray(notesVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, noteInstanceBuffer);
    bindNoteInstanceAttributes(gl);

    // Lines VAO: same quad VBO at attrib 0, different per-instance layout.
    gl.bindVertexArray(linesVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineInstanceBuffer);
    bindLineInstanceAttributes(gl);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const uniforms = {
      notes: lookupNoteUniforms(gl, notesProgram),
      lines: lookupLineUniforms(gl, linesProgram),
    };

    this.resources = {
      notesProgram,
      linesProgram,
      quadBuffer,
      noteInstanceBuffer,
      lineInstanceBuffer,
      notesVao,
      linesVao,
      uniforms,
    };
    this.markAllDirty();
    return this.resources;
  }

  private uploadDirty(gl: WebGL2RenderingContext, r: GlResources): void {
    if (this.notesDirty) {
      const packed = packNoteInstances({
        notes: this.notes,
        resolveColor: this.resolveColor,
        selection: this.selection,
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, r.noteInstanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
      this.noteInstanceCount = this.notes.length;
      this.notesDirty = false;
    }
    if (this.keyLayoutDirty) {
      this.recomputeKeyLayoutUniform();
      this.keyLayoutDirty = false;
    }
    if (this.linesDirty && this.theme) {
      const layout = buildKeyLayoutMap(this.viewport, this.widthPx);
      const decoLines = buildDecorationLines({
        viewport: this.viewport,
        widthPx: this.widthPx,
        heightPx: this.heightPx,
        keyLayout: layout,
        playheadSeconds: this.playheadSeconds,
        octaveColor: this.theme.octaveLine,
        gridColor: this.theme.gridLine,
        playheadColor: this.theme.playhead,
        playheadGlowColor: this.theme.playheadGlow,
      });
      const packed = packLineInstances(decoLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.lineInstanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
      this.lineInstanceCount = decoLines.length;
      this.linesDirty = false;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private recomputeKeyLayoutUniform(): void {
    this.keyLayoutUniform.fill(0);
    const layout = buildKeyLayoutMap(this.viewport, this.widthPx);
    for (const [midi, bounds] of layout) {
      if (midi < 0 || midi >= MAX_MIDI_NOTES) continue;
      this.keyLayoutUniform[midi * 2] = bounds.x;
      this.keyLayoutUniform[midi * 2 + 1] = bounds.width;
    }
  }

  private drawNotes(gl: WebGL2RenderingContext, r: GlResources): void {
    if (this.noteInstanceCount === 0 || !this.theme) return;
    gl.useProgram(r.notesProgram);
    gl.bindVertexArray(r.notesVao);
    gl.uniform2f(r.uniforms.notes.resolution, this.widthPx, this.heightPx);
    gl.uniform1f(r.uniforms.notes.playheadSeconds, this.playheadSeconds);
    gl.uniform1f(r.uniforms.notes.secondsAhead, this.viewport.secondsAhead);
    gl.uniform2fv(r.uniforms.notes.keyLayout, this.keyLayoutUniform);
    const sel = this.theme.selection;
    gl.uniform4f(r.uniforms.notes.selectionColor, sel[0], sel[1], sel[2], sel[3]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, UNIT_QUAD_VERTEX_COUNT, this.noteInstanceCount);
  }

  private drawLines(gl: WebGL2RenderingContext, r: GlResources): void {
    if (this.lineInstanceCount === 0) return;
    gl.useProgram(r.linesProgram);
    gl.bindVertexArray(r.linesVao);
    gl.uniform2f(r.uniforms.lines.resolution, this.widthPx, this.heightPx);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, UNIT_QUAD_VERTEX_COUNT, this.lineInstanceCount);
  }

  // ── Test-only hooks ────────────────────────────────────────────────────
  // Kept on the class to avoid leaking internals through a separate
  // `_test` barrel. They have no side effect when called from prod.

  /** True if the GL resources have been built (and not lost). */
  get hasResources(): boolean {
    return this.resources !== null;
  }

  /** Bytes of GPU instance buffer storage requested last frame. */
  get debugBufferSizes(): { notes: number; lines: number } {
    return {
      notes: this.noteInstanceCount * NOTE_INSTANCE_BYTES,
      lines: this.lineInstanceCount * LINE_INSTANCE_BYTES,
    };
  }

  /** Force the dirty flags — only used by tests. */
  forceContextLost(): void {
    this.releaseResources();
    this.markAllDirty();
  }
}

function lookupNoteUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): NoteUniforms {
  return {
    resolution: required(gl.getUniformLocation(program, "u_resolution"), "u_resolution"),
    playheadSeconds: required(gl.getUniformLocation(program, "u_playheadSeconds"), "u_playheadSeconds"),
    secondsAhead: required(gl.getUniformLocation(program, "u_secondsAhead"), "u_secondsAhead"),
    keyLayout: required(gl.getUniformLocation(program, "u_keyLayout[0]"), "u_keyLayout"),
    selectionColor: required(gl.getUniformLocation(program, "u_selectionColor"), "u_selectionColor"),
  };
}

function lookupLineUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): LineUniforms {
  return {
    resolution: required(gl.getUniformLocation(program, "u_resolution"), "u_resolution"),
  };
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`uniform location not found: ${name}`);
  return value;
}

/**
 * Adapter: `buildKeyLayout` returns a `Map<number, KeyBounds>`. We use
 * it directly; this indirection exists so test fakes can be plugged in
 * without monkey-patching the import.
 */
function buildKeyLayoutMap(viewport: PianoRollViewport, widthPx: number): ReadonlyMap<number, KeyBounds> {
  return buildKeyLayout(viewport, widthPx);
}
