import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { formatChordSymbolText, parseChordSymbolText, resolveChordSymbol } from "@viritura/core";
import { Button, Panel, TextPopover, type TextPopoverNavigationCommand } from "@viritura/ui";
import {
  buildTrackPoints,
  buildTrackSystems,
  LANE_HEIGHT,
  pointChord,
  positionTrackChords,
  sameTrackPoint,
  ChordTrackSettings,
  ChordTrackSettingsButton,
  trackHeaderGeometry,
  useChordTrackDrag,
  trackLaneY,
} from "../ChordTrack";
import { moveTrackChordChanges } from "../../score/chordTrack";
import { laneTop, paintTrackSystem } from "./trackPainter";
import type { ChordTrackPrototypeProps, PrototypeChord, TrackPoint, TrackSystem } from "./types";
import styles from "./ChordTrackPrototype.module.css";
import { useTrackSurfaceViewport } from "./useTrackSurfaceViewport";

interface EditorTarget {
  point: TrackPoint;
  position: { x: number; y: number };
}

interface TrackShadowSurfaceProps {
  left: number;
  top: number;
  naturalTop: number;
  zoom: number;
}

function TrackShadowSurface({ left, top, naturalTop, zoom }: TrackShadowSurfaceProps) {
  const style: CSSProperties = {
    left,
    right: 0,
    top: top * zoom,
    height: LANE_HEIGHT * zoom,
    borderRadius: 8 * zoom,
  };
  return (
    <div className={styles.surface} style={style} data-pinned={Math.abs(top - naturalTop) > 1e-6} aria-hidden="true" />
  );
}

function PrototypeStatus() {
  return (
    <div className={styles.status} role="status">
      <span>Prototype only. Edits are local; nothing is saved or played.</span>
      <span>Click a tick to enter. Space: next bar. Semicolon: next beat. Enter: finish. Esc: cancel.</span>
      <span>Positions use quarter-note beats.</span>
    </div>
  );
}

interface PrototypeSettingsProps {
  viewMode: ChordTrackPrototypeProps["viewMode"];
  step: number;
  onStepChange: (step: number) => void;
  sticky: boolean;
  onStickyChange: (enabled: boolean) => void;
  position: "above" | "below";
  onPositionChange: (position: "above" | "below") => void;
  onCloseEntry: () => void;
}

function PrototypeChordSettings({
  viewMode,
  step,
  onStepChange,
  sticky,
  onStickyChange,
  position,
  onPositionChange,
  onCloseEntry,
}: PrototypeSettingsProps) {
  return (
    <ChordTrackSettings
      grid={step === 1 ? "quarter" : step === 0.5 ? "eighth" : "sixteenth"}
      onGridChange={(grid) => {
        onStepChange(grid === "quarter" ? 1 : grid === "eighth" ? 0.5 : 0.25);
        onCloseEntry();
      }}
      sticky={sticky}
      onStickyChange={
        viewMode === "horizon"
          ? (enabled) => {
              onStickyChange(enabled);
              onCloseEntry();
            }
          : undefined
      }
      position={position}
      onPositionChange={
        viewMode === "horizon"
          ? (next) => {
              onPositionChange(next);
              onCloseEntry();
            }
          : undefined
      }
    />
  );
}

interface SystemProps extends Pick<ChordTrackPrototypeProps, "displayList" | "viewMode"> {
  system: TrackSystem;
  chords: readonly PrototypeChord[];
  step: number;
  zoom: number;
  active: TrackPoint | null;
  onActive: (point: TrackPoint | null) => void;
  onEdit: (point: TrackPoint, rect: DOMRect) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  scrollX: number;
  viewportElement: RefObject<HTMLDivElement | null>;
  onMove: (source: PrototypeChord, target: TrackPoint) => void;
  onSelect: (point: TrackPoint) => void;
  onPanBy: (delta: number) => void;
  sticky: boolean;
  position: "above" | "below";
}

function TrackSystemSurface({
  system,
  chords,
  step,
  zoom,
  active,
  onActive,
  onEdit,
  displayList,
  viewMode,
  settingsOpen,
  onOpenSettings,
  scrollX,
  viewportElement,
  onMove,
  onSelect,
  onPanBy,
  sticky,
  position,
}: SystemProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const points = useMemo(() => buildTrackPoints(system, step, chords), [system, step, chords]);
  const finePoints = useMemo(() => buildTrackPoints(system, 0.25, chords), [system, chords]);
  const surfaceViewport = useTrackSurfaceViewport(root, viewportElement, zoom);
  const naturalTop = laneTop(system, viewMode, position);
  const top =
    (trackLaneY(
      naturalTop * zoom + surfaceViewport.offsetY,
      LANE_HEIGHT * zoom,
      surfaceViewport.height,
      sticky && viewMode === "horizon",
      8,
      8,
    ) -
      surfaceViewport.offsetY) /
    zoom;
  const header = trackHeaderGeometry(system.measures[0]!.x * zoom, zoom, true, scrollX);
  const drag = useChordTrackDrag({
    root,
    viewportElement,
    points,
    finePoints,
    viewport: { zoom, scrollX: 0, scrollY: 0 },
    railY: top * zoom,
    height: LANE_HEIGHT * zoom,
    minX: header.right,
    onMove,
    onPanBy,
    enabled: viewMode === "horizon",
  });
  const replacement = drag.preview?.target ? pointChord(chords, drag.preview.target) : undefined;
  const paintPoints = drag.preview?.fineGrid ? finePoints : points;
  const dragStatusStyle: CSSProperties = {
    left: header.right,
    top:
      surfaceViewport.height > 0
        ? Math.min((top + LANE_HEIGHT) * zoom, surfaceViewport.height - surfaceViewport.offsetY - 28)
        : (top + LANE_HEIGHT) * zoom,
  };
  const systemStyle: CSSProperties = { width: system.width * zoom };
  const canvasStyle: CSSProperties = {
    width: system.width * zoom,
    height: (system.musicHeight + LANE_HEIGHT + 24) * zoom,
  };
  useEffect(() => {
    if (canvas.current)
      paintTrackSystem({
        canvas: canvas.current,
        displayList,
        system,
        chords,
        points: paintPoints,
        active,
        zoom,
        viewMode,
        headerRight: header.right,
        dragPreview: drag.preview,
        railY: top,
        position,
      });
  }, [displayList, system, chords, paintPoints, active, zoom, viewMode, header.right, drag.preview, top, position]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[index + delta]?.focus();
  }

  function editKey(event: KeyboardEvent<HTMLButtonElement>, point: TrackPoint, existing: boolean, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === " " && existing) onSelect(point);
      else onEdit(point, event.currentTarget.getBoundingClientRect());
    } else moveFocus(event, index);
  }

  return (
    <div ref={root} className={styles.system} style={systemStyle}>
      <canvas ref={canvas} aria-hidden="true" style={canvasStyle} />
      <TrackShadowSurface left={header.left} top={top} naturalTop={naturalTop} zoom={zoom} />
      <ChordTrackSettingsButton
        firstBarX={system.measures[0]!.x * zoom}
        railY={top * zoom}
        scale={zoom}
        expanded={settingsOpen}
        onOpen={onOpenSettings}
        sticky
        leftInset={scrollX}
      />
      <div role="group" aria-label={`Chord track, system ${system.id + 1}`}>
        {points.map((point, index) => {
          const previous = points[index - 1];
          const next = points[index + 1];
          const left = previous ? (previous.x + point.x) / 2 : point.x - 8;
          const right = next ? (next.x + point.x) / 2 : point.x + 24;
          const chord = pointChord(chords, point);
          const label = `Bar ${point.measureIndex + 1}, beat ${point.beat + 1}${chord ? `, ${formatChordSymbolText(chord.symbol)}` : ", add chord"}`;
          const hitStyle: CSSProperties = {
            left: Math.max(header.right, left * zoom),
            top: (top + 47) * zoom,
            width: Math.max(0, right * zoom - Math.max(header.right, left * zoom)),
            height: 29 * zoom,
          };
          return (
            <Button
              key={`${point.measureIndex}:${point.beat}`}
              className={styles.hit}
              ariaLabel={label}
              data-track-x={point.x}
              data-measure={point.measureIndex}
              data-beat={point.beat}
              style={hitStyle}
              onPointerEnter={() => onActive(point)}
              onPointerLeave={() => onActive(null)}
              onFocus={() => onActive(point)}
              onBlur={() => onActive(null)}
              onKeyDown={(event) => editKey(event, point, chord !== undefined, index)}
              onPointerDown={(event) => {
                if (chord) drag.start(event, chord);
              }}
              onClick={(event) => {
                if (drag.consumeClick() || event.detail > 1) return;
                if (chord) onSelect(point);
                else onEdit(point, event.currentTarget.getBoundingClientRect());
              }}
              onDoubleClick={(event) => {
                if (chord) onEdit(point, event.currentTarget.getBoundingClientRect());
              }}
            />
          );
        })}
        {positionTrackChords(system, chords).map(({ chord, point, width }) => {
          const label = formatChordSymbolText(chord.symbol);
          const chordStyle: CSSProperties = {
            left: Math.max(header.right, point.x * zoom),
            top: (top + 20) * zoom,
            fontSize: 22 * zoom,
            maxWidth: Math.max(0, (point.x + width) * zoom - Math.max(header.right, point.x * zoom)),
          };
          return (
            <Button
              key={`chord:${point.measureIndex}:${point.beat}`}
              className={`${styles.hit} ${styles.chordHit}`}
              style={chordStyle}
              label={label}
              tooltip={label}
              ariaLabel={`Chord ${label}, bar ${point.measureIndex + 1}, beat ${point.beat + 1}`}
              onPointerEnter={() => onActive(point)}
              onPointerLeave={() => onActive(null)}
              onFocus={() => onActive(point)}
              onBlur={() => onActive(null)}
              onKeyDown={(event) =>
                editKey(
                  event,
                  point,
                  true,
                  points.findIndex((candidate) => sameTrackPoint(candidate, point)),
                )
              }
              onPointerDown={(event) => drag.start(event, chord)}
              onClick={(event) => {
                if (!drag.consumeClick() && event.detail <= 1) onSelect(point);
              }}
              onDoubleClick={(event) => onEdit(point, event.currentTarget.getBoundingClientRect())}
            />
          );
        })}
      </div>
      {drag.preview && (
        <p role="status" className={styles.dragStatus} style={dragStatusStyle}>
          {drag.preview.valid && drag.preview.target
            ? `Move to bar ${drag.preview.target.measureIndex + 1}, beat ${drag.preview.target.beat + 1}${replacement && replacement.symbol !== drag.preview.source.symbol ? `; replaces ${formatChordSymbolText(replacement.symbol)}` : ""}`
            : "Drop inside the chord track to move"}
        </p>
      )}
    </div>
  );
}

export function ChordTrackPrototype({ displayList, initialChords, viewMode }: ChordTrackPrototypeProps) {
  const root = useRef<HTMLElement>(null);
  const [chords, setChords] = useState<readonly PrototypeChord[]>(initialChords);
  const [zoom, setZoom] = useState(0.75);
  const [step, setStep] = useState(1);
  const [active, setActive] = useState<TrackPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<TrackPoint | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sticky, setSticky] = useState(true);
  const [position, setPosition] = useState<"above" | "below">("below");
  const [scrollX, setScrollX] = useState(0);
  const viewportElement = useRef<HTMLDivElement>(null);
  const systems = useMemo(() => buildTrackSystems(displayList), [displayList]);
  const allPoints = useMemo(
    () => systems.flatMap((system) => buildTrackPoints(system, step, chords)),
    [systems, step, chords],
  );
  const selected = editor ? pointChord(chords, editor.point) : undefined;
  const highlighted = active ?? selectedPoint;

  function commit(value: string) {
    if (!editor || !value.trim()) return;
    const point = editor.point;
    const symbol = parseChordSymbolText(value, { fraction: [Math.round(point.beat * 4), 16] });
    setChords((previous) =>
      [
        ...previous.filter((chord) => chord !== pointChord(previous, point)),
        { measureIndex: point.measureIndex, symbol },
      ].sort(
        (a, b) =>
          a.measureIndex - b.measureIndex ||
          a.symbol.position.fraction[0] / a.symbol.position.fraction[1] -
            b.symbol.position.fraction[0] / b.symbol.position.fraction[1],
      ),
    );
  }

  function navigate(value: string, command: TextPopoverNavigationCommand): boolean {
    if (!editor) return false;
    commit(value);
    const backwards = command === "previous" || command === "previousBeat" || command === "previousMeasure";
    const candidates = backwards ? [...allPoints].reverse() : allPoints;
    const index = candidates.findIndex((point) => sameTrackPoint(point, editor.point));
    const next = candidates.slice(index + 1).find((point) => {
      if (command === "nextMeasure" || command === "previousMeasure") {
        return point.measureIndex !== editor.point.measureIndex && point.beat === 0;
      }
      if (command === "nextBeat" || command === "previousBeat") return Number.isInteger(point.beat);
      return true;
    });
    if (!next) {
      setEditor(null);
      return true;
    }
    const button = root.current?.querySelector<HTMLButtonElement>(
      `[data-measure="${next.measureIndex}"][data-beat="${next.beat}"]`,
    );
    if (button) {
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
      const rect = button.getBoundingClientRect();
      setEditor({ point: next, position: { x: rect.x + rect.width / 2, y: rect.bottom + 8 } });
      setActive(next);
    }
    return true;
  }

  function repositionEditor() {
    if (!editor) return;
    const button = root.current?.querySelector<HTMLButtonElement>(
      `[data-measure="${editor.point.measureIndex}"][data-beat="${editor.point.beat}"]`,
    );
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setEditor({ ...editor, position: { x: rect.x + rect.width / 2, y: rect.bottom + 8 } });
  }

  return (
    <section ref={root} className={styles.prototype} aria-label="Chord track prototype">
      <div className={styles.toolbar}>
        <strong>Chord track</strong>
        <Button
          label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => {
            setZoom(Math.max(0.5, zoom - 0.25));
            setEditor(null);
          }}
        />
        <span>{Math.round(zoom * 100)}%</span>
        <Button
          label="Zoom in"
          disabled={zoom >= 1.5}
          onClick={() => {
            setZoom(Math.min(1.5, zoom + 0.25));
            setEditor(null);
          }}
        />
        <Button
          label="Reset mock chords"
          onClick={() => {
            setChords(initialChords);
            setEditor(null);
          }}
        />
        <span className={styles.hint}>Canvas ink + React hit targets and editor</span>
      </div>
      <div className={styles.content}>
        <div
          ref={viewportElement}
          className={styles.viewport}
          onScroll={(event) => {
            setScrollX(event.currentTarget.scrollLeft);
            requestAnimationFrame(repositionEditor);
          }}
        >
          <div className={`${styles.paper} ${viewMode === "horizon" ? styles.horizon : ""}`}>
            {systems.map((system) => (
              <TrackSystemSurface
                key={system.id}
                displayList={displayList}
                viewMode={viewMode}
                system={system}
                chords={chords}
                step={step}
                zoom={zoom}
                active={
                  highlighted && system.measures.some((measure) => measure.index === highlighted.measureIndex)
                    ? highlighted
                    : null
                }
                onActive={setActive}
                onEdit={(point, rect) =>
                  setEditor({ point, position: { x: rect.x + rect.width / 2, y: rect.bottom + 8 } })
                }
                settingsOpen={settingsOpen}
                onOpenSettings={() => setSettingsOpen(true)}
                scrollX={scrollX}
                viewportElement={viewportElement}
                onMove={(source, target) => {
                  setChords((previous) => moveTrackChordChanges(previous, source, target));
                  setSelectedPoint(target);
                }}
                onSelect={setSelectedPoint}
                onPanBy={(delta) => {
                  if (viewportElement.current) viewportElement.current.scrollLeft += delta;
                }}
                sticky={sticky}
                position={position}
              />
            ))}
          </div>
        </div>
        {settingsOpen && (
          <Panel side="right" title="Chord settings" width={320} scrollBody onClose={() => setSettingsOpen(false)}>
            <PrototypeChordSettings
              viewMode={viewMode}
              step={step}
              onStepChange={setStep}
              sticky={sticky}
              onStickyChange={setSticky}
              position={position}
              onPositionChange={setPosition}
              onCloseEntry={() => setEditor(null)}
            />
          </Panel>
        )}
      </div>
      <PrototypeStatus />
      <TextPopover
        key={editor ? `${editor.point.measureIndex}:${editor.point.beat}` : "closed"}
        open={editor !== null}
        onClose={() => setEditor(null)}
        onSubmit={commit}
        onNavigate={navigate}
        spaceNavigation="measure"
        position={editor?.position ?? { x: 0, y: 0 }}
        title={editor ? `Chord · Bar ${editor.point.measureIndex + 1}, beat ${editor.point.beat + 1}` : "Chord"}
        placeholder="e.g. Cmaj7, Dm7, G7/B"
        initialValue={selected ? (selected.symbol.rawText ?? formatChordSymbolText(selected.symbol)) : ""}
        renderPreview={(value) => {
          if (!value.trim()) return null;
          const resolution = resolveChordSymbol(parseChordSymbolText(value, { fraction: [0, 1] }));
          return resolution.status === "unsupported" ? <p role="status">{resolution.message}</p> : null;
        }}
      >
        {selected && (
          <div className={styles.popoverActions}>
            <Button
              label="Remove chord"
              variant="danger"
              onClick={() => {
                setChords((previous) => previous.filter((chord) => chord !== selected));
                setEditor(null);
              }}
            />
          </div>
        )}
      </TextPopover>
    </section>
  );
}
