import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useDocument, useDocumentActions } from "../store/DocumentContext";
import { useSelection, useSelectedElementType } from "../store/selectionStore";
import { resolveNotationSelectionTarget } from "../commands/notationInspectorCommands";

import { LayoutSection } from "./inspector/LayoutSection";
import { TempoSection } from "./inspector/TempoSection";
import { DirectionTextSections } from "./inspector/DirectionTextSections";
import { TieSection, SlurSection } from "./inspector/TieSlurSections";
import { BarlineSection, TrillSection, AccidentalDisplaySection } from "./inspector/BarlineSections";
import { ColorSection } from "./inspector/ColorSection";
import { NoteheadSection } from "./inspector/NoteheadSection";
import { type InspectorSection } from "./inspector/notationInspectorMeta";
import { useInspectorAutoScroll, useTieSlurHandlers, useColorHandlers } from "./inspector/useNotationInspectorHooks";
import {
  useTempoHandlers,
  useBarlineHandlers,
  useAccidentalAndTrillHandlers,
  useNoteheadHandler,
} from "./inspector/useNotationInspectorActions";
import { useNotationInspectorSelection } from "./inspector/useNotationInspectorSelection";

import { PanelHeader } from "@viritura/ui";
import { MousePointer2 } from "lucide-react";

interface NotationInspectorProps {
  preferredSection?: InspectorSection | null;
}

function NotationInspectorEmptyState() {
  return (
    <aside style={panelStyle} data-testid="notation-inspector">
      <PanelHeader title="Notation Properties" />
      <div style={emptyStateStyle}>
        <MousePointer2 size={24} strokeWidth={1.5} aria-hidden="true" />
        <strong style={emptyTitleStyle}>No current selection</strong>
        <p style={emptyDescriptionStyle}>
          Select a note, marking, barline, or other score element to view and edit its notation details here.
        </p>
      </div>
    </aside>
  );
}

export function NotationInspector(_props: NotationInspectorProps = {}) {
  const selection = useSelection();
  const selectedElementType = useSelectedElementType();
  const { score } = useDocument();
  const { updateScore, commitPatches } = useDocumentActions();
  const [focusedSection, setFocusedSection] = useState<InspectorSection | null>(null);
  const tieSectionRef = useRef<HTMLFieldSetElement | null>(null);
  const slurSectionRef = useRef<HTMLFieldSetElement | null>(null);
  const layoutSectionRef = useRef<HTMLFieldSetElement | null>(null);

  const target = useMemo(() => {
    if (!score) return null;
    return resolveNotationSelectionTarget(selection, score);
  }, [selection, score]);

  const {
    selectedNote,
    selectedTie,
    selectedSlur,
    selectedTrill,
    selectedSequence,
    selectedContent,
    isTuplet,
    isEvent,
  } = useNotationInspectorSelection(selection, score, target);
  const isTrillSelected = selectedElementType === "trill";

  // Tempo selection data
  const {
    isTempoSelected,
    selectedTempo,
    handleTempoTextChange,
    handleTempoShowTextChange,
    handleTempoShowMetronomeChange,
    handleTempoBpmChange,
    handleTempoValueBaseChange,
    handleTempoDotsChange,
    handleTempoOffsetChange,
    handleTempoOffsetReset,
    handleTempoAvoidCollisionsChange,
  } = useTempoHandlers({ score, target, updateScore });

  // Barline selection data
  const isBarlineSelected = selectedElementType === "barline";
  const {
    currentBarlineType,
    hasRepeatStart,
    hasRepeatEnd,
    repeatEndTimes,
    handleBarlineTypeChange,
    handleToggleRepeatStart,
    handleToggleRepeatEnd,
    handleRepeatEndTimesChange,
  } = useBarlineHandlers({ score, target, updateScore }, isBarlineSelected);

  const measureDisabled = !target;

  const {
    handleAccidentalDisplayShow,
    handleCourtesyAccidental,
    handleAccidentalEnclosure,
    handleTrillAccidentalChange,
  } = useAccidentalAndTrillHandlers({ score, target, updateScore, commitPatches });

  const { notehead: selectedNotehead, handleNoteheadChange } = useNoteheadHandler({ score, target, updateScore });

  // ── Color handlers ──

  const { colorTarget, setColorTarget, colorInput, setColorInput, colorError, setColorError, applySelectedColor } =
    useColorHandlers({ score, selection, updateScore });

  useInspectorAutoScroll({
    preferredSection: _props.preferredSection,
    selectedElementType,
    tieSectionRef,
    slurSectionRef,
    layoutSectionRef,
    setFocusedSection,
  });

  const {
    tieError,
    slurError,
    handleTieTargetChange,
    handleTieTargetTypeChange,
    handleTieSideChange,
    handleTieLvChange,
    handleSlurTargetChange,
    handleSlurSideChange,
    handleSlurSideEndChange,
    handleSlurLineTypeChange,
    handleSlurStartNoteChange,
    handleSlurEndNoteChange,
  } = useTieSlurHandlers({ score, target, updateScore });

  if (!target) return <NotationInspectorEmptyState />;

  return (
    <aside style={panelStyle} data-testid="notation-inspector">
      <PanelHeader
        title="Notation Properties"
        subtitle={`Selected: ${selectedElementType ?? target.elementType} (${target.elementId})`}
      />
      <div className="viritura-scroll" style={bodyStyle}>
        {isTempoSelected && selectedTempo && (
          <TempoSection
            key={target.elementId}
            tempo={selectedTempo}
            onBpmChange={handleTempoBpmChange}
            onValueBaseChange={handleTempoValueBaseChange}
            onDotsChange={handleTempoDotsChange}
            onTextChange={handleTempoTextChange}
            onShowTextChange={handleTempoShowTextChange}
            onShowMetronomeChange={handleTempoShowMetronomeChange}
            offset={{
              value: selectedTempo.manualOffset ?? [0, 0],
              onChange: handleTempoOffsetChange,
              onReset: handleTempoOffsetReset,
              avoidCollisions: {
                value: selectedTempo.avoidCollisions ?? true,
                onChange: handleTempoAvoidCollisionsChange,
              },
            }}
          />
        )}

        <DirectionTextSections score={score} target={target} updateScore={updateScore} />

        {isBarlineSelected && (
          <BarlineSection
            focusedSection={focusedSection}
            currentBarlineType={currentBarlineType}
            hasRepeatEnd={hasRepeatEnd}
            hasRepeatStart={hasRepeatStart}
            repeatEndTimes={repeatEndTimes}
            onBarlineTypeChange={handleBarlineTypeChange}
            onToggleRepeatEnd={handleToggleRepeatEnd}
            onToggleRepeatStart={handleToggleRepeatStart}
            onRepeatEndTimesChange={handleRepeatEndTimesChange}
          />
        )}

        {selectedTie && (
          <TieSection
            tie={selectedTie}
            focusedSection={focusedSection}
            sectionRef={tieSectionRef}
            error={tieError}
            onTargetChange={handleTieTargetChange}
            onTargetTypeChange={handleTieTargetTypeChange}
            onSideChange={handleTieSideChange}
            onLvChange={handleTieLvChange}
          />
        )}

        {selectedSlur && (
          <SlurSection
            slur={selectedSlur}
            focusedSection={focusedSection}
            sectionRef={slurSectionRef}
            error={slurError}
            onTargetChange={handleSlurTargetChange}
            onSideChange={handleSlurSideChange}
            onSideEndChange={handleSlurSideEndChange}
            onLineTypeChange={handleSlurLineTypeChange}
            onStartNoteChange={handleSlurStartNoteChange}
            onEndNoteChange={handleSlurEndNoteChange}
          />
        )}

        {isTrillSelected && selectedTrill && (
          <TrillSection accidental={selectedTrill.accidental} onAccidentalChange={handleTrillAccidentalChange} />
        )}

        {(isTuplet || isEvent) && (
          <LayoutSection
            score={score}
            target={target}
            updateScore={updateScore}
            focusedSection={focusedSection}
            sectionRef={layoutSectionRef}
            selectedSequence={selectedSequence}
            selectedContent={selectedContent}
            isTuplet={isTuplet}
            isEvent={isEvent}
            disabled={measureDisabled}
          />
        )}

        {selectedNote && (
          <AccidentalDisplaySection
            note={selectedNote}
            onShowToggle={handleAccidentalDisplayShow}
            onCourtesyToggle={handleCourtesyAccidental}
            onEnclosureToggle={handleAccidentalEnclosure}
          />
        )}

        {isEvent && selectedNotehead !== null && (
          <NoteheadSection notehead={selectedNotehead} onNoteheadChange={handleNoteheadChange} />
        )}

        {target && (
          <ColorSection
            disabled={measureDisabled}
            colorTarget={colorTarget}
            colorInput={colorInput}
            colorError={colorError}
            onColorTargetChange={setColorTarget}
            onColorInputChange={(value) => {
              setColorInput(value);
              if (colorError) setColorError(null);
            }}
            onApplyColor={applySelectedColor}
          />
        )}
      </div>
    </aside>
  );
}

const panelStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  background: "transparent",
  display: "flex",
  flexDirection: "column",
  color: "var(--text)",
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: "12px 16px 16px",
  overflowY: "auto",
  overflowX: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};

const emptyStateStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  padding: "var(--space-5)",
  color: "var(--text-muted)",
  textAlign: "center",
};

const emptyTitleStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "var(--type-control-size)",
  fontWeight: "var(--type-heading-weight)",
};

const emptyDescriptionStyle: CSSProperties = {
  maxWidth: "28ch",
  margin: 0,
  fontSize: "var(--type-small-size)",
  lineHeight: 1.5,
};
