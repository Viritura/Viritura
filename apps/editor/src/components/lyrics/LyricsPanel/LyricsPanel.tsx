import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { LyricLineMetadataEntry, Score } from "@viritura/core";
import { Button, Collapsible, FormField, FormInput, IconButton, Select } from "@viritura/ui";
import {
  createLyricInputState,
  getLyricLineDisplay,
  getLyricLineIds,
  getNextLyricLineId,
  isValidLanguageTag,
} from "../../../lyrics";
import { produce } from "../../../score/scoreClone";
import { useDocumentStore } from "../../../store/DocumentContext";
import { useOverlayStore } from "../../../store/overlayStore";
import { useSelection } from "../../../store/selectionStore";
import { toggleNoteInputMode, useNoteInputStore } from "../../../store/noteInputStore";
import styles from "./LyricsPanel.module.css";
import { LyricWorkflowControls } from "./LyricWorkflowControls";

type MetadataField = keyof LyricLineMetadataEntry;

function updateMetadata(score: Score, lineId: string, field: MetadataField, value: string): Score {
  return produce(score, (draft) => {
    draft.global.lyrics ??= {};
    draft.global.lyrics.lineMetadata ??= {};
    const entry = { ...draft.global.lyrics.lineMetadata[lineId] };
    if (value) entry[field] = value;
    else delete entry[field];
    if (Object.keys(entry).length > 0) draft.global.lyrics.lineMetadata[lineId] = entry;
    else delete draft.global.lyrics.lineMetadata[lineId];
    if (Object.keys(draft.global.lyrics.lineMetadata).length === 0) delete draft.global.lyrics.lineMetadata;
  });
}

interface MetadataInputProps {
  readonly lineId: string;
  readonly field: MetadataField;
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly score: Score;
  readonly updateScore: (score: Score) => void;
  readonly ariaLabel: string;
}

function MetadataInput({
  lineId,
  field,
  label,
  value,
  placeholder,
  score,
  updateScore,
  ariaLabel,
}: MetadataInputProps) {
  const [draft, setDraft] = useState(value);
  const errorId = useId();
  const candidate = draft.trim();
  const invalid = field === "lang" && candidate !== "" && !isValidLanguageTag(candidate);

  const commit = useCallback(() => {
    if (invalid || candidate === value) return;
    updateScore(updateMetadata(score, lineId, field, candidate));
  }, [candidate, field, invalid, lineId, score, updateScore, value]);

  return (
    <FormField label={label}>
      <FormInput
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        autoCapitalize={field === "lang" ? "none" : undefined}
        spellCheck={field !== "lang"}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!invalid) event.currentTarget.blur();
          }
        }}
      />
      {invalid && (
        <span id={errorId} className={styles.error} role="alert">
          Enter a valid BCP 47 language tag, such as en-GB.
        </span>
      )}
    </FormField>
  );
}

interface LyricsPanelProps {
  readonly embedded?: boolean;
}

/** Lyric entry and score-level lyric-line controls for the Write palettes. */
export function LyricsPanel({ embedded = false }: LyricsPanelProps) {
  const score = useDocumentStore((state) => state.score);
  const updateScore = useDocumentStore((state) => state.updateScore);
  const selection = useSelection();
  const noteInputActive = useNoteInputStore((state) => state.active);
  const { lyricMode, lyricState, activeLyricLineId, setLyricMode, setLyricState, setActiveLyricLineId } =
    useOverlayStore();
  const [status, setStatus] = useState("");
  const lineIds = useMemo(() => (score ? getLyricLineIds(score) : []), [score]);
  const activeMetadata = score?.global.lyrics?.lineMetadata?.[activeLyricLineId];
  const activeLineIndex = lineIds.indexOf(activeLyricLineId);

  useEffect(() => {
    if (lineIds.length > 0 && !lineIds.includes(activeLyricLineId)) setActiveLyricLineId(lineIds[0]!);
  }, [activeLyricLineId, lineIds, setActiveLyricLineId]);

  const selectLine = useCallback(
    (lineId: string) => {
      setActiveLyricLineId(lineId);
      if (lyricState) setLyricState({ ...lyricState, lineId });
    },
    [lyricState, setActiveLyricLineId, setLyricState],
  );

  const startEntry = useCallback(() => {
    if (!score) return;
    if (lyricMode) {
      setLyricMode(false);
      setLyricState(null);
      setStatus("Lyric entry stopped.");
      return;
    }
    const next = createLyricInputState(score, selection, activeLyricLineId);
    if (!next) {
      setStatus("Select a note or chord in the score before starting lyric entry.");
      return;
    }
    if (noteInputActive) toggleNoteInputMode();
    setLyricState(next);
    setLyricMode(true);
    setStatus(`Entering ${getLyricLineDisplay(score, activeLyricLineId)}.`);
  }, [activeLyricLineId, lyricMode, noteInputActive, score, selection, setLyricMode, setLyricState]);

  const moveLine = useCallback(
    (index: number, direction: -1 | 1) => {
      if (!score) return;
      const target = index + direction;
      if (target < 0 || target >= lineIds.length) return;
      const nextOrder = [...lineIds];
      [nextOrder[index], nextOrder[target]] = [nextOrder[target]!, nextOrder[index]!];
      updateScore(
        produce(score, (draft) => {
          draft.global.lyrics ??= {};
          draft.global.lyrics.lineOrder = nextOrder;
        }),
      );
    },
    [lineIds, score, updateScore],
  );

  const addLine = useCallback(() => {
    if (!score) return;
    const lineId = getNextLyricLineId(score);
    updateScore(
      produce(score, (draft) => {
        draft.global.lyrics ??= {};
        draft.global.lyrics.lineOrder = [...lineIds, lineId];
      }),
    );
    selectLine(lineId);
  }, [lineIds, score, selectLine, updateScore]);

  if (!score) return <p className={styles.status}>Open a score to work with lyrics.</p>;

  return (
    <section className={`${embedded ? styles.embeddedRoot : `viritura-scroll ${styles.root}`}`} aria-label="Lyrics">
      <div className={styles.header}>
        <div>{embedded ? <h3 className={styles.lineTitle}>Lyrics</h3> : <h2 className={styles.title}>Lyrics</h2>}</div>
        <Button
          onClick={startEntry}
          active={lyricMode}
          ariaLabel={lyricMode ? "Stop lyric entry" : "Start lyric entry"}
        >
          {lyricMode ? "Stop entry" : "Start entry"}
        </Button>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {status || (lyricMode ? `Entering ${getLyricLineDisplay(score, activeLyricLineId)}.` : "Lyric entry is off.")}
      </p>

      <div className={styles.activeLineField}>
        <span id="active-lyric-line-label" className={styles.fieldLabel}>
          Active line
        </span>
        <div className={styles.selectRow}>
          <Select
            value={activeLyricLineId}
            onValueChange={selectLine}
            aria-labelledby="active-lyric-line-label"
            options={lineIds.map((lineId) => {
              const language = score.global.lyrics?.lineMetadata?.[lineId]?.lang;
              return {
                value: lineId,
                label: `${getLyricLineDisplay(score, lineId)}${language ? ` · ${language}` : ""}`,
              };
            })}
          />
          <Button className={styles.addLineButton} onClick={addLine} ariaLabel="Add lyric line">
            <Plus size={14} aria-hidden="true" /> Add line
          </Button>
        </div>
      </div>

      <MetadataInput
        key={`label-${activeLyricLineId}-${activeMetadata?.label ?? ""}`}
        lineId={activeLyricLineId}
        field="label"
        label="Label"
        value={activeMetadata?.label ?? ""}
        placeholder={`Verse ${Math.max(0, activeLineIndex) + 1}`}
        score={score}
        updateScore={updateScore}
        ariaLabel="Active lyric line label"
      />
      <MetadataInput
        key={`lang-${activeLyricLineId}-${activeMetadata?.lang ?? ""}`}
        lineId={activeLyricLineId}
        field="lang"
        label="Language"
        value={activeMetadata?.lang ?? ""}
        placeholder="e.g. en-GB"
        score={score}
        updateScore={updateScore}
        ariaLabel="Active lyric line language"
      />

      <LyricWorkflowControls
        score={score}
        selection={selection}
        lineId={activeLyricLineId}
        lineLabel={getLyricLineDisplay(score, activeLyricLineId)}
        {...(activeMetadata?.lang && { language: activeMetadata.lang })}
        updateScore={updateScore}
        setStatus={setStatus}
      />

      <Collapsible title="Manage lines">
        <ol className={styles.manageList}>
          {lineIds.map((lineId, index) => {
            const display = getLyricLineDisplay(score, lineId);
            const language = score.global.lyrics?.lineMetadata?.[lineId]?.lang;
            return (
              <li key={lineId} className={styles.manageRow}>
                <Button
                  variant="ghost"
                  size="sm"
                  active={lineId === activeLyricLineId}
                  ariaLabel={`Use ${display} for lyric entry`}
                  onClick={() => selectLine(lineId)}
                >
                  {display}
                  {language ? <span className={styles.language}> · {language}</span> : null}
                </Button>
                <span className={styles.orderControls}>
                  <IconButton
                    size="sm"
                    tooltip={`Move ${display} up`}
                    disabled={index === 0}
                    onClick={() => moveLine(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    tooltip={`Move ${display} down`}
                    disabled={index === lineIds.length - 1}
                    onClick={() => moveLine(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      </Collapsible>
    </section>
  );
}
