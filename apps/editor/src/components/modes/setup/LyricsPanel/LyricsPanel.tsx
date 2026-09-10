import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { LyricLineMetadataEntry, Score } from "@viritura/core";
import { FormField, FormInput, IconButton } from "@viritura/ui";
import { getLyricLineIds, isValidLanguageTag } from "../../../../lyrics";
import { produce } from "../../../../score/scoreClone";
import { useDocumentStore } from "../../../../store/DocumentContext";
import styles from "./LyricsPanel.module.css";

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
    if (Object.keys(draft.global.lyrics.lineMetadata).length === 0) {
      delete draft.global.lyrics.lineMetadata;
    }
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
}

function MetadataInput({ lineId, field, label, value, placeholder, score, updateScore }: MetadataInputProps) {
  const [draft, setDraft] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  const candidate = draft.trim();
  const invalid = field === "lang" && candidate !== "" && !isValidLanguageTag(candidate);

  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(value);
  }

  const commit = useCallback(() => {
    if (invalid || candidate === value) return;
    updateScore(updateMetadata(score, lineId, field, candidate));
  }, [candidate, field, invalid, lineId, score, updateScore, value]);

  const errorId = `lyric-${field}-${lineId}-error`;
  return (
    <FormField label={label}>
      <FormInput
        value={draft}
        placeholder={placeholder}
        aria-label={`${label} for ${lineId}`}
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

/** Score-level lyric labels, languages, and explicit display order. */
export function LyricsPanel() {
  const score = useDocumentStore((state) => state.score);
  const updateScore = useDocumentStore((state) => state.updateScore);
  const lineIds = useMemo(() => (score ? getLyricLineIds(score) : []), [score]);

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

  if (!score) return <div className={styles.empty}>No score loaded.</div>;

  return (
    <div className={`viritura-scroll ${styles.root}`} aria-label="Lyrics settings">
      <p className={styles.intro}>Set the label, language, and display order for each lyric line.</p>
      {lineIds.length === 0 && <p className={styles.empty}>This score has no lyric lines.</p>}
      <ol className={styles.list}>
        {lineIds.map((lineId, index) => {
          const metadata = score.global.lyrics?.lineMetadata?.[lineId];
          const headingId = `lyric-line-${index}`;
          return (
            <li key={lineId} className={styles.line} aria-labelledby={headingId}>
              <div className={styles.heading}>
                <span id={headingId} className={styles.lineId}>
                  {lineId}
                </span>
                <span className={styles.orderControls}>
                  <IconButton
                    size="sm"
                    tooltip={`Move ${lineId} up`}
                    disabled={index === 0}
                    onClick={() => moveLine(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    tooltip={`Move ${lineId} down`}
                    disabled={index === lineIds.length - 1}
                    onClick={() => moveLine(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                </span>
              </div>
              <MetadataInput
                lineId={lineId}
                field="label"
                label="Label"
                value={metadata?.label ?? ""}
                placeholder={`Verse ${index + 1}`}
                score={score}
                updateScore={updateScore}
              />
              <MetadataInput
                lineId={lineId}
                field="lang"
                label="Language"
                value={metadata?.lang ?? ""}
                placeholder="e.g. en-GB"
                score={score}
                updateScore={updateScore}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
