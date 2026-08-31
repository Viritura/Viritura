import { useCallback, useState, type CSSProperties } from "react";
import type { Score, ScoreMetadata } from "@viritura/core";
import { FormField, FormInput } from "@viritura/ui";
import { useDocumentStore } from "../../store/DocumentContext";
import { produce } from "../../score/scoreClone";

const PROJECT_NO_SCORE_STYLE: CSSProperties = {
  padding: 16,
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
};
const PROJECT_ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
};
const PROJECT_LIST_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "12px 12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const PROJECT_HINT_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  lineHeight: 1.4,
  paddingTop: 4,
};

/** A single editable metadata field. */
interface MetaFieldDef {
  key: keyof ScoreMetadata;
  label: string;
  placeholder: string;
}

const META_FIELDS: readonly MetaFieldDef[] = [
  { key: "title", label: "Title", placeholder: "e.g. Symphony No. 5" },
  { key: "subtitle", label: "Subtitle", placeholder: "e.g. A Sea Symphony" },
  { key: "composer", label: "Composer", placeholder: "e.g. L. van Beethoven" },
  { key: "lyricist", label: "Lyricist", placeholder: "e.g. words by F. Schiller" },
  { key: "arranger", label: "Arranger", placeholder: "e.g. arr. J. Smith" },
  { key: "copyright", label: "Copyright", placeholder: "e.g. © 2026 Viritura" },
];

/**
 * Project mode — edits score-level bibliographic metadata stored in the
 * `_x.viritura.metadata` vendor dict (title, subtitle, composer, lyricist,
 * arranger, copyright). The engine renders title/subtitle/composer/lyricist/
 * arranger in the page title block; copyright is reserved for the page footer.
 */
export function ProjectMode() {
  const score = useDocumentStore((s) => s.score);
  const updateScore = useDocumentStore((s) => s.updateScore);

  if (!score) {
    return <div style={PROJECT_NO_SCORE_STYLE}>No score loaded.</div>;
  }

  return (
    <div style={PROJECT_ROOT_STYLE}>
      <div className="viritura-scroll" style={PROJECT_LIST_STYLE}>
        {META_FIELDS.map((field) => (
          <MetadataField
            key={field.key}
            score={score}
            field={field}
            value={score.metadata?.[field.key] ?? ""}
            updateScore={updateScore}
          />
        ))}
        <div style={PROJECT_HINT_STYLE}>
          Title, subtitle, composer, lyricist and arranger appear in the page title block. Copyright is reserved for the
          page footer.
        </div>
      </div>
    </div>
  );
}

interface MetadataFieldProps {
  score: Score;
  field: MetaFieldDef;
  value: string;
  updateScore: (score: Score) => void;
}

/** One labeled text input that commits its buffer to score.metadata on blur/Enter. */
function MetadataField({ score, field, value, updateScore }: MetadataFieldProps) {
  const [draft, setDraft] = useState(value);

  // Reset the local buffer when the underlying value changes from elsewhere
  // (undo/redo, document load), using the React 19 "compare prop during
  // render" pattern over an effect.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value);
  }

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    const current = score.metadata?.[field.key] ?? "";
    if (trimmed === current) return;
    const nextScore = produce(score, (draftScore) => {
      const metadata: ScoreMetadata = { ...draftScore.metadata };
      if (trimmed) {
        metadata[field.key] = trimmed;
      } else {
        delete metadata[field.key];
      }
      draftScore.metadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    });
    if (nextScore !== score) updateScore(nextScore);
  }, [draft, score, field.key, updateScore]);

  return (
    <FormField label={field.label}>
      <FormInput
        value={draft}
        placeholder={field.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </FormField>
  );
}
