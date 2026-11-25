/**
 * ProjectFileSwitcher: picks which `.mnx` file of the open project folder is
 * the active document. Sits left of the score/part switcher, because a file
 * contains scores and parts rather than the other way round.
 */
import { useMemo, useState, type CSSProperties } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, FileMusic } from "lucide-react";
import { ListRow, SearchInput, SelectTrigger } from "@viritura/ui";
import { useProjectStore } from "../store/projectStore";
import { useLiveSessionStore } from "../live/liveSessionStore";
import { useProjectFileSwitchStore } from "./projectFileSwitchStore";
import { isLiveSessionPinned } from "./switchProjectScore";
import styles from "./ProjectFileSwitcher.module.css";

const ICON_STYLE: CSSProperties = { flexShrink: 0, opacity: 0.7 };

export interface ProjectFileSwitcherProps {
  /** Lock the active file, e.g. while the click track is playing. */
  readonly disabled?: boolean;
  readonly className?: string;
}

export function ProjectFileSwitcher({ disabled, className }: ProjectFileSwitcherProps) {
  const scores = useProjectStore((s) => s.projectScores);
  const activeScorePath = useProjectStore((s) => s.activeScorePath);
  const switchTo = useProjectFileSwitchStore((s) => s.switchTo);
  const switching = useProjectFileSwitchStore((s) => s.switching);
  const livePinned = useLiveSessionStore((s) => isLiveSessionPinned(s.status));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? scores.filter((score) => score.relativePath.toLowerCase().includes(q)) : scores;
  }, [scores, query]);

  if (scores.length < 2 || !switchTo) return null;

  const current = scores.find((score) => score.relativePath === activeScorePath);
  const currentLabel = current?.name ?? "Project file";
  const locked = disabled || switching || livePinned;

  const select = (relativePath: string) => {
    setOpen(false);
    setQuery("");
    void switchTo(relativePath);
  };

  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void useProjectStore.getState().rescanProjectScores();
          else setQuery("");
        }}
      >
        <Popover.Trigger asChild>
          <SelectTrigger
            className={styles.trigger}
            disabled={locked}
            aria-busy={switching || undefined}
            title={livePinned ? "End the live session to switch project files" : undefined}
            leading={<FileMusic size={13} style={ICON_STYLE} aria-hidden="true" />}
            aria-label={`Select project file: ${currentLabel}`}
          >
            <span className={styles.triggerLabel}>{currentLabel}</span>
          </SelectTrigger>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={styles.popover} side="bottom" align="start" sideOffset={6} collisionPadding={12}>
            {scores.length > 8 && (
              <div className={styles.searchWrap}>
                <SearchInput value={query} onValueChange={setQuery} placeholder="Search files…" size="sm" autoFocus />
              </div>
            )}
            <div className={styles.list} role="listbox" aria-label="Project files">
              {visible.map((score) => {
                const selected = score.relativePath === activeScorePath;
                const folder = score.relativePath.slice(0, -score.name.length).replace(/\/$/, "");
                return (
                  <ListRow
                    key={score.relativePath}
                    role="option"
                    aria-selected={selected}
                    density="compact"
                    onClick={() => select(score.relativePath)}
                    trailing={selected ? <Check size={13} className={styles.check} /> : undefined}
                  >
                    <span className={styles.name}>{score.name}</span>
                    {folder && <span className={styles.folder}>{folder}</span>}
                  </ListRow>
                );
              })}
              {visible.length === 0 && <div className={styles.empty}>No matching files.</div>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
