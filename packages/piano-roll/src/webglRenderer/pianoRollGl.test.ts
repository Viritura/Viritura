/**
 * Tests for `PianoRollGl` lifecycle behaviours that don't require a
 * real GPU — specifically the context-loss → restore path. We drive
 * the class with a stub canvas + stub WebGL2 context so the
 * dirty-flag / re-upload contract can be verified without running
 * inside a browser.
 *
 * Real GPU rendering correctness is covered by the existing
 * Playwright config (see AGENTS.md → "Validation"); this test only
 * asserts that buffer uploads and program rebuilds happen at the
 * right lifecycle moments.
 */

import { describe, expect, it } from "vitest";
import { PianoRollGl } from "./pianoRollGl";
import type { PianoRollNote } from "../types";

interface CallLog {
  bufferDataCount: number;
  createProgramCount: number;
  drawArraysInstancedCount: number;
  contextLostListener: ((e: Event) => void) | null;
  contextRestoredListener: (() => void) | null;
}

function makeStubCanvas(): { canvas: HTMLCanvasElement; log: CallLog; gl: WebGL2RenderingContext } {
  const log: CallLog = {
    bufferDataCount: 0,
    createProgramCount: 0,
    drawArraysInstancedCount: 0,
    contextLostListener: null,
    contextRestoredListener: null,
  };

  const gl = makeStubGl(log);

  const canvas = {
    width: 0,
    height: 0,
    style: { width: "", height: "" },
    getContext(kind: string) {
      return kind === "webgl2" ? gl : null;
    },
    addEventListener(type: string, listener: EventListener) {
      if (type === "webglcontextlost") log.contextLostListener = listener as (e: Event) => void;
      if (type === "webglcontextrestored") log.contextRestoredListener = listener as () => void;
    },
    removeEventListener() {},
  } as unknown as HTMLCanvasElement;

  return { canvas, log, gl };
}

function makeStubGl(log: CallLog): WebGL2RenderingContext {
  let programId = 0;
  let bufferId = 0;
  let vaoId = 0;
  let shaderId = 0;
  // Hand back unique objects so the renderer's `if (!handle)` guards
  // pass. The exact shape doesn't matter to the stub.
  const stub: Record<string, unknown> = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    TRIANGLE_STRIP: 0x0005,

    createShader: () => ({ id: shaderId++ }),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => undefined,
    attachShader: () => undefined,
    detachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    createProgram: () => {
      log.createProgramCount++;
      return { id: programId++ };
    },
    deleteProgram: () => undefined,
    createBuffer: () => ({ id: bufferId++ }),
    deleteBuffer: () => undefined,
    bindBuffer: () => undefined,
    bufferData: () => {
      log.bufferDataCount++;
    },
    createVertexArray: () => ({ id: vaoId++ }),
    deleteVertexArray: () => undefined,
    bindVertexArray: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    vertexAttribDivisor: () => undefined,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    useProgram: () => undefined,
    viewport: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    enable: () => undefined,
    blendFunc: () => undefined,
    uniform2f: () => undefined,
    uniform1f: () => undefined,
    uniform2fv: () => undefined,
    uniform4f: () => undefined,
    drawArraysInstanced: () => {
      log.drawArraysInstancedCount++;
    },
  };
  return stub as unknown as WebGL2RenderingContext;
}

function makeNote(midiNote: number, startSeconds: number): PianoRollNote {
  return {
    locator: { sequencePath: { partId: "p", measureIndex: 0, voice: 0 }, eventId: `e${midiNote}` },
    noteIndex: 0,
    noteId: `n-${midiNote}-${startSeconds}`,
    midiNote,
    velocity: 100,
    partIndex: 0,
    startSeconds,
    endSeconds: startSeconds + 0.5,
    startMeasure: 0,
    startBeat: 0,
    notatedDurationQuarters: 1,
    fromTie: false,
    fromRepeat: false,
  };
}

const THEME = {
  canvasBg: [0, 0, 0, 1] as const,
  gridLine: [1, 1, 1, 0.06] as const,
  octaveLine: [1, 1, 1, 0.12] as const,
  playhead: [0.2, 0.5, 0.4, 1] as const,
  playheadGlow: [0.2, 0.5, 0.4, 0.35] as const,
  selection: [0.2, 0.5, 0.4, 0.85] as const,
  defaultNote: [0.2, 0.5, 0.4, 1] as const,
};

describe("PianoRollGl", () => {
  it("uploads note + line buffers on first render", () => {
    const { canvas, log } = makeStubCanvas();
    const r = new PianoRollGl(canvas);
    r.setTheme(THEME);
    r.resize(640, 480, 1);
    r.setNotes([makeNote(60, 0), makeNote(64, 0.5)], () => [1, 0, 0, 1]);
    r.setPlayhead(0);
    r.render();

    // Two programs (notes + lines) compiled.
    expect(log.createProgramCount).toBe(2);
    // Three instance-buffer uploads on first render: unit-quad VBO
    // (STATIC_DRAW, once at resource creation), note instances, line
    // instances.
    expect(log.bufferDataCount).toBe(3);
    // Two draws (notes + lines).
    expect(log.drawArraysInstancedCount).toBe(2);
    expect(r.hasResources).toBe(true);
    expect(r.debugBufferSizes.notes).toBe(2 * 32);
  });

  it("drops resources on contextlost and rebuilds them on contextrestored + render", () => {
    const { canvas, log } = makeStubCanvas();
    const r = new PianoRollGl(canvas);
    r.setTheme(THEME);
    r.resize(640, 480, 1);
    r.setNotes([makeNote(60, 0)], () => [1, 0, 0, 1]);
    r.render();

    expect(r.hasResources).toBe(true);
    const programsBefore = log.createProgramCount;
    const buffersBefore = log.bufferDataCount;

    // Simulate the browser firing contextlost.
    log.contextLostListener!({ preventDefault: () => {} } as unknown as Event);
    expect(r.hasResources).toBe(false);

    // Simulate restore — then the next render should rebuild + re-upload.
    log.contextRestoredListener!();
    r.render();

    expect(r.hasResources).toBe(true);
    expect(log.createProgramCount).toBe(programsBefore + 2);
    expect(log.bufferDataCount).toBeGreaterThan(buffersBefore);
    expect(log.drawArraysInstancedCount).toBeGreaterThan(0);
  });

  it("does not re-upload the note buffer when only the playhead moves", () => {
    const { canvas, log } = makeStubCanvas();
    const r = new PianoRollGl(canvas);
    r.setTheme(THEME);
    r.resize(640, 480, 1);
    r.setNotes([makeNote(60, 0)], () => [1, 0, 0, 1]);
    r.render();
    const uploadsAfterFirst = log.bufferDataCount;

    // Move the playhead and render again. The grid lines re-pack (they
    // snap to integer seconds), so we expect at most ONE extra
    // `bufferData` call (the line buffer), and NOT a notes-buffer upload.
    r.setPlayhead(0.5);
    r.render();
    expect(log.bufferDataCount - uploadsAfterFirst).toBe(1);
  });
});
