/**
 * Thin wrappers around the WebGL2 shader-compilation dance.
 *
 * Kept tiny so the renderer reads top-down without ceremony.
 */

/** Compile a single shader; throws on failure with the GL info-log. */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("gl.createShader returned null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "<no info log>";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}\n--- source ---\n${source}`);
  }
  return shader;
}

/** Link a vertex+fragment shader pair into a program; throws on failure. */
function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("gl.createProgram returned null");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "<no info log>";
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  // Once linked, the shader objects are no longer needed and can be
  // detached so the driver can free their compiled state.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

/** Compile + link in one step. */
export function buildProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  return linkProgram(gl, vs, fs);
}
