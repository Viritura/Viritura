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

function StemmedNote({ x, y, stem = "up" }: { x: number; y: number; stem?: "up" | "down" }) {
  const stemX = x + (stem === "up" ? 6.4 : 0.65);
  const direction = stem === "up" ? -1 : 1;
  return (
    <g>
      <line
        x1={stemX}
        y1={y + direction * 0.8}
        x2={stemX}
        y2={y + direction * 14}
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <text x={x} y={y} fontFamily="Bravura" fontSize={24} fill="currentColor">
        {SMUFL.noteheadBlack}
      </text>
    </g>
  );
}

export function TieIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={SVG_BLOCK_STYLE} aria-hidden="true">
      <StemmedNote x={4} y={25} />
      <path d="M12 27 C16 36 25 36 29 27 C24 33 17 33 12 27 Z" fill="currentColor" />
      <StemmedNote x={29} y={25} />
    </svg>
  );
}

export function SlurIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={SVG_BLOCK_STYLE} aria-hidden="true">
      <path d="M8 30 C14 39 30 35 34 22 C30 32 15 36 8 30 Z" fill="currentColor" />
      <StemmedNote x={4} y={25} />
      <StemmedNote x={17} y={21} />
      <StemmedNote x={30} y={17} />
    </svg>
  );
}

export function LaissezVibrerIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={SVG_BLOCK_STYLE} aria-hidden="true">
      <StemmedNote x={10} y={25} />
      <path d="M18 27 C21 33 26 33 29 27 C26 31 21 31 18 27 Z" fill="currentColor" />
    </svg>
  );
}

export function GlissandoIcon({ wavy = false }: { wavy?: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={SVG_BLOCK_STYLE} aria-hidden="true">
      <StemmedNote x={4} y={27} />
      {wavy ? (
        <g transform="translate(12 24) rotate(-28)">
          {[0, 1, 2, 3].map((index) => (
            <text key={index} x={index * 4.8} y={0} fontFamily="Bravura" fontSize={20} fill="currentColor">
              {SMUFL.wiggleGlissando}
            </text>
          ))}
        </g>
      ) : (
        <line x1={12} y1={24} x2={29} y2={15} stroke="currentColor" strokeWidth={1.4} />
      )}
      <StemmedNote x={30} y={13} stem="down" />
    </svg>
  );
}
