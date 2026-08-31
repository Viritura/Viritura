import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { ScorePreview } from "../storyFixtures/ScorePreview";
import { buildMnx } from "../storyFixtures/buildMnx";
import {
  initWasm,
  isWasmReady,
  wasmComputeLayout,
  SpatialIndex,
  paintDisplayList,
  type DisplayList,
} from "@viritura/renderer";

const meta: Meta = {
  title: "App/Tagged Element Verification",
  component: ScorePreview,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

/**
 * Score with diverse element types for verifying element tagging.
 * Includes: notes, rests, clefs, key sigs, time sigs, dynamics, barlines.
 */
const DIVERSE_SCORE_MNX = buildMnx({
  measures: [
    {
      time: { count: 4, unit: 4 },
      key: { fifths: 2 },
      dynamics: [{ value: "f", position: { fraction: [0, 1] } }],
      voices: [
        [
          { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
          { duration: "quarter", notes: [{ step: "F", octave: 5, alter: 1 }] },
          { duration: "quarter", notes: [{ step: "A", octave: 5 }] },
          { duration: "quarter", rest: true },
        ],
      ],
    },
    {
      dynamics: [{ value: "p", position: { fraction: [0, 1] } }],
      voices: [
        [
          {
            duration: "half",
            notes: [
              { step: "B", octave: 4 },
              { step: "D", octave: 5 },
            ],
          },
          { duration: "half", notes: [{ step: "E", octave: 5 }] },
        ],
      ],
    },
    {
      barline: { type: "double" },
      voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
    },
  ],
});

interface TagStats {
  totalCommands: number;
  taggedCommands: number;
  uniqueElementIds: string[];
  elementBboxCount: number;
  spatialIndexSize: number;
  elementIdsByType: Record<string, number>;
}

function analyzeDisplayList(dl: DisplayList): TagStats {
  const uniqueIds = new Set<string>();
  let taggedCount = 0;
  const byType: Record<string, number> = {};

  if (dl.elementIds) {
    for (const id of dl.elementIds) {
      if (id) {
        taggedCount++;
        uniqueIds.add(id);
        // Classify by ID pattern: clef, key, time, event, dynamics, etc.
        const type = classifyElementId(id);
        byType[type] = (byType[type] ?? 0) + 1;
      }
    }
  }

  const si = SpatialIndex.fromDisplayList(dl);

  return {
    totalCommands: dl.commands.length,
    taggedCommands: taggedCount,
    uniqueElementIds: Array.from(uniqueIds).sort(),
    elementBboxCount: dl.elementBboxes?.length ?? 0,
    spatialIndexSize: si.size,
    elementIdsByType: byType,
  };
}

function classifyElementId(id: string): string {
  if (id.includes("/clef")) return "clef";
  if (id.includes("/key")) return "key";
  if (id.includes("/time")) return "time";
  if (id.includes("/barline")) return "barline";
  if (id.includes("/hairpin")) return "hairpin";
  if (id.includes("/pedal")) return "pedal";
  if (id.includes("/ottava")) return "ottava";
  if (id.includes("/volta")) return "volta";
  if (id.includes("/dyn")) return "dynamics";
  if (id.includes("/s") && (id.includes("/ev") || id.includes("/e"))) return "event";
  return "other";
}

/** Debug overlay that shows element bounding boxes on a canvas. */
function TaggedElementOverlay({ mnxJson }: { mnxJson: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const siRef = useRef<SpatialIndex | null>(null);
  const [stats, setStats] = useState<TagStats | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [showBboxes, setShowBboxes] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    initWasm().then(() => setWasmReady(isWasmReady()));
  }, []);

  const renderWithDebug = useCallback(() => {
    if (!wasmReady || !canvasRef.current) return;

    try {
      const dl = wasmComputeLayout(mnxJson, 0, 8, 800);
      const tagStats = analyzeDisplayList(dl);
      setStats(tagStats);

      const si = SpatialIndex.fromDisplayList(dl);
      siRef.current = si;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = dl.width * dpr;
      canvas.height = dl.height * dpr;
      canvas.style.width = `${dl.width}px`;
      canvas.style.height = `${dl.height}px`;
      ctx.scale(dpr, dpr);

      // Paint the score
      paintDisplayList(ctx, dl);

      // Draw element bounding box overlay
      if (showBboxes) {
        ctx.save();
        for (const entry of si.all) {
          const isHovered = entry.id === hoveredId;
          ctx.strokeStyle = isHovered ? "#FF0000" : "#4285F4";
          ctx.lineWidth = isHovered ? 2 : 1;
          ctx.globalAlpha = isHovered ? 0.8 : 0.3;
          ctx.strokeRect(entry.x, entry.y, entry.width, entry.height);
          if (isHovered) {
            ctx.fillStyle = "#4285F4";
            ctx.globalAlpha = 0.15;
            ctx.fillRect(entry.x, entry.y, entry.width, entry.height);
          }
        }
        ctx.restore();
      }
    } catch (err) {
      console.error("Tagged element verification error:", err);
    }
  }, [wasmReady, mnxJson, showBboxes, hoveredId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    renderWithDebug();
  }, [renderWithDebug]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const si = siRef.current;
    if (!si) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hitId = si.hitTest(x, y) ?? si.findNearest(x, y, 15);
    setHoveredId(hitId);
  }, []);

  if (!wasmReady) {
    return <div style={LOADING_STYLE}>Loading WASM engine...</div>;
  }

  return (
    <div style={ROOT_STYLE}>
      <div style={LEFT_COL_STYLE}>
        <h3 style={H3_STYLE}>Score with Element Bounding Boxes</h3>
        <label style={CHECKBOX_LABEL_STYLE}>
          <input type="checkbox" checked={showBboxes} onChange={(e) => setShowBboxes(e.target.checked)} /> Show element
          bounding boxes
        </label>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredId(null)}
          style={CANVAS_STYLE}
        />
        {hoveredId && (
          <div style={HOVERED_LABEL_STYLE}>
            Hovered: <strong>{hoveredId}</strong>
          </div>
        )}
      </div>
      <div style={RIGHT_COL_STYLE}>
        <h3 style={H3_STYLE}>Tag Statistics</h3>
        {stats ? (
          <div>
            <table style={TABLE_STYLE}>
              <tbody>
                <StatRow label="Total commands" value={stats.totalCommands} />
                <StatRow label="Tagged commands" value={stats.taggedCommands} />
                <StatRow label="Unique element IDs" value={stats.uniqueElementIds.length} />
                <StatRow label="Element bboxes (engine)" value={stats.elementBboxCount} />
                <StatRow label="SpatialIndex entries" value={stats.spatialIndexSize} />
              </tbody>
            </table>

            <h4 style={H4_STYLE}>By Element Type</h4>
            <table style={TABLE_STYLE}>
              <tbody>
                {Object.entries(stats.elementIdsByType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <StatRow key={type} label={type} value={count} />
                  ))}
              </tbody>
            </table>

            <h4 style={H4_STYLE}>All Element IDs</h4>
            <div style={ID_LIST_STYLE}>
              {stats.uniqueElementIds.map((id) => (
                <div
                  key={id}
                  style={idRowStyle(hoveredId === id)}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {id}
                </div>
              ))}
            </div>

            {stats.taggedCommands > 0 && (
              <div style={BANNER_SUCCESS_STYLE}>
                ✅ Element tagging is active ({stats.taggedCommands} tagged / {stats.totalCommands} total)
              </div>
            )}
            {stats.elementBboxCount > 0 && (
              <div style={BANNER_INFO_STYLE}>
                ✅ Engine bboxes available ({stats.elementBboxCount} precise bounding boxes)
              </div>
            )}
            {stats.taggedCommands === 0 && (
              <div style={BANNER_WARN_STYLE}>⚠ No tagged commands — WASM may need rebuild</div>
            )}
          </div>
        ) : (
          <div>Computing...</div>
        )}
      </div>
    </div>
  );
}

const LOADING_STYLE: CSSProperties = { padding: 20 };
const ROOT_STYLE: CSSProperties = { display: "flex", gap: 16, padding: 16, fontFamily: "system-ui" };
const LEFT_COL_STYLE: CSSProperties = { flex: 1 };
const H3_STYLE: CSSProperties = { margin: "0 0 8px" };
const H4_STYLE: CSSProperties = { margin: "12px 0 4px" };
const CHECKBOX_LABEL_STYLE: CSSProperties = { display: "block", marginBottom: 8, fontSize: "var(--type-small-size)" };
const CANVAS_STYLE: CSSProperties = { border: "1px solid #ddd", cursor: "crosshair" };
const HOVERED_LABEL_STYLE: CSSProperties = {
  marginTop: 8,
  fontSize: "var(--type-small-size)",
  fontFamily: "monospace",
  color: "#333",
};
const RIGHT_COL_STYLE: CSSProperties = { width: 320, fontSize: "var(--type-small-size)" };
const TABLE_STYLE: CSSProperties = { borderCollapse: "collapse", width: "100%" };
const ID_LIST_STYLE: CSSProperties = {
  maxHeight: 200,
  overflow: "auto",
  border: "1px solid #eee",
  padding: 4,
  fontFamily: "monospace",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: 1.6,
};
const BANNER_SUCCESS_STYLE: CSSProperties = { marginTop: 12, padding: 8, background: "#e8f5e9", borderRadius: 4 };
const BANNER_INFO_STYLE: CSSProperties = { marginTop: 4, padding: 8, background: "#e3f2fd", borderRadius: 4 };
const BANNER_WARN_STYLE: CSSProperties = { marginTop: 12, padding: 8, background: "#fff3e0", borderRadius: 4 };
const STAT_LABEL_STYLE: CSSProperties = { padding: "2px 8px 2px 0", color: "#666" };
const STAT_VALUE_STYLE: CSSProperties = { padding: "2px 0", fontWeight: "bold", fontFamily: "monospace" };

function idRowStyle(isHovered: boolean): CSSProperties {
  return {
    color: isHovered ? "#FF0000" : "#333",
    fontWeight: isHovered ? "bold" : "normal",
    cursor: "pointer",
  };
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td style={STAT_LABEL_STYLE}>{label}</td>
      <td style={STAT_VALUE_STYLE}>{value}</td>
    </tr>
  );
}

/**
 * Visual verification of tagged elements in the browser.
 * Shows a score with debug bounding box overlay and element tag statistics.
 * Hover over elements to see their IDs.
 */
export const TaggedElementDebug: StoryObj = {
  render: () => <TaggedElementOverlay mnxJson={DIVERSE_SCORE_MNX} />,
  name: "Tagged Element Verification",
};

/**
 * Standard ScorePreview rendering for comparison (no debug overlay).
 * Click on elements to verify selection / hit-testing works.
 */
export const InteractiveSelection: StoryObj = {
  render: () => <ScorePreview mnxJson={DIVERSE_SCORE_MNX} showEditor={false} />,
  name: "Interactive Selection Test",
};
