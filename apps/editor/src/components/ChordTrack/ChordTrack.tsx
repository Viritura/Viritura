import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatChordSymbolText, parseChordSymbolText, resolveChordSymbol } from "@viritura/core";
import { Button, TextPopover, type TextPopoverProps } from "@viritura/ui";
import { useSelection } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { useThemeStore } from "../../store/themeStore";
import { LANE_HEIGHT, pointChord } from "./trackGeometry";
import { useChordTrackPaint } from "./useChordTrackPaint";
import { useChordTrackEditing } from "./useChordTrackEditing";
import type { ChordTrackProps, TrackPoint } from "./types";
import styles from "./ChordTrack.module.css";
import { ChordTrackSettingsTrigger } from "./ChordTrackSettingsButton";
import { useChordTrackNavigation } from "./useChordTrackNavigation";
import { useChordTrackDrag } from "./useChordTrackDrag";
import { useChordTrackGeometry } from "./useChordTrackGeometry";

function chordPreview(value: string) {
  if (!value.trim()) return null;
  const resolution = resolveChordSymbol(parseChordSymbolText(value, { fraction: [0, 1] }));
  return resolution.status === "unsupported" ? <p role="status">{resolution.message}</p> : null;
}

function useTrackSize(root: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0, bottomOverlay: 0 });
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const overlay = getComputedStyle(entry.target).getPropertyValue("--workspace-status-zone-height");
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
        bottomOverlay: overlay ? parseFloat(overlay) : 0,
      });
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [root]);
  return size;
}

interface ChordEntryPopoverProps {
  editing: ReturnType<typeof useChordTrackEditing>;
  onClose: () => void;
  onNavigate: NonNullable<TextPopoverProps["onNavigate"]>;
}

function ChordEntryPopover({ editing, onClose, onNavigate }: ChordEntryPopoverProps) {
  const { editor } = editing;
  return (
    <TextPopover
      key={editor ? `${editor.point.measureIndex}:${editor.point.beat}:${editor.point.position?.graceIndex}` : "closed"}
      open={editor !== null}
      onClose={onClose}
      onSubmit={editing.commit}
      onNavigate={onNavigate}
      spaceNavigation="measure"
      position={editor?.position ?? { x: 0, y: 0 }}
      title={editor ? `Chord · Bar ${editor.point.measureIndex + 1} · Concert pitch` : "Chord"}
      initialValue={editing.initialText || (editing.selected ? formatChordSymbolText(editing.selected.symbol) : "")}
      placeholder="e.g. Cmaj7, Dm7, G7/B"
      renderPreview={chordPreview}
    >
      {editing.selected && editor && (
        <div className={styles.actions}>
          <Button label="Remove chord" variant="danger" onClick={() => editing.remove(editor.point)} />
        </div>
      )}
    </TextPopover>
  );
}

export function ChordTrack({
  displayList,
  viewport,
  playhead,
  onRevealPoint,
  onPanBy,
  safeAreaLeft = 0,
  safeAreaTop = 0,
  safeAreaBottom = 0,
}: ChordTrackProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useTrackSize(root);
  const [hover, setHover] = useState<TrackPoint | null>(null);
  const editing = useChordTrackEditing(displayList);
  const { score, chords, editor } = editing;
  const selection = useSelection();
  const grid = useViewStateStore((state) => state.chordTrackGrid);
  const sticky = useViewStateStore((state) => state.chordTrackSticky);
  const position = useViewStateStore((state) => state.chordTrackPosition);
  const theme = useThemeStore((state) => state.theme);
  const {
    system,
    scale,
    paintSystem,
    railScoreY,
    railY,
    laneZoom,
    scoreX,
    allPoints,
    finePoints,
    beatPoints,
    header,
    positioned,
    active,
    points,
    laneVisible,
    surfaceStyle,
    bottomInset,
    pinned,
  } = useChordTrackGeometry({
    displayList,
    viewport,
    score,
    chords,
    grid,
    sticky,
    position,
    safeAreaLeft,
    safeAreaTop,
    safeAreaBottom,
    selection,
    hover,
    size,
  });
  const drag = useChordTrackDrag({
    root,
    points: allPoints,
    finePoints,
    viewport,
    railY,
    height: LANE_HEIGHT * laneZoom,
    minX: Math.max(safeAreaLeft, header.right),
    onMove: editing.move,
    onPanBy,
    enabled: !editor,
  });
  const { close, navigate, keyDown } = useChordTrackNavigation({
    root,
    viewport,
    railY,
    laneZoom,
    points: allPoints,
    beatPoints,
    editing,
    onRevealPoint,
  });
  const visibleChords = positioned.filter(
    (entry) =>
      (scoreX(entry.point.x + entry.width) >= header.right && scoreX(entry.point.x) <= size.width) ||
      entry.chord.elementId === drag.preview?.source.elementId,
  );

  useChordTrackPaint({
    canvas,
    system: paintSystem,
    size,
    visible: laneVisible,
    chords,
    points: drag.preview?.fineGrid ? finePoints : points,
    active,
    railScoreY,
    playhead,
    theme,
    scale,
    viewport,
    headerRight: header.right,
    dragPreview: drag.preview,
  });

  const replacement = drag.preview?.target ? pointChord(chords, drag.preview.target) : undefined;
  const dragStatus: CSSProperties = {
    left: Math.max(header.right, 8),
    top: Math.max(safeAreaTop, Math.min(railY + LANE_HEIGHT * laneZoom + 4, size.height - bottomInset - 28)),
  };

  return (
    <div ref={root} className={styles.root} role="group" aria-label="Concert-pitch chord track">
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      {laneVisible && <div className={styles.surface} style={surfaceStyle} data-pinned={pinned} aria-hidden="true" />}
      <ChordTrackSettingsTrigger
        system={system}
        viewport={viewport}
        visible={laneVisible}
        railY={railY}
        scale={laneZoom}
        leftInset={safeAreaLeft}
      />
      {laneVisible &&
        points.map((point) => {
          const index = allPoints.indexOf(point);
          const previous = allPoints[index - 1];
          const next = allPoints[index + 1];
          const left = previous ? (previous.x + point.x) / 2 : point.x - 8;
          const right = next ? (next.x + point.x) / 2 : point.x + 24;
          const chord = pointChord(chords, point);
          const hitStyle: CSSProperties = {
            left: Math.max(header.right, scoreX(left)),
            top: railY + 47 * laneZoom,
            width: Math.max(0, scoreX(right) - Math.max(header.right, scoreX(left))),
            height: 29 * laneZoom,
          };
          return (
            <Button
              key={`${point.measureIndex}:${point.beat}`}
              className={styles.hit}
              style={hitStyle}
              data-track-measure={point.measureIndex}
              data-track-beat={point.beat}
              ariaLabel={`Bar ${point.measureIndex + 1}, quarter beat ${point.beat + 1}${chord ? `, ${formatChordSymbolText(chord.symbol)}` : ", add chord"}`}
              onPointerDown={(event) => (chord ? drag.start(event, chord) : event.stopPropagation())}
              onPointerEnter={() => setHover(point)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(point)}
              onBlur={() => setHover(null)}
              onKeyDown={(event) => keyDown(event, point, chord !== undefined)}
              onClick={(event) => {
                if (drag.consumeClick() || event.detail > 1) return;
                if (chord) editing.select(point);
                else editing.open(point, event.currentTarget.getBoundingClientRect());
              }}
              onDoubleClick={(event) => {
                if (chord) editing.open(point, event.currentTarget.getBoundingClientRect());
              }}
            />
          );
        })}
      {laneVisible &&
        visibleChords.map(({ chord, point, width }) => {
          const label = formatChordSymbolText(chord.symbol);
          const resolution = resolveChordSymbol(chord.symbol);
          const chordStyle: CSSProperties = {
            left: Math.max(header.right, scoreX(point.x)),
            top: railY + 20 * laneZoom,
            maxWidth: Math.max(0, scoreX(point.x + width) - Math.max(header.right, scoreX(point.x))),
            fontSize: 22 * laneZoom,
          };
          return (
            <Button
              key={chord.elementId}
              label={label}
              tooltip={resolution.status === "unsupported" ? `${label}: ${resolution.message}` : label}
              className={`${styles.hit} ${styles.chord} ${drag.preview ? styles.dragging : ""}`}
              style={chordStyle}
              ariaLabel={`Chord ${label}, bar ${point.measureIndex + 1}, concert pitch`}
              onPointerDown={(event) => drag.start(event, chord)}
              onPointerEnter={() => setHover(point)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(point)}
              onBlur={() => setHover(null)}
              onKeyDown={(event) => keyDown(event, point, true)}
              onClick={(event) => {
                if (!drag.consumeClick() && event.detail <= 1) editing.select(point);
              }}
              onDoubleClick={(event) => editing.open(point, event.currentTarget.getBoundingClientRect())}
            />
          );
        })}
      {drag.preview && (
        <div className={styles.dragStatus} style={dragStatus} role="status">
          {drag.preview.valid && drag.preview.target
            ? `Move to bar ${drag.preview.target.measureIndex + 1}, beat ${drag.preview.target.beat + 1}${replacement && replacement.symbol !== drag.preview.source.symbol ? `; replaces ${formatChordSymbolText(replacement.symbol)}` : ""}`
            : "Drop inside the chord track to move"}
        </div>
      )}
      <ChordEntryPopover editing={editing} onClose={close} onNavigate={navigate} />
    </div>
  );
}
