/**
 * FpsCounter — tiny diagnostic overlay.
 *
 * Drop anywhere with `position: relative` ancestry; it absolutely
 * positions itself in the top-right. Samples frame timing via rAF,
 * displays a rolling 1-second average + worst frame. Cheap enough to
 * leave on during dev; gate behind `import.meta.env.DEV` in the
 * caller if you don't want it in production builds.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

const STYLE: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  zIndex: 10,
  padding: "4px 8px",
  font: "600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#fff",
  background: "rgba(0, 0, 0, 0.6)",
  borderRadius: 4,
  pointerEvents: "none",
  fontVariantNumeric: "tabular-nums",
};

export function FpsCounter() {
  const [text, setText] = useState("— fps");
  const framesRef = useRef<number[]>([]);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (lastRef.current === null) {
        lastRef.current = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = now - lastRef.current;
      lastRef.current = now;
      const frames = framesRef.current;
      frames.push(dt);
      // Keep ~1s of samples.
      let total = 0;
      for (let i = frames.length - 1; i >= 0; i--) {
        total += frames[i]!;
        if (total > 1000) {
          frames.splice(0, i);
          break;
        }
      }
      if (frames.length >= 10) {
        const sum = frames.reduce((a, b) => a + b, 0);
        const avg = sum / frames.length;
        const worst = Math.max(...frames);
        const fps = Math.round(1000 / avg);
        const worstMs = Math.round(worst);
        setText(`${fps} fps · ${worstMs}ms worst`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div style={STYLE}>{text}</div>;
}
