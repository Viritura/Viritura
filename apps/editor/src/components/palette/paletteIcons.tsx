// Music-domain palette icons. The PaletteButton primitive itself lives
// in @viritura/ui — this file only keeps the SMuFL-adjacent SVG icons
// used by PalettePanel.
import type { CSSProperties } from "react";
import { SMUFL } from "./smuflGlyphs";

const SVG_BLOCK_STYLE: CSSProperties = { display: "block" };
const SINGLE_TREMOLO_STYLE: CSSProperties = {
  display: "inline-block",
  fontFamily: "Bravura, serif",
  fontSize: 28,
  transform: "translateX(2.1px)",
};

export function SingleNoteTremoloIcon({ glyph }: { glyph: string }) {
  return <span style={SINGLE_TREMOLO_STYLE}>{glyph}</span>;
}

export function TwoNoteTremoloIcon({ slashes }: { slashes: 1 | 2 | 3 }) {
  const leftOriginX = 4;
  const rightOriginX = 34;
  const noteOriginY = 31;
  const stemAnchorOffsetX = 5.9;
  const stemAnchorOffsetY = -0.84;
  const leftStemX = leftOriginX + stemAnchorOffsetX;
  const rightStemX = rightOriginX + stemAnchorOffsetX;
  const stemBottomY = noteOriginY + stemAnchorOffsetY;
  const strokeInset = 5;
  const strokeStep = 3.75;
  const strokeThickness = 2.5;
  const strokeStartX = leftStemX + strokeInset;
  const strokeEndX = rightStemX - strokeInset;
  const startY = 14 - ((slashes - 1) * strokeStep) / 2;
  return (
    <svg width="40" height="40" viewBox="0 0 44 40" style={SVG_BLOCK_STYLE} aria-hidden="true">
      <text x={leftOriginX} y={noteOriginY} fontFamily="Bravura" fontSize={20} fill="currentColor">
        {SMUFL.noteheadHalf}
      </text>
      <line x1={leftStemX} y1={stemBottomY} x2={leftStemX} y2={8} stroke="currentColor" strokeWidth={1.4} />
      <text x={rightOriginX} y={noteOriginY} fontFamily="Bravura" fontSize={20} fill="currentColor">
        {SMUFL.noteheadHalf}
      </text>
      <line x1={rightStemX} y1={stemBottomY} x2={rightStemX} y2={8} stroke="currentColor" strokeWidth={1.4} />
      {Array.from({ length: slashes }, (_, i) => {
        const y = startY + i * strokeStep;
        return (
          <polygon
            key={i}
            points={`${strokeStartX},${y + 2.2} ${strokeEndX},${y - 2.2} ${strokeEndX},${y - 2.2 + strokeThickness} ${strokeStartX},${y + 2.2 + strokeThickness}`}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

export function NonArpeggioIcon() {
  return (
    <svg width="36" height="40" viewBox="0 0 36 40" style={SVG_BLOCK_STYLE} aria-hidden="true">
      <line x1={14} y1={8} x2={14} y2={32} stroke="currentColor" strokeWidth={2} strokeLinecap="square" />
      <line x1={14} y1={8} x2={24} y2={8} stroke="currentColor" strokeWidth={2} strokeLinecap="square" />
      <line x1={14} y1={32} x2={24} y2={32} stroke="currentColor" strokeWidth={2} strokeLinecap="square" />
    </svg>
  );
}
