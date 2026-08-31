/* eslint-disable react-hooks/refs -- intentional ref-bag pattern; refs hold stable identity, not render-time state (violations occur inside JSX attribute lists; inline directives don't parse there) */
/**
 * SpatialCanvas — 2D top-down view for positioning instruments in space.
 *
 * Renders a concert-hall grid with:
 * - Draggable instrument dots (color-coded by family)
 * - Draggable child nodes for ensemble layers (smaller dots linked to parent)
 * - Draggable listener position (ear icon)
 * - Grid lines and stage outline
 * - Labels on hover
 *
 * Parent-child drag behavior:
 * - Dragging a parent moves its child nodes by the same delta
 * - Dragging a child node moves it independently
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Headphones } from "lucide-react";
import { Sphere, Tooltip } from "@viritura/ui";
import { useSpatial, useSpatialActions } from "../store/spatialStore";
import { findHitTarget, findHoverTarget, useWheelZoom, type DragTarget } from "./spatialCanvasInteraction";

export interface SpatialPartInfo {
  name: string;
  index: number;
  color: string;
  /** Emoji icon for the instrument family. */
  icon?: string;
}

interface SpatialCanvasProps {
  parts: SpatialPartInfo[];
  /** Called when an instrument drag ends, so the new positions can be
   *  persisted into the score. Not called for listener/child drags or panning. */
  onCommitPositions?: () => void;
}

// Coordinate system: world space in meters
// X: -8 to +8 (left to right)
// Y: -3 to +14 (audience to backstage)
const WORLD_MIN_X = -8;
const WORLD_MAX_X = 8;
const WORLD_MIN_Y = -3;
const WORLD_MAX_Y = 14;
const WORLD_W = WORLD_MAX_X - WORLD_MIN_X;
const WORLD_H = WORLD_MAX_Y - WORLD_MIN_Y;

export function SpatialCanvas({ parts, onCommitPositions }: SpatialCanvasProps) {
  const spatial = useSpatial();
  const { setPartPosition, setListenerPosition, setChildPosition } = useSpatialActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 200 });
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoveredChild, setHoveredChild] = useState<string | null>(null);

  // Zoom & pan state (zoom = scale factor, pan = offset in screen px before zoom)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // World → screen coordinate conversion (Y inverted, with zoom + pan)
  const toScreen = useCallback(
    (wx: number, wy: number) => ({
      sx: (((wx - WORLD_MIN_X) / WORLD_W) * size.w + pan.x) * zoom,
      sy: (((WORLD_MAX_Y - wy) / WORLD_H) * size.h + pan.y) * zoom,
    }),
    [size, zoom, pan],
  );

  // Screen → world coordinate conversion (Y inverted, with zoom + pan)
  const toWorld = useCallback(
    (sx: number, sy: number) => ({
      wx: ((sx / zoom - pan.x) / size.w) * WORLD_W + WORLD_MIN_X,
      wy: WORLD_MAX_Y - ((sy / zoom - pan.y) / size.h) * WORLD_H,
    }),
    [size, zoom, pan],
  );

  // Ctrl+scroll zoom (zoom toward cursor)
  useWheelZoom(
    containerRef,
    zoomRef,
    panRef,
    useCallback((nextZ, nextP) => {
      zoomRef.current = nextZ;
      panRef.current = nextP;
      setZoom(nextZ);
      setPan(nextP);
    }, []),
  );

  // Pointer handlers for dragging
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const beginPan = () => {
        setPanning(true);
        panStartRef.current = { x: panRef.current.x, y: panRef.current.y, px: e.clientX, py: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      };
      if (e.button === 1) {
        beginPan();
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { wx, wy } = toWorld(sx, sy);
      const hit = findHitTarget(wx, wy, spatial);
      if (hit) {
        setDragging(hit);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      beginPan();
    },
    [spatial, toWorld],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (panning) {
        const z = zoomRef.current;
        const dx = (e.clientX - panStartRef.current.px) / z;
        const dy = (e.clientY - panStartRef.current.py) / z;
        const nextP = { x: panStartRef.current.x + dx, y: panStartRef.current.y + dy };
        panRef.current = nextP;
        setPan(nextP);
        return;
      }

      const { wx, wy } = toWorld(e.clientX - rect.left, e.clientY - rect.top);

      if (dragging) {
        if (dragging.type === "listener") setListenerPosition(wx, wy);
        else if (dragging.type === "child") setChildPosition(dragging.childId, wx, wy);
        else setPartPosition(dragging.index, wx, wy);
        return;
      }

      const hover = findHoverTarget(wx, wy, spatial);
      setHovered(hover.hovered);
      setHoveredChild(hover.hoveredChild);
    },
    [dragging, panning, spatial, toWorld, setPartPosition, setListenerPosition, setChildPosition],
  );

  const handlePointerUp = useCallback(() => {
    // Persist the arrangement only when an instrument dot was dragged — not
    // for listener/child drags (not persisted) or panning.
    if (dragging?.type === "part") onCommitPositions?.();
    setDragging(null);
    setPanning(false);
  }, [dragging, onCommitPositions]);

  // Build lookup: partIndex → color from parts prop
  const partColorMap = useRef(new Map<number, string>());

  partColorMap.current.clear();

  for (const p of parts) partColorMap.current.set(p.index, p.color);

  // Virtual canvas size (accounting for zoom)
  const vw = size.w * zoom;
  const vh = size.h * zoom;

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div ref={containerRef} style={canvasContainerStyle}>
      <svg
        width={size.w}
        height={size.h}
        style={svgWithPanCursorStyle(panning)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={resetZoom}
      >
        <StageBackdrop toScreen={toScreen} vw={vw} vh={vh} />

        <FamilyLinks
          childNodes={spatial.childNodes}
          positions={spatial.positions}
          partColorMap={partColorMap.current}
          hovered={hovered}
          hoveredChild={hoveredChild}
          dragging={dragging}
          toScreen={toScreen}
        />

        <PartGroupLinks
          partGroups={spatial.partGroups}
          positions={spatial.positions}
          hovered={hovered}
          dragging={dragging}
          toScreen={toScreen}
        />

        {/* Instrument dots with labels */}
        {parts.map((part) => (
          <PartDot
            key={part.index}
            part={part}
            position={spatial.positions[part.index]}
            isDragging={dragging?.type === "part" && dragging.index === part.index}
            isHovered={hovered === part.index}
            isGroupParent={spatial.partGroups.some((g) => g.parentIndex === part.index)}
            toScreen={toScreen}
          />
        ))}

        {/* Child nodes (ensemble layer positions) */}
        {}
        {spatial.childNodes.map((cn) => (
          <ChildNodeDot
            key={cn.id}
            childNode={cn}
            color={partColorMap.current.get(cn.parentPartIndex) ?? "#888"}
            isDragging={dragging?.type === "child" && dragging.childId === cn.id}
            isHovered={hoveredChild === cn.id}
            toScreen={toScreen}
          />
        ))}

        <ListenerDot listener={spatial.listener} isDragging={dragging?.type === "listener"} toScreen={toScreen} />
      </svg>

      {/* Zoom indicator (shown when not at 1x) */}
      {zoom !== 1 && (
        <Tooltip content="Click to reset zoom">
          <div style={zoomBadgeStyle} onClick={resetZoom}>
            {Math.round(zoom * 100)}%
          </div>
        </Tooltip>
      )}

      {/* Info overlay */}
      {!spatial.enabled && (
        <div style={disabledOverlayStyle}>
          <Headphones size={24} />
          <span>Spatial audio disabled</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Sub-components (purely presentational)
// ═══════════════════════════════════════════

type ToScreen = (wx: number, wy: number) => { sx: number; sy: number };

interface StageBackdropProps {
  toScreen: ToScreen;
  vw: number;
  vh: number;
}

function StageBackdrop({ toScreen, vw, vh }: StageBackdropProps) {
  return (
    <>
      {/* Grid lines */}
      {Array.from({ length: WORLD_W + 1 }, (_, i) => {
        const x = WORLD_MIN_X + i;
        const { sx } = toScreen(x, 0);
        return (
          <line
            key={`vg${i}`}
            x1={sx}
            y1={-vh}
            x2={sx}
            y2={vh * 2}
            stroke="var(--border)"
            strokeWidth={x === 0 ? 1 : 0.5}
            strokeDasharray={x === 0 ? "" : "2,4"}
            opacity={0.3}
          />
        );
      })}
      {Array.from({ length: WORLD_H + 1 }, (_, i) => {
        const y = WORLD_MIN_Y + i;
        const { sy } = toScreen(0, y);
        return (
          <line
            key={`hg${i}`}
            x1={-vw}
            y1={sy}
            x2={vw * 2}
            y2={sy}
            stroke="var(--border)"
            strokeWidth={y === 0 ? 1 : 0.5}
            strokeDasharray={y === 0 ? "" : "2,4"}
            opacity={0.3}
          />
        );
      })}

      {/* Stage floor — soft radial spotlight wash + hairline border. */}
      <StageFloor toScreen={toScreen} />

      {/* Stage labels */}
      {(() => {
        const { sx: sx1, sy: sy1 } = toScreen(0, 13);
        const { sx: sx2, sy: sy2 } = toScreen(0, -2);
        return (
          <>
            <text x={sx1} y={sy1} textAnchor="middle" fill="var(--text-muted)" fontSize={14} opacity={0.5}>
              UPSTAGE
            </text>
            <text x={sx2} y={sy2} textAnchor="middle" fill="var(--text-muted)" fontSize={14} opacity={0.5}>
              AUDIENCE
            </text>
          </>
        );
      })()}
    </>
  );
}

function StageFloor({ toScreen }: { toScreen: ToScreen }) {
  const tl = toScreen(-6, 12);
  const br = toScreen(6, 0);
  const w = br.sx - tl.sx;
  const h = br.sy - tl.sy;
  return (
    <>
      <defs>
        <radialGradient id="stageFloorWash" cx="50%" cy="22%" r="78%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.10" />
          <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.04" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <filter id="stageFloorShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
          <feOffset dx="0" dy="4" result="blurred" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.25" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect
        x={tl.sx}
        y={tl.sy}
        width={w}
        height={h}
        rx={12}
        fill="url(#stageFloorWash)"
        stroke="var(--border)"
        strokeWidth={1}
        opacity={0.95}
        filter="url(#stageFloorShadow)"
      />
    </>
  );
}

interface FamilyLinksProps {
  childNodes: ReturnType<typeof useSpatial>["childNodes"];
  positions: ReturnType<typeof useSpatial>["positions"];
  partColorMap: Map<number, string>;
  hovered: number | null;
  hoveredChild: string | null;
  dragging: DragTarget | null;
  toScreen: ToScreen;
}

function FamilyLinks({
  childNodes,
  positions,
  partColorMap,
  hovered,
  hoveredChild,
  dragging,
  toScreen,
}: FamilyLinksProps) {
  return (
    <>
      {childNodes.map((cn) => {
        const parentPos = positions[cn.parentPartIndex];
        if (!parentPos) return null;
        const hoveredChildParent = hoveredChild
          ? childNodes.find((c) => c.id === hoveredChild)?.parentPartIndex
          : undefined;
        const draggingChildParent =
          dragging?.type === "child" ? childNodes.find((c) => c.id === dragging.childId)?.parentPartIndex : undefined;
        const familyActive =
          hovered === cn.parentPartIndex ||
          (dragging?.type === "part" && dragging.index === cn.parentPartIndex) ||
          hoveredChildParent === cn.parentPartIndex ||
          draggingChildParent === cn.parentPartIndex;
        if (!familyActive) return null;
        const { sx: px, sy: py } = toScreen(parentPos.x, parentPos.y);
        const { sx: cx, sy: cy } = toScreen(cn.position.x, cn.position.y);
        return (
          <line
            key={`link-${cn.id}`}
            x1={px}
            y1={py}
            x2={cx}
            y2={cy}
            stroke={partColorMap.get(cn.parentPartIndex) ?? "#888"}
            strokeWidth={1}
            strokeDasharray="3,3"
            opacity={0.5}
          />
        );
      })}
    </>
  );
}

interface PartGroupLinksProps {
  partGroups: ReturnType<typeof useSpatial>["partGroups"];
  positions: ReturnType<typeof useSpatial>["positions"];
  hovered: number | null;
  dragging: DragTarget | null;
  toScreen: ToScreen;
}

function PartGroupLinks({ partGroups, positions, hovered, dragging, toScreen }: PartGroupLinksProps) {
  return (
    <>
      {partGroups.map((group) => {
        const parentPos = positions[group.parentIndex];
        if (!parentPos) return null;
        const dragPartIdx = dragging?.type === "part" ? dragging.index : undefined;
        const groupActive =
          hovered === group.parentIndex ||
          dragPartIdx === group.parentIndex ||
          (hovered !== null && group.memberIndices.includes(hovered)) ||
          (dragPartIdx !== undefined && group.memberIndices.includes(dragPartIdx));
        if (!groupActive) return null;
        const { sx: px, sy: py } = toScreen(parentPos.x, parentPos.y);
        return group.memberIndices.map((memberIdx) => {
          const memberPos = positions[memberIdx];
          if (!memberPos) return null;
          const { sx: mx, sy: my } = toScreen(memberPos.x, memberPos.y);
          return (
            <line
              key={`grp-${group.parentIndex}-${memberIdx}`}
              x1={px}
              y1={py}
              x2={mx}
              y2={my}
              stroke="var(--text-muted)"
              strokeWidth={0.5}
              strokeDasharray="2,4"
              opacity={0.4}
            />
          );
        });
      })}
    </>
  );
}

interface PartDotProps {
  part: SpatialPartInfo;
  position: { x: number; y: number } | undefined;
  isDragging: boolean;
  isHovered: boolean;
  isGroupParent: boolean;
  toScreen: ToScreen;
}

function PartDot({ part, position, isDragging, isHovered, isGroupParent, toScreen }: PartDotProps) {
  if (!position) return null;
  const { sx, sy } = toScreen(position.x, position.y);
  // Constant outer size = drag size; CSS transform inside
  // Sphere scales it down at rest and lifts smoothly.
  const rMax = 17;
  const lift = isDragging ? 1 : isHovered ? 0.5 : 0;
  const r = rMax * (0.78 + lift * 0.22); // visual radius for hit ring
  return (
    <g style={G_GRAB_STYLE}>
      {isGroupParent && (
        <circle
          cx={sx}
          cy={sy}
          r={r + 4}
          fill="none"
          stroke={part.color}
          strokeWidth={1}
          strokeDasharray="2,2"
          opacity={0.5}
        />
      )}
      <foreignObject
        x={sx - rMax * 2}
        y={sy - rMax * 2}
        width={rMax * 4}
        height={rMax * 4}
        style={FOREIGN_OBJECT_STYLE}
      >
        <div style={sphereWrapStyle(rMax)}>
          <Sphere color={part.color} size={rMax * 2} lift={lift} />
        </div>
      </foreignObject>
      <circle
        cx={sx}
        cy={sy}
        r={r}
        fill="transparent"
        stroke={isDragging ? "#fff" : isHovered ? "rgba(255,255,255,0.6)" : "none"}
        strokeWidth={isDragging ? 2 : 1}
      />
      <text
        x={sx}
        y={sy - r - 5}
        textAnchor="middle"
        fill="var(--text)"
        fontSize={13}
        opacity={isHovered || isDragging ? 1 : 0.7}
        fontWeight={isHovered || isDragging ? 600 : 400}
        style={TEXT_NO_POINTER_STYLE}
      >
        {part.name}
      </text>
    </g>
  );
}

interface ChildNodeDotProps {
  childNode: ReturnType<typeof useSpatial>["childNodes"][number];
  color: string;
  isDragging: boolean;
  isHovered: boolean;
  toScreen: ToScreen;
}

function ChildNodeDot({ childNode: cn, color, isDragging, isHovered, toScreen }: ChildNodeDotProps) {
  const { sx, sy } = toScreen(cn.position.x, cn.position.y);
  const rMax = 12;
  const lift = isDragging ? 1 : isHovered ? 0.5 : 0;
  const r = rMax * (0.78 + lift * 0.22);
  return (
    <g style={G_GRAB_STYLE}>
      <foreignObject
        x={sx - rMax * 2}
        y={sy - rMax * 2}
        width={rMax * 4}
        height={rMax * 4}
        style={FOREIGN_OBJECT_STYLE}
      >
        <div style={sphereWrapStyle(rMax, true)}>
          <Sphere color={color} size={rMax * 2} lift={lift} />
        </div>
      </foreignObject>
      <circle
        cx={sx}
        cy={sy}
        r={r}
        fill="transparent"
        stroke={isDragging ? "#fff" : isHovered ? "rgba(255,255,255,0.6)" : "none"}
        strokeWidth={isDragging ? 2 : 1}
      />
      <text
        x={sx}
        y={sy - r - 3}
        textAnchor="middle"
        fill="var(--text-muted)"
        fontSize={11}
        opacity={isHovered || isDragging ? 1 : 0.6}
        fontWeight={isHovered || isDragging ? 600 : 400}
        style={TEXT_NO_POINTER_STYLE}
      >
        {cn.label}
      </text>
    </g>
  );
}

interface ListenerDotProps {
  listener: ReturnType<typeof useSpatial>["listener"];
  isDragging: boolean;
  toScreen: ToScreen;
}

function ListenerDot({ listener, isDragging, toScreen }: ListenerDotProps) {
  const { sx, sy } = toScreen(listener.x, listener.y);
  const rMax = 18;
  const lift = isDragging ? 1 : 0;
  const r = rMax * (0.78 + lift * 0.22);
  return (
    <g style={G_GRAB_STYLE}>
      <foreignObject
        x={sx - rMax * 2}
        y={sy - rMax * 2}
        width={rMax * 4}
        height={rMax * 4}
        style={FOREIGN_OBJECT_STYLE}
      >
        <div style={sphereWrapStyle(rMax)}>
          <Sphere color="var(--accent)" size={rMax * 2} lift={lift} />
        </div>
      </foreignObject>
      <circle cx={sx} cy={sy} r={r} fill="transparent" stroke={isDragging ? "#fff" : "none"} strokeWidth={2} />
      <text x={sx} y={sy + r + 18} textAnchor="middle" fill="var(--text-muted)" fontSize={13}>
        Listener
      </text>
    </g>
  );
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

const FOREIGN_OBJECT_STYLE: CSSProperties = { overflow: "visible", pointerEvents: "none" };
const G_GRAB_STYLE: CSSProperties = { cursor: "grab" };
const TEXT_NO_POINTER_STYLE: CSSProperties = { pointerEvents: "none" };
function sphereWrapStyle(rMax: number, withOpacity = false): CSSProperties {
  return {
    width: rMax * 2,
    height: rMax * 2,
    margin: `${rMax}px 0 0 ${rMax}px`,
    ...(withOpacity ? { opacity: 0.85 } : {}),
  };
}
function svgWithPanCursorStyle(panning: boolean): CSSProperties {
  return { ...svgStyle, cursor: panning ? "grabbing" : undefined };
}

const canvasContainerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 200,
  position: "relative",
  overflow: "hidden",
  background: "var(--surface-raised)",
  borderRadius: 8,
  userSelect: "none",
};

const svgStyle: CSSProperties = {
  display: "block",
  touchAction: "none",
};

const disabledOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: "rgba(0,0,0,0.5)",
  color: "#fff",
  fontSize: "var(--type-small-size)",
  borderRadius: 8,
};

const zoomBadgeStyle: CSSProperties = {
  position: "absolute",
  bottom: 8,
  right: 8,
  padding: "2px 8px",
  borderRadius: 4,
  background: "var(--surface-raised)",
  boxShadow: "var(--elevation-0)",
  color: "var(--text-muted)",
  fontSize: "var(--type-small-size)",
  fontFamily: "monospace",
  cursor: "pointer",
  userSelect: "none",
};
