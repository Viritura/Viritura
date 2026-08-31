/**
 * Shared unit-quad VBO.
 *
 * Both pipelines (notes + lines) consume the same 4-vertex quad
 * (TRIANGLE_STRIP). Per-instance attribute buffers transform it into
 * note rectangles or line rectangles in pixel space.
 */

/** Unit-quad corner positions in (0..1, 0..1). TRIANGLE_STRIP order. */
const UNIT_QUAD_VERTICES: Readonly<Float32Array> = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

export const UNIT_QUAD_VERTEX_COUNT = 4;

/** Allocate + populate a STATIC_DRAW buffer with the unit quad. */
export function createUnitQuadBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("gl.createBuffer returned null");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD_VERTICES, gl.STATIC_DRAW);
  return buffer;
}
