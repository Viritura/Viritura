import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Trash2 } from "lucide-react";
import {
  plainTextContent,
  type Score,
  type TextFrame,
  type TextFramePageAnchor,
  type TextFrameWidth,
} from "@viritura/core";
import { Button, FormField, FormTextarea, IconButton, Select, type SelectOption } from "@viritura/ui";
import { CommitNumberField } from "./CommitNumberField";
import { describeTextFrameLocator, effectiveHorizontalAlignment, hasFormattedContent } from "./textFrameContext";
import { TEXT_FRAME_NUDGE, type TextFrameEditing } from "./useTextFrameEditing";
import styles from "./TextFrames.module.css";
import { TextPresentationFields } from "./TextPresentationFields";

const ANCHOR_OPTIONS: readonly SelectOption[] = [
  { value: "top-left", label: "Top left" },
  { value: "top", label: "Top" },
  { value: "top-right", label: "Top right" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom", label: "Bottom" },
  { value: "bottom-right", label: "Bottom right" },
];

const WIDTH_UNIT_OPTIONS: readonly SelectOption[] = [
  { value: "staffSpaces", label: "Staff spaces" },
  { value: "textColumnFraction", label: "% of text column" },
];

type Actions = Pick<TextFrameEditing, "setText" | "move" | "resize" | "setPresentation" | "reorder" | "remove">;

interface SectionProps {
  frame: TextFrame;
  actions: Actions;
}

function ContentField({ frame, actions }: SectionProps) {
  const committed = plainTextContent(frame.content);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== committed) actions.setText(frame.id, draft);
    setDraft(null);
  };
  const fieldId = `text-frame-${frame.id}-text`;
  return (
    <FormField
      label="Text"
      htmlFor={fieldId}
      message={
        hasFormattedContent(frame)
          ? "This frame has formatted runs; editing here replaces them with plain text."
          : "Line breaks you type are kept; wrapping to the frame width is automatic."
      }
    >
      <FormTextarea
        id={fieldId}
        rows={4}
        value={draft ?? committed}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
        }}
      />
    </FormField>
  );
}

function PositionFields({ frame, actions }: SectionProps) {
  const { anchor, offset } = frame.placement;
  const setOffset = (next: { x: number; y: number }) =>
    actions.setPresentation(frame.id, { placement: { anchor, offset: next } });
  const nudge = (x: number, y: number) => actions.move(frame.id, { x, y });
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>Position</p>
      <FormField label="Page anchor">
        <Select
          aria-label="Page anchor"
          value={anchor}
          options={ANCHOR_OPTIONS}
          onValueChange={(value) =>
            actions.setPresentation(frame.id, { placement: { anchor: value as TextFramePageAnchor, offset } })
          }
        />
      </FormField>
      <div className={styles.fieldRow}>
        <FormField label="Offset X (sp)" htmlFor={`text-frame-${frame.id}-x`}>
          <CommitNumberField
            id={`text-frame-${frame.id}-x`}
            value={offset.x}
            onCommit={(x) => setOffset({ x, y: offset.y })}
          />
        </FormField>
        <FormField label="Offset Y (sp)" htmlFor={`text-frame-${frame.id}-y`}>
          <CommitNumberField
            id={`text-frame-${frame.id}-y`}
            value={offset.y}
            onCommit={(y) => setOffset({ x: offset.x, y })}
          />
        </FormField>
      </div>
      <div className={styles.actions} role="group" aria-label="Move frame">
        <IconButton tooltip="Move left" onClick={() => nudge(-TEXT_FRAME_NUDGE, 0)}>
          <ArrowLeft size={14} />
        </IconButton>
        <IconButton tooltip="Move up" onClick={() => nudge(0, -TEXT_FRAME_NUDGE)}>
          <ArrowUp size={14} />
        </IconButton>
        <IconButton tooltip="Move down" onClick={() => nudge(0, TEXT_FRAME_NUDGE)}>
          <ArrowDown size={14} />
        </IconButton>
        <IconButton tooltip="Move right" onClick={() => nudge(TEXT_FRAME_NUDGE, 0)}>
          <ArrowRight size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function widthDisplayValue(width: TextFrameWidth): number {
  return width.unit === "staffSpaces" ? width.value : Math.round(width.value * 1000) / 10;
}

function SizeFields({ frame, actions }: SectionProps) {
  const { width } = frame;
  const onUnitChange = (unit: string) => {
    if (unit === width.unit) return;
    actions.resize(
      frame.id,
      unit === "staffSpaces" ? { unit: "staffSpaces", value: 20 } : { unit: "textColumnFraction", value: 0.5 },
    );
  };
  const onValue = (value: number) =>
    actions.resize(
      frame.id,
      width.unit === "staffSpaces"
        ? { unit: "staffSpaces", value }
        : { unit: "textColumnFraction", value: value / 100 },
    );
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>Size</p>
      <div className={styles.fieldRow}>
        <FormField label="Width" htmlFor={`text-frame-${frame.id}-width`}>
          <CommitNumberField
            id={`text-frame-${frame.id}-width`}
            value={widthDisplayValue(width)}
            step={width.unit === "staffSpaces" ? 1 : 5}
            min={width.unit === "staffSpaces" ? 1 : 5}
            max={width.unit === "staffSpaces" ? undefined : 100}
            onCommit={onValue}
          />
        </FormField>
        <FormField label="Width unit">
          <Select
            aria-label="Width unit"
            value={width.unit}
            options={WIDTH_UNIT_OPTIONS}
            onValueChange={onUnitChange}
          />
        </FormField>
      </div>
      <p className={styles.help}>Height grows with the wrapped text.</p>
    </div>
  );
}

function TextLayoutFields({ frame, actions }: SectionProps) {
  return (
    <TextPresentationFields
      id={`text-frame-${frame.id}`}
      value={frame}
      defaultAlignment={effectiveHorizontalAlignment(frame)}
      onChange={(value) => actions.setPresentation(frame.id, value)}
    />
  );
}

function LayerControls({ frame, actions, layer, layerCount }: SectionProps & { layer: number; layerCount: number }) {
  const atBack = layer === 0;
  const atFront = layer === layerCount - 1;
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>
        Layer {layer + 1} of {layerCount}
      </p>
      <div className={styles.actions}>
        <Button size="sm" disabled={atBack} onClick={() => actions.reorder(frame.id, "back")}>
          Send to back
        </Button>
        <Button size="sm" disabled={atBack} onClick={() => actions.reorder(frame.id, "backward")}>
          Send backward
        </Button>
        <Button size="sm" disabled={atFront} onClick={() => actions.reorder(frame.id, "forward")}>
          Bring forward
        </Button>
        <Button size="sm" disabled={atFront} onClick={() => actions.reorder(frame.id, "front")}>
          Bring to front
        </Button>
      </div>
    </div>
  );
}

interface TextFrameEditorProps {
  score: Score;
  frame: TextFrame;
  /** Zero-based paint layer (index in the score view's frame list). */
  layer: number;
  layerCount: number;
  actions: Actions;
}

function TextFrameEditor({ score, frame, layer, layerCount, actions }: TextFrameEditorProps) {
  return (
    <section className={styles.group} aria-label={`Text frame ${frame.id}`} data-testid="text-frame-editor">
      <p className={styles.help}>Located by: {describeTextFrameLocator(score, frame.locator)}</p>
      <ContentField key={frame.id} frame={frame} actions={actions} />
      <PositionFields frame={frame} actions={actions} />
      <SizeFields frame={frame} actions={actions} />
      <TextLayoutFields frame={frame} actions={actions} />
      <LayerControls frame={frame} actions={actions} layer={layer} layerCount={layerCount} />
      <Button variant="danger" size="sm" onClick={() => actions.remove(frame.id)}>
        <Trash2 size={14} aria-hidden="true" /> Delete frame
      </Button>
    </section>
  );
}

/** Editor for the currently selected frame of the active score view, if any. */
export function SelectedTextFrameEditor({ editing }: { editing: TextFrameEditing }) {
  const { score, frames, selectedFrame } = editing;
  if (!score || !selectedFrame) return null;
  return (
    <TextFrameEditor
      score={score}
      frame={selectedFrame}
      layer={frames.indexOf(selectedFrame)}
      layerCount={frames.length}
      actions={editing}
    />
  );
}
