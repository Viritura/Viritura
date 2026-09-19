import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AccidentalType, NoteheadShape, NoteValueBase } from "@viritura/core";
import { initWasm, isWasmReady, loadMusicFont, paintGhostNote } from "@viritura/renderer";

interface InputGhostPreviewProps {
  duration: NoteValueBase;
  dots: number;
  spatium: number;
  staffY: number;
  staffPosition: number;
  stemDirection: "up" | "down";
  accidental: AccidentalType | null;
  notehead: NoteheadShape;
  isRest: boolean;
  isGrace: boolean;
  slash: boolean;
}

const CANVAS_STYLE: CSSProperties = { width: 720, height: 440, maxWidth: "100%" };

export function InputGhostPreview(props: InputGhostPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Loading the engraving engine and music font…");
  const {
    duration,
    dots,
    spatium,
    staffY,
    staffPosition,
    stemDirection,
    accidental,
    notehead,
    isRest,
    isGrace,
    slash,
  } = props;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([initWasm(), loadMusicFont()])
      .then(() => {
        if (cancelled) return;
        if (!isWasmReady()) {
          setStatus("The engraving engine could not load.");
          return;
        }
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 720 * dpr;
        canvas.height = 440 * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 720, 440);
        ctx.strokeStyle = "#444444";
        ctx.lineWidth = spatium * 0.13;
        for (let line = 0; line < 5; line++) {
          ctx.beginPath();
          ctx.moveTo(40, staffY + line * spatium);
          ctx.lineTo(680, staffY + line * spatium);
          ctx.stroke();
        }
        paintGhostNote(ctx, {
          x: 320,
          y: staffY + (staffPosition * spatium) / 2,
          staff: { x: 40, xEnd: 680, y: staffY, spatium, height: spatium * 4, index: 0 },
          duration,
          dots,
          stemDirection,
          accidental,
          notehead,
          isRest,
          isGrace,
          slash,
        });
        setStatus("Change the controls to repaint the stationary Add Note ghost using the Rust engraver.");
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Unable to load the preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [duration, dots, spatium, staffY, staffPosition, stemDirection, accidental, notehead, isRest, isGrace, slash]);

  return (
    <div>
      <p role="status">{status}</p>
      <canvas ref={canvasRef} style={CANVAS_STYLE} aria-label="Add Note rhythm ghost on a five-line staff" />
    </div>
  );
}
