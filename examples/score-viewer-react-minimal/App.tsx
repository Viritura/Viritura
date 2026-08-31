/**
 * Minimal <ScoreView> integration example.
 *
 * 30-ish lines of React that render an MNX score with a live playhead.
 * Copy-paste-friendly starting point for embedding Viritura in your
 * own React app, docs site, or blog.
 */

import { useEffect, useState } from "react";
import { ScoreView } from "@viritura/score-viewer-react";

const SAMPLE_MNX_URL = "/sample.mnx";

export function App() {
  const [mnx, setMnx] = useState<string | null>(null);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    fetch(SAMPLE_MNX_URL)
      .then((r) => r.text())
      .then(setMnx);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setBeat((b) => (b + 0.25) % 16), 250);
    return () => clearInterval(id);
  }, []);

  if (!mnx) return <div style={{ padding: 24 }}>Loading sample.mnx…</div>;

  return (
    <div style={{ maxWidth: 900, margin: "32px auto" }}>
      <h1 style={{ fontFamily: "system-ui" }}>
        Viritura <code>&lt;ScoreView /&gt;</code> minimal example
      </h1>
      <p>
        The red line is a <code>&lt;ScoreView.Playhead&gt;</code> driven by a 250ms interval.
      </p>
      <ScoreView mnx={mnx} pageWidth={800} zoom={1}>
        <ScoreView.Playhead beat={beat} partId="p1" style={{ color: "#e34935" }} />
      </ScoreView>
    </div>
  );
}
