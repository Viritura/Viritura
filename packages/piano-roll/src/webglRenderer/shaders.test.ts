/**
 * Smoke tests for the GLSL sources. We can't compile shaders without a
 * GL context in `node`, so we verify the surface contract the renderer
 * depends on: attribute/uniform names + locations, version directive.
 */

import { describe, expect, it } from "vitest";
import {
  FLAG_FROM_REPEAT,
  FLAG_SELECTED,
  LINES_FRAGMENT_SHADER,
  LINES_VERTEX_SHADER,
  MAX_MIDI_NOTES,
  NOTES_FRAGMENT_SHADER,
  NOTES_VERTEX_SHADER,
} from "./shaders";

describe("shader sources", () => {
  it("targets GLSL ES 3.00", () => {
    for (const src of [NOTES_VERTEX_SHADER, NOTES_FRAGMENT_SHADER, LINES_VERTEX_SHADER, LINES_FRAGMENT_SHADER]) {
      expect(src.startsWith("#version 300 es")).toBe(true);
    }
  });

  it("notes vertex shader declares the attributes the renderer binds", () => {
    expect(NOTES_VERTEX_SHADER).toMatch(/layout\(location = 0\) in vec2 a_corner/);
    expect(NOTES_VERTEX_SHADER).toMatch(/layout\(location = 1\) in vec3 a_pitchTime/);
    expect(NOTES_VERTEX_SHADER).toMatch(/layout\(location = 2\) in vec4 a_color/);
    expect(NOTES_VERTEX_SHADER).toMatch(/layout\(location = 3\) in float a_flags/);
  });

  it("notes vertex shader declares the uniforms the renderer writes", () => {
    expect(NOTES_VERTEX_SHADER).toContain("uniform vec2  u_resolution");
    expect(NOTES_VERTEX_SHADER).toContain("uniform float u_playheadSeconds");
    expect(NOTES_VERTEX_SHADER).toContain("uniform float u_secondsAhead");
    expect(NOTES_VERTEX_SHADER).toContain(`uniform vec2  u_keyLayout[${MAX_MIDI_NOTES}]`);
  });

  it("notes fragment shader references the selection-color uniform and flag bits", () => {
    expect(NOTES_FRAGMENT_SHADER).toContain("uniform vec4 u_selectionColor");
    expect(NOTES_FRAGMENT_SHADER).toContain(`(v_flags & ${FLAG_SELECTED})`);
  });

  it("notes vertex shader checks the FROM_REPEAT bit", () => {
    expect(NOTES_VERTEX_SHADER).toContain(`(v_flags & ${FLAG_FROM_REPEAT})`);
  });

  it("lines vertex shader declares the per-instance rect + color + softness attributes", () => {
    expect(LINES_VERTEX_SHADER).toMatch(/layout\(location = 1\) in vec4 a_rect/);
    expect(LINES_VERTEX_SHADER).toMatch(/layout\(location = 2\) in vec4 a_color/);
    expect(LINES_VERTEX_SHADER).toMatch(/layout\(location = 3\) in float a_softness/);
  });
});
