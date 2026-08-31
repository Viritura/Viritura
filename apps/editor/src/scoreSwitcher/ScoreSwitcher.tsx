/**
 * ScoreSwitcher — "which score am I looking at", as header chrome.
 *
 * Score selection is *navigation*, not authoring, and every mode needs it.
 * It used to be welded into the Layouts panel's structural tree editor, which
 * meant Write, Engrave, and Publish each grew their own score list and
 * Play/Roll had none at all. Hoisting it into the header collapses those into
 * one control and gives every mode the same affordance.
 *
 * Structural editing (add/rename/delete a score, groups, brackets, staff
 * order) deliberately lives in Setup mode — see `docs/spec/setup-mode.md`.
 */
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, LayoutGrid } from "lucide-react";
import { Button, ListRow, SearchInput } from "@viritura/ui";
import { useDocumentStore } from "../store/DocumentContext";
import { buildScoreEntries, type ScoreEntry } from "./scoreEntries";
import styles from "./ScoreSwitcher.module.css";

const ICON_STYLE: CSSProperties = { flexShrink: 0, opacity: 0.7 };
const COACHMARK_DISMISSED_KEY = "viritura.scoreSwitcher.coachmark.v1";

function readCoachmarkDismissed(): boolean {
  try {
    return localStorage.getItem(COACHMARK_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCoachmarkDismissed(): void {
  try {
    localStorage.setItem(COACHMARK_DISMISSED_KEY, "1");
  } catch {
    // localStorage can be unavailable in private browsing and SSR.
  }
}

export interface ScoreSwitcherProps {
  readonly selectedScoreIndex: number;
  readonly onSelectScore: (index: number) => void;
  /**
   * Right-click a score row. Engrave uses this for "Page Setup…", which
   * previously hung off its own score-list panel. Modes that only navigate
   * omit it, and the rows then carry no context menu.
   */
  readonly onScoreContextMenu?: (event: React.MouseEvent, index: number) => void;
}

export function ScoreSwitcher({ selectedScoreIndex, onSelectScore, onScoreContextMenu }: ScoreSwitcherProps) {
  const score = useDocumentStore((s) => s.score);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coachmarkDismissed, setCoachmarkDismissed] = useState(readCoachmarkDismissed);

  const entries = useMemo(() => buildScoreEntries(score), [score]);
  const current = entries.find((e) => e.index === selectedScoreIndex);
  const dismissCoachmark = useCallback(() => {
    persistCoachmarkDismissed();
    setCoachmarkDismissed(true);
  }, []);

  // A 30-instrument orchestra yields ~30 part extracts, so the list is
  // grouped and searchable rather than flat.
  const { scores, parts } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (e: ScoreEntry) => !q || e.name.toLowerCase().includes(q);
    return {
      scores: entries.filter((e) => e.isScore && match(e)),
      parts: entries.filter((e) => !e.isScore && match(e)),
    };
  }, [entries, query]);

  if (entries.length === 0) return null;

  const select = (index: number) => {
    dismissCoachmark();
    onSelectScore(index);
    setOpen(false);
    setQuery("");
  };

  const renderGroup = (label: string, group: ScoreEntry[]) =>
    group.length === 0 ? null : (
      <div className={styles.group}>
        <div className={styles.groupLabel}>{label}</div>
        {group.map((e) => (
          <ListRow
            key={e.index}
            density="compact"
            onClick={() => select(e.index)}
            trailing={e.index === selectedScoreIndex ? <Check size={13} className={styles.check} /> : undefined}
            onContextMenu={
              onScoreContextMenu &&
              ((event: React.MouseEvent) => {
                onScoreContextMenu(event, e.index);
                setOpen(false);
              })
            }
          >
            {e.name}
          </ListRow>
        ))}
      </div>
    );

  const currentLabel = current?.name ?? "Score";
  const showCoachmark = entries.length > 1 && !coachmarkDismissed;

  return (
    <div className={styles.root}>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) dismissCoachmark();
          else setQuery("");
        }}
      >
        <Popover.Trigger asChild>
          {/* eslint-disable-next-line no-restricted-syntax -- header chrome: a labelled view-context combo box, not a generic action button. */}
          <button type="button" className={styles.trigger} aria-label={`Select score or part: ${currentLabel}`}>
            <LayoutGrid size={13} style={ICON_STYLE} aria-hidden="true" />
            <span className={styles.triggerLabel}>{currentLabel}</span>
            <ChevronDown size={13} style={ICON_STYLE} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={styles.popover} side="bottom" align="start" sideOffset={6} collisionPadding={12}>
            {entries.length > 8 && (
              <div className={styles.searchWrap}>
                <SearchInput value={query} onValueChange={setQuery} placeholder="Search scores…" size="sm" autoFocus />
              </div>
            )}
            <div className={styles.list}>
              {renderGroup("Scores", scores)}
              {renderGroup("Parts", parts)}
              {scores.length === 0 && parts.length === 0 && <div className={styles.empty}>No matching scores.</div>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {showCoachmark && (
        <div className={styles.coachmark} role="status">
          <strong>Scores and parts are separate views.</strong>
          <span>Switch what the canvas displays here.</span>
          <Button variant="ghost" size="sm" className={styles.coachmarkDismiss} onClick={dismissCoachmark}>
            Got it
          </Button>
        </div>
      )}
    </div>
  );
}
