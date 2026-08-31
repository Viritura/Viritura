/**
 * GLSL source for the piano-roll WebGL2 pipelines.
 *
 * Two programs:
 *
 *  - `notes` — instanced rounded-rect renderer for the falling note
 *    cards. One unit-quad VBO is shared across all instances; each
 *    instance contributes (midi, startSec, endSec, color, flags). Pitch
 *    → pixel X is resolved against a `u_keyLayout[128]` uniform. Time →
 *    pixel Y is derived from `u_playheadSeconds`, `u_secondsAhead`, and
 *    canvas height, so updating the playhead is a single `uniform1f`
 *    with no buffer touch.
 *
 *  - `lines` — instanced AA hairline / thick-line renderer for the
 *    grid, octave anchors, playhead, and any 1D decoration. Each
 *    instance is an axis-aligned rectangle in pixel space plus a
 *    softness parameter. The fragment shader produces a fragment-AA
 *    edge using the distance to the rect's minor axis; with non-zero
 *    softness it widens into a soft glow.
 *
 * Note on coordinates: positions are computed in logical CSS-pixel
 * space (origin top-left, y-down), then projected to clip space inside
 * each vertex shader using `u_resolution`. We don't pass a separate
 * projection matrix — pan and zoom for the piano roll are constrained
 * (full piano always visible; only `secondsAhead` is user-tunable), so
 * a full mat3 buys nothing over the two scalars we already have.
 *
 * Migration path: WebGPU is the obvious next step once cross-browser
 * support catches up. The pipelines here are deliberately stateless +
 * a single uniform block away from being a WGPU port.
 */

/** Maximum MIDI notes (0..127). Sized to match the uniform array below. */
export const MAX_MIDI_NOTES = 128;

/** Flag bits packed into `a_flags`. */
export const FLAG_SELECTED = 1 << 0;
export const FLAG_FROM_REPEAT = 1 << 1;

export const NOTES_VERTEX_SHADER: string = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;       // unit quad (0..1)
layout(location = 1) in vec3 a_pitchTime;    // midi, startSec, endSec
layout(location = 2) in vec4 a_color;        // rgba (0..1, premultiplied not required)
layout(location = 3) in float a_flags;       // bitfield (see FLAG_* above)

uniform vec2  u_resolution;                  // canvas size in logical px
uniform float u_playheadSeconds;
uniform float u_secondsAhead;
uniform vec2  u_keyLayout[${MAX_MIDI_NOTES}]; // (x, width) per MIDI note, in px

out vec2  v_localPx;
out vec2  v_sizePx;
out vec4  v_color;
flat out int v_flags;

void main() {
  int midi = int(a_pitchTime.x);
  vec2 keyXW = (midi >= 0 && midi < ${MAX_MIDI_NOTES})
    ? u_keyLayout[midi]
    : vec2(0.0, 0.0);

  // 1px inset on each side so adjacent notes don't visually merge —
  // matches the Canvas-2D reference.
  float x = keyXW.x + 1.0;
  float w = max(2.0, keyXW.y - 2.0);

  float pxPerSec = u_resolution.y / max(0.001, u_secondsAhead);
  float yBottom = u_resolution.y - (a_pitchTime.y - u_playheadSeconds) * pxPerSec;
  float yTop    = u_resolution.y - (a_pitchTime.z - u_playheadSeconds) * pxPerSec;
  float h = max(2.0, yBottom - yTop);

  vec2 pos = vec2(x + a_corner.x * w, yTop + a_corner.y * h);
  vec2 ndc = vec2(pos.x / u_resolution.x * 2.0 - 1.0,
                  1.0 - pos.y / u_resolution.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);

  v_localPx = a_corner * vec2(w, h);
  v_sizePx  = vec2(w, h);
  v_color   = a_color;
  v_flags   = int(a_flags);

  // fromRepeat halves alpha — matches the Canvas-2D reference.
  if ((v_flags & ${FLAG_FROM_REPEAT}) != 0) {
    v_color.a *= 0.5;
  }
}
`;

export const NOTES_FRAGMENT_SHADER: string = /* glsl */ `#version 300 es
precision highp float;

in  vec2 v_localPx;
in  vec2 v_sizePx;
in  vec4 v_color;
flat in int v_flags;

uniform vec4 u_selectionColor;

out vec4 fragColor;

float sdRoundedRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 centerOffset = v_localPx - v_sizePx * 0.5;
  float radius = min(3.0, min(v_sizePx.x, v_sizePx.y) * 0.5);
  float d = sdRoundedRect(centerOffset, v_sizePx * 0.5, radius);

  float aa = max(fwidth(d), 0.0001);
  float fill = 1.0 - smoothstep(-aa, 0.0, d);

  vec4 col = v_color;
  col.a *= fill;

  // Top highlight band + bottom dark edge use smoothstep ramps rather
  // than hard "v_localPx.y < 2.0" cutoffs. With hard cutoffs the band
  // jumps row-by-row each frame as the quad scrolls sub-pixel, which
  // reads as shimmer/jitter on the falling notes even though the SDF
  // body is perfectly smooth. The smoothstep version distributes the
  // band's contribution across the boundary so sub-pixel motion just
  // re-weights neighbouring rows.
  if (v_sizePx.y > 6.0) {
    float topAmt    = 1.0 - smoothstep(0.0, 2.0, v_localPx.y);
    float bottomAmt = smoothstep(v_sizePx.y - 1.0, v_sizePx.y, v_localPx.y);
    col.rgb = mix(col.rgb, vec3(1.0), 0.18 * topAmt);
    col.rgb = mix(col.rgb, vec3(0.0), 0.22 * bottomAmt);
  }

  // Selection outline (2 px) just inside the rounded-rect edge.
  if ((v_flags & ${FLAG_SELECTED}) != 0) {
    float insideDist = -d;
    if (insideDist >= 0.0 && insideDist < 2.0) {
      col.rgb = mix(col.rgb, u_selectionColor.rgb, u_selectionColor.a);
    }
  }

  fragColor = col;
}
`;

export const LINES_VERTEX_SHADER: string = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;       // unit quad (0..1)
layout(location = 1) in vec4 a_rect;         // x, y, w, h in px
layout(location = 2) in vec4 a_color;        // rgba
layout(location = 3) in float a_softness;    // soft-edge half-width, px

uniform vec2 u_resolution;

out vec2  v_localPx;
out vec2  v_sizePx;
out vec4  v_color;
out float v_softness;

void main() {
  vec2 pos = vec2(a_rect.x + a_corner.x * a_rect.z,
                  a_rect.y + a_corner.y * a_rect.w);
  vec2 ndc = vec2(pos.x / u_resolution.x * 2.0 - 1.0,
                  1.0 - pos.y / u_resolution.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);

  v_localPx  = a_corner * a_rect.zw;
  v_sizePx   = a_rect.zw;
  v_color    = a_color;
  v_softness = a_softness;
}
`;

export const LINES_FRAGMENT_SHADER: string = /* glsl */ `#version 300 es
precision highp float;

in  vec2  v_localPx;
in  vec2  v_sizePx;
in  vec4  v_color;
in  float v_softness;

out vec4 fragColor;

void main() {
  // Distance to the line's center along its minor (short) axis.
  vec2 fromCenter = v_localPx - v_sizePx * 0.5;
  bool horizontal = v_sizePx.x >= v_sizePx.y;
  float halfMinor = (horizontal ? v_sizePx.y : v_sizePx.x) * 0.5;
  float distMinor = abs(horizontal ? fromCenter.y : fromCenter.x);

  float edgeStart;
  float edgeEnd;
  if (v_softness > 0.0) {
    // Soft glow: linear falloff from solid core to transparent edge.
    edgeStart = 0.0;
    edgeEnd   = halfMinor;
  } else {
    // Crisp 1-2 px line: fragment-AA via fwidth, no minimum floor.
    // A 0.5 px floor was previously applied to keep the line visible at
    // any zoom, but it caused the line to visibly thicken/thin as it
    // crossed pixel-row boundaries during playback scroll. True fwidth
    // AA lets sub-pixel motion blend across two rows smoothly. If the
    // grid lines now look too faint at certain zooms, bump alpha in the
    // theme rather than re-inflating the AA band.
    float aa = max(fwidth(distMinor), 0.0001);
    edgeStart = max(halfMinor - aa, 0.0);
    edgeEnd   = halfMinor;
  }

  float a = 1.0 - smoothstep(edgeStart, edgeEnd, distMinor);
  fragColor = vec4(v_color.rgb, v_color.a * a);
}
`;
