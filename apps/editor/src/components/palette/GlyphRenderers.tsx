import type { CSSProperties } from "react";
import type { TimeSignatureRenderStyle } from "@viritura/core";
import { SMUFL } from "./smuflGlyphs";

const BLOCK_STYLE: CSSProperties = { display: "block" };
const TIMESIG_SVG_STYLE: CSSProperties = { display: "block", margin: "0 auto" };
function clefSvgStyle(contentWidth: number, svgHeight: number): CSSProperties {
  return { display: "block", width: contentWidth, height: svgHeight, maxWidth: "100%", maxHeight: "100%" };
}

export function BarlineGlyph({ glyph }: { glyph: string }) {
  const sp = 5;
  const staffHeight = sp * 4;
  const glyphSize = sp * 4;
  const padTop = sp * 0.5;
  const padBottom = sp * 0.5;
  const svgHeight = padTop + staffHeight + padBottom;
  const contentWidth = sp * 3;
  const lineExtend = 200;

  return (
    <svg
      width={contentWidth}
      height={svgHeight}
      viewBox={`0 0 ${contentWidth} ${svgHeight}`}
      overflow="visible"
      style={BLOCK_STYLE}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={-lineExtend}
          y1={padTop + i * sp}
          x2={contentWidth + lineExtend}
          y2={padTop + i * sp}
          stroke="currentColor"
          strokeWidth={0.5}
        />
      ))}
      <text
        x={contentWidth / 2}
        y={padTop + staffHeight}
        fontFamily="Bravura"
        fontSize={glyphSize}
        fill="currentColor"
        textAnchor="middle"
      >
        {glyph}
      </text>
    </svg>
  );
}

/** SMuFL bounding boxes for clef glyphs (from Bravura metadata).
 *  [top, bottom] in staff spaces relative to glyph origin (y-up). */
const CLEF_BBOX: Record<string, [number, number]> = {
  gClef: [4.392, -2.632],
  gClef8vb: [4.392, -3.512],
  gClef8va: [5.28, -2.632],
  gClef15mb: [4.392, -3.524],
  gClef15ma: [5.276, -2.632],
  fClef: [1.048, -2.54],
  fClef8vb: [1.048, -2.976],
  fClef8va: [1.98, -2.54],
  fClef15mb: [1.048, -2.968],
  fClef15ma: [1.984, -2.54],
  cClef: [2.024, -2.024],
  cClef8vb: [2.024, -2.964],
  unpitchedPercussionClef1: [1.0, -1.0],
};

function resolveClefKey(sign: string, octave?: number): string {
  if (!octave) return sign === "G" ? "gClef" : sign === "F" ? "fClef" : "cClef";
  if (sign === "G") {
    if (octave === -1) return "gClef8vb";
    if (octave === -2) return "gClef15mb";
    if (octave === 1) return "gClef8va";
    if (octave === 2) return "gClef15ma";
  } else if (sign === "F") {
    if (octave === -1) return "fClef8vb";
    if (octave === -2) return "fClef15mb";
    if (octave === 1) return "fClef8va";
    if (octave === 2) return "fClef15ma";
  } else if (sign === "C") {
    if (octave === -1) return "cClef8vb";
  }
  return sign === "G" ? "gClef" : sign === "F" ? "fClef" : "cClef";
}

function resolveClefGlyph(key: string): string {
  return (SMUFL as Record<string, string>)[key] ?? SMUFL.gClef;
}

const CLEF_SP = 5;

function clefSvgDimensions(sign: string, staffPosition: number, octave?: number, glyphOverride?: string) {
  const sp = CLEF_SP;
  const staffHeight = sp * 4;
  const key = glyphOverride ?? resolveClefKey(sign, octave);
  const baseYOffset = glyphOverride ? 2.0 : sign === "G" ? 3.0 : sign === "F" ? 1.0 : 2.0;
  const posShift = !glyphOverride && sign === "C" ? staffPosition * 0.5 : 0;
  const yOffset = baseYOffset - posShift;
  const bbox = CLEF_BBOX[key] ?? [4.0, -2.5];
  const glyphTopPx = yOffset * sp - bbox[0] * sp;
  const glyphBotPx = yOffset * sp - bbox[1] * sp;
  const breath = sp * 0.15;
  const padTop = Math.max(breath, -glyphTopPx + breath);
  const padBottom = Math.max(breath, glyphBotPx - staffHeight + breath);
  const svgHeight = padTop + staffHeight + padBottom;
  const contentWidth = sp * 7;
  return { contentWidth, svgHeight, padTop, yOffset, key };
}

export function ClefGlyph({
  sign,
  staffPosition,
  octave,
  glyphOverride,
}: {
  sign: string;
  staffPosition: number;
  octave?: number;
  glyphOverride?: string;
}) {
  const { contentWidth, svgHeight, padTop, yOffset, key } = clefSvgDimensions(
    sign,
    staffPosition,
    octave,
    glyphOverride,
  );
  const sp = CLEF_SP;
  const glyphSize = sp * 4;
  const glyph = resolveClefGlyph(key);
  const lineExtend = 200;

  return (
    <svg
      viewBox={`0 0 ${contentWidth} ${svgHeight}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      style={clefSvgStyle(contentWidth, svgHeight)}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={-lineExtend}
          y1={padTop + i * sp}
          x2={contentWidth + lineExtend}
          y2={padTop + i * sp}
          stroke="currentColor"
          strokeWidth={0.5}
        />
      ))}
      <text
        x={contentWidth / 2}
        y={padTop + yOffset * sp}
        fontFamily="Bravura"
        fontSize={glyphSize}
        fill="currentColor"
        textAnchor="middle"
      >
        {glyph}
      </text>
    </svg>
  );
}

const TIME_SIG_REGULAR_ADVANCES = [1.88, 1.336, 1.784, 1.684, 1.88, 1.612, 1.736, 1.764, 1.744, 1.736];
const TIME_SIG_NARROW_ADVANCES = [1.032, 0.708, 0.976, 0.916, 1.032, 0.876, 0.948, 0.968, 0.96, 0.948];
const TIME_SIG_FILM_ADVANCES = [0.504, 0.284, 0.528, 0.52, 0.528, 0.512, 0.512, 0.512, 0.52, 0.512];
const TIME_SIG_REGULAR_BASE = 0xe080;
const TIME_SIG_NARROW_BASE = 0xf506;
const TIME_SIG_FILM_BASE = 0xf440;
const METRONOME_NOTE: Record<number, { glyph: string; top: number; width: number; height: number }> = {
  1: { glyph: String.fromCodePoint(0xeca2), top: -0.592, width: 1.836, height: 1.092 },
  2: { glyph: String.fromCodePoint(0xeca3), top: -2.752, width: 1.364, height: 3.316 },
  4: { glyph: String.fromCodePoint(0xeca5), top: -2.752, width: 1.328, height: 3.316 },
  8: { glyph: String.fromCodePoint(0xeca7), top: -2.784, width: 2.136, height: 3.348 },
  16: { glyph: String.fromCodePoint(0xeca9), top: -2.8, width: 2.088, height: 3.364 },
  32: { glyph: String.fromCodePoint(0xecab), top: -3.692, width: 2.152, height: 4.256 },
  64: { glyph: String.fromCodePoint(0xecad), top: -4.392, width: 2.148, height: 4.956 },
};

interface TimeSignatureStaffPreviewProps {
  count: number;
  unit: number;
  staffCount?: number;
  staffGap?: number;
  scale?: number;
  numeralStyle?: TimeSignatureRenderStyle;
  distribution?: "perStaff" | "perGroup";
  position?: "center" | "top" | "bottom" | "above";
  width?: number;
  signatureX?: number;
  staffStart?: number;
  staffEnd?: number;
  showBracket?: boolean;
  className?: string;
}

interface TimeSignatureRow {
  glyphs: string[];
  advances: number[];
  width: number;
}

function timeSignatureRow(value: number, style: TimeSignatureRenderStyle, sp: number): TimeSignatureRow {
  const base =
    style === "outsideStaff" ? TIME_SIG_FILM_BASE : style === "narrow" ? TIME_SIG_NARROW_BASE : TIME_SIG_REGULAR_BASE;
  const metrics =
    style === "outsideStaff"
      ? TIME_SIG_FILM_ADVANCES
      : style === "narrow"
        ? TIME_SIG_NARROW_ADVANCES
        : TIME_SIG_REGULAR_ADVANCES;
  const digits = String(value).split("").map(Number);
  const advances = digits.map((digit) => metrics[digit]! * sp);
  return {
    glyphs: digits.map((digit) => String.fromCodePoint(base + digit)),
    advances,
    width: advances.reduce((sum, advance) => sum + advance, 0),
  };
}

function renderTimeSignatureRow(row: TimeSignatureRow, left: number, y: number, fontSize: number, key: string) {
  let x = left;
  return row.glyphs.map((glyph, index) => {
    const glyphX = x;
    x += row.advances[index]!;
    return (
      <text key={`${key}-${index}`} x={glyphX} y={y} fontFamily="Bravura" fontSize={fontSize} fill="currentColor">
        {glyph}
      </text>
    );
  });
}

/** Staff-aware time-signature specimen shared by the palette and Setup previews. */
export function TimeSignatureStaffPreview({
  count,
  unit,
  staffCount = 1,
  staffGap = 7,
  scale = 1,
  numeralStyle = "standard",
  distribution = "perStaff",
  position = "center",
  width: requestedWidth,
  signatureX,
  staffStart = 0,
  staffEnd,
  showBracket = false,
  className,
}: TimeSignatureStaffPreviewProps) {
  const sp = 5;
  const staffHeight = 4 * sp;
  const staffStride = staffHeight + staffGap * sp;
  const groupBottom = (staffCount - 1) * staffStride + staffHeight;
  const fontSize = 4 * sp * scale;
  const halfInk = sp * scale;
  const numerator = timeSignatureRow(count, numeralStyle, sp * scale);
  const denominator = timeSignatureRow(unit, numeralStyle, sp * scale);
  const note = METRONOME_NOTE[unit] ?? METRONOME_NOTE[4]!;
  const noteFontSize = fontSize * (2 / note.height);
  const noteWidth = (note.width * noteFontSize) / 4;
  const noteTop = (note.top * noteFontSize) / 4;
  const noteHeight = (note.height * noteFontSize) / 4;
  const noteheadWidth = (1.18 * noteFontSize) / 4;
  const signatureWidth =
    numeralStyle === "singleNumber"
      ? numerator.width
      : numeralStyle === "noteValue"
        ? Math.max(numerator.width, noteWidth)
        : Math.max(numerator.width, denominator.width);
  const contentWidth = requestedWidth ?? signatureWidth + sp;
  const left = signatureX ?? (contentWidth - signatureWidth) / 2;
  const lineEnd = staffEnd ?? contentWidth;
  const targets =
    distribution === "perStaff"
      ? Array.from({ length: staffCount }, (_, index) => {
          const top = index * staffStride;
          return { top, bottom: top + staffHeight };
        })
      : [{ top: 0, bottom: groupBottom }];

  const signatures = targets.map((target, index) => {
    const center = (target.top + target.bottom) / 2;
    const numeratorY = numeralStyle === "singleNumber" ? center : center - halfInk;
    const denominatorY = center + halfInk;
    const noteY = denominatorY - (noteTop + noteHeight / 2);
    const centeredTop = numeratorY - halfInk;
    const centeredBottom =
      numeralStyle === "singleNumber"
        ? numeratorY + halfInk
        : numeralStyle === "noteValue"
          ? Math.max(noteY + noteTop + noteHeight, denominatorY)
          : denominatorY + halfInk;
    const dy =
      position === "top"
        ? target.top - centeredTop
        : position === "bottom"
          ? target.bottom - centeredBottom
          : position === "above"
            ? target.top - sp - centeredBottom
            : 0;
    return {
      key: index,
      numeratorY: numeratorY + dy,
      denominatorY: denominatorY + dy,
      noteY: noteY + dy,
      top: centeredTop + dy,
      bottom: centeredBottom + dy,
    };
  });
  const pad = sp;
  const minY = Math.min(0, ...signatures.map((signature) => signature.top)) - pad;
  const maxY = Math.max(groupBottom, ...signatures.map((signature) => signature.bottom)) + pad;

  return (
    <svg
      width={contentWidth}
      height={maxY - minY}
      viewBox={`0 ${minY} ${contentWidth} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      style={TIMESIG_SVG_STYLE}
      className={className}
      aria-hidden="true"
    >
      {Array.from({ length: staffCount }, (_, staffIndex) =>
        [0, 1, 2, 3, 4].map((line) => {
          const y = staffIndex * staffStride + line * sp;
          return (
            <line
              key={`${staffIndex}-${line}`}
              x1={staffStart}
              y1={y}
              x2={lineEnd}
              y2={y}
              stroke="currentColor"
              strokeWidth={0.5}
            />
          );
        }),
      )}
      {showBracket && staffCount > 1 && (
        <path
          d={`M${staffStart - sp * 0.6} 0h${-sp * 0.8}v${groupBottom}h${sp * 0.8}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.8}
        />
      )}
      {signatures.map((signature) => (
        <g key={signature.key}>
          {renderTimeSignatureRow(
            numerator,
            left + (signatureWidth - numerator.width) / 2,
            signature.numeratorY,
            fontSize,
            `n-${signature.key}`,
          )}
          {numeralStyle !== "singleNumber" &&
            numeralStyle !== "noteValue" &&
            renderTimeSignatureRow(
              denominator,
              left + (signatureWidth - denominator.width) / 2,
              signature.denominatorY,
              fontSize,
              `d-${signature.key}`,
            )}
          {numeralStyle === "noteValue" && (
            <text
              x={left + signatureWidth / 2 - noteheadWidth / 2}
              y={signature.noteY}
              fontFamily="Bravura"
              fontSize={noteFontSize}
              fill="currentColor"
            >
              {note.glyph}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function TimeSigGlyph({ count, unit }: { count: number; unit: number }) {
  return <TimeSignatureStaffPreview count={count} unit={unit} />;
}

const KEY_SIG_SHARP_POSITIONS = [0.0, 3.0, -0.5, 2.5, 5.5, 1.5, 4.5];
const KEY_SIG_FLAT_POSITIONS = [4.0, 1.0, 4.5, 1.5, 5.0, 2.0, 5.5];

export function KeySigGlyph({ fifths, atonal }: { fifths: number; atonal?: boolean }) {
  const sp = 5;
  const staffHeight = sp * 4;
  const glyphSize = sp * 4;
  const hStep = sp * 1.1;
  const padTop = sp * 1.5;
  const padBottom = sp * 1.5;
  const svgHeight = padTop + staffHeight + padBottom;

  const count = Math.abs(fifths);
  const positions = fifths > 0 ? KEY_SIG_SHARP_POSITIONS : KEY_SIG_FLAT_POSITIONS;
  const glyph = fifths > 0 ? SMUFL.sharp : SMUFL.flat;
  const xPad = sp * 2;
  const xStart = xPad;
  const contentWidth = count > 0 ? xStart + (count - 1) * hStep + xPad : sp * 4 + xPad * 2;
  const lineExtend = 200;

  return (
    <svg
      width={contentWidth}
      height={svgHeight}
      viewBox={`0 0 ${contentWidth} ${svgHeight}`}
      overflow="visible"
      style={BLOCK_STYLE}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={-lineExtend}
          y1={padTop + i * sp}
          x2={contentWidth + lineExtend}
          y2={padTop + i * sp}
          stroke="currentColor"
          strokeWidth={0.5}
        />
      ))}
      {atonal && (
        <text
          x={contentWidth / 2}
          y={padTop + staffHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={staffHeight * 0.6}
          fill="currentColor"
          fontFamily="inherit"
          fontWeight={700}
        >
          ×
        </text>
      )}
      {Array.from({ length: count }, (_, i) => {
        const y = padTop + positions[i]! * sp * 0.5;
        const x = xStart + i * hStep;
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            fontSize={glyphSize}
            fontFamily="Bravura, serif"
            fill="currentColor"
          >
            {glyph}
          </text>
        );
      })}
    </svg>
  );
}
