import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useDocument, useDocumentActions } from "../store/DocumentContext";
import { useSelection, useSelectedElementType } from "../store/selectionStore";
import { resolveNotationSelectionTarget } from "../commands/notationInspectorCommands";

import { LayoutSection } from "./inspector/LayoutSection";
import { TempoSection } from "./inspector/TempoSection";
import { DirectionTextSections } from "./inspector/DirectionTextSections";
import { TieSection, SlurSection } from "./inspector/TieSlurSections";
import { BarlineSection, TrillSection, AccidentalDisplaySection } from "./inspector/BarlineSections";
import { MeasureRepeatInspector } from "./inspector/MeasureRepeatInspector";
import { ColorSection } from "./inspector/ColorSection";
import { NoteheadSection } from "./inspector/NoteheadSection";
import { FermataSection } from "./inspector/FermataSection";
import { RestPositionSection } from "./inspector/RestPositionSection";
import { LyricSection } from "./inspector/LyricSection";
import { type InspectorSection } from "./inspector/notationInspectorMeta";
import { useInspectorAutoScroll, useTieSlurHandlers, useColorHandlers } from "./inspector/useNotationInspectorHooks";
import {
  useTempoHandlers,
  useBarlineHandlers,
  useAccidentalAndTrillHandlers,
  useNoteheadHandler,
} from "./inspector/useNotationInspectorActions";
import { useNotationInspectorSelection } from "./inspector/useNotationInspectorSelection";
import { SelectedMarkingInspectors } from "./inspector/SelectedMarkingSections";
import { StaffConfigSection } from "./inspector/StaffConfigSection";
import { useStaffConfigInspector } from "./inspector/useStaffConfigInspector";
import { MAX_STAFF_LINES } from "../commands/staffConfigCommands";
import { useLyricInspector } from "./inspector/useLyricInspector";

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

// eslint-disable-next-line complexity, max-lines-per-function -- The inspector composes independent property sections whose visibility mirrors selection capabilities.
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
    selectedEvent,
    selectedNote,
    selectedTie,
    selectedSlur,
    selectedTrill,
    selectedSequence,
    selectedContent,
    isTuplet,
    isEvent,
  } = useNotationInspectorSelection(selection, score, target);

  const tempo = useTempoHandlers({ score, target, updateScore });
  const staffConfig = useStaffConfigInspector({ score, selection, commitPatches });
  const lyric = useLyricInspector({ score, selection, updateScore });
  const isLyricSelected = lyric.selected !== null;

  const {
    currentBarlineType,
    hasRepeatStart,
    hasRepeatEnd,
    repeatEndTimes,
    handleBarlineTypeChange,
    handleToggleRepeatStart,
    handleToggleRepeatEnd,
    handleRepeatEndTimesChange,
  } = useBarlineHandlers({ score, target, updateScore }, selectedElementType === "barline");

  const { handleAccidentalDisplayModeChange, handleAccidentalEnclosureChange, handleTrillAccidentalChange } =
    useAccidentalAndTrillHandlers({ score, target, updateScore, commitPatches });

  const { notehead: selectedNotehead, handleNoteheadChange } = useNoteheadHandler({ score, target, updateScore });
  const {
    selectionTarget: colorTarget,
    colorInput,
    setColorInput,
    colorError,
    setColorError,
    applySelectedColor,
  } = useColorHandlers({ score, target, updateScore });

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

  if (!target && !staffConfig.target) return <NotationInspectorEmptyState />;

  const selectionSubtitle = target
    ? `Selected: ${selectedElementType ?? target.elementType} (${target.elementId})`
    : staffConfig.target!.endMeasureIndex > staffConfig.target!.measureIndex
      ? `Selected: bars ${staffConfig.target!.measureIndex + 1}-${staffConfig.target!.endMeasureIndex + 1}, staff ${staffConfig.target!.staff}`
      : `Selected: bar ${staffConfig.target!.measureIndex + 1}, staff ${staffConfig.target!.staff}`;

  return (
    <aside style={panelStyle} data-testid="notation-inspector">
      <PanelHeader title="Notation Properties" subtitle={selectionSubtitle} />
      <div className="viritura-scroll" style={bodyStyle}>
        {target && tempo.isTempoSelected && tempo.selectedTempo && (
          <TempoSection
            key={target.elementId}
            tempo={tempo.selectedTempo}
            onBpmChange={tempo.handleTempoBpmChange}
            onValueBaseChange={tempo.handleTempoValueBaseChange}
            onDotsChange={tempo.handleTempoDotsChange}
            onTextChange={tempo.handleTempoTextChange}
            onShowTextChange={tempo.handleTempoShowTextChange}
            onShowMetronomeChange={tempo.handleTempoShowMetronomeChange}
            offset={{
              value: tempo.selectedTempo.manualOffset ?? [0, 0],
              onChange: tempo.handleTempoOffsetChange,
              onReset: tempo.handleTempoOffsetReset,
              avoidCollisions: {
                value: tempo.selectedTempo.avoidCollisions ?? true,
                onChange: tempo.handleTempoAvoidCollisionsChange,
              },
            }}
          />
        )}

        {target && <DirectionTextSections score={score} target={target} updateScore={updateScore} />}

        {lyric.selected && (
          <LyricSection
            key={`${target?.elementId}:${lyric.selected.line.text}`}
            text={lyric.selected.line.text}
            syllabicType={lyric.selected.line.type ?? "whole"}
            lineId={lyric.selected.lineId}
            lineOptions={lyric.lineOptions}
            onTextChange={lyric.handleTextChange}
            onSyllabicTypeChange={lyric.handleSyllabicTypeChange}
            onLineChange={lyric.handleLineChange}
          />
        )}

        {target && (
          <SelectedMarkingInspectors
            score={score}
            target={target}
            selectedElementType={selectedElementType}
            selectedEvent={selectedEvent}
            updateScore={updateScore}
          />
        )}

        {selectedElementType === "barline" && (
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

        {staffConfig.target && (
          <StaffConfigSection
            key={`${staffConfig.target.partId}:${staffConfig.target.measureIndex}:${staffConfig.target.endMeasureIndex}:${staffConfig.target.staff}:${staffConfig.lines}`}
            lines={staffConfig.lines}
            staff={staffConfig.target.staff}
            startMeasureNumber={staffConfig.target.measureIndex + 1}
            endMeasureNumber={staffConfig.target.endMeasureIndex + 1}
            maxLines={MAX_STAFF_LINES}
            origin={staffConfig.origin}
            hasChangesInSelection={staffConfig.hasChangesInSelection}
            onLinesChange={staffConfig.setLines}
            onClear={staffConfig.clear}
          />
        )}

        {target && (
          <MeasureRepeatInspector
            score={score}
            target={target}
            focusedSection={focusedSection}
            updateScore={updateScore}
          />
        )}

        {!isLyricSelected && selectedTie && (
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

        {!isLyricSelected && selectedSlur && (
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

        {selectedElementType === "trill" && selectedTrill && (
          <TrillSection accidental={selectedTrill.accidental} onAccidentalChange={handleTrillAccidentalChange} />
        )}

        {!isLyricSelected && target && <FermataSection />}
        {!isLyricSelected && target && (
          <RestPositionSection score={score} target={target} event={selectedEvent} updateScore={updateScore} />
        )}

        {!isLyricSelected && (isTuplet || isEvent) && (
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
            staffCount={score?.parts[target?.partIndex ?? -1]?.staves ?? 1}
            disabled={false}
          />
        )}

        {!isLyricSelected && selectedNote && (
          <AccidentalDisplaySection
            note={selectedNote}
            onModeChange={handleAccidentalDisplayModeChange}
            onEnclosureChange={handleAccidentalEnclosureChange}
          />
        )}

        {!isLyricSelected && isEvent && selectedNotehead !== null && (
          <NoteheadSection notehead={selectedNotehead} onNoteheadChange={handleNoteheadChange} />
        )}

        {colorTarget && (
          <ColorSection
            key={target?.elementId}
            disabled={false}
            targetLabel={colorTarget.label}
            colorInput={colorInput}
            colorError={colorError}
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
  gap: "var(--space-4)",
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
