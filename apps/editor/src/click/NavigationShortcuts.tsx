import { useId, useMemo, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, FormInput } from "@viritura/ui";
import { adjacentClickLandmark, clickBarForNumber, isClickLandmark, type ClickBar } from "./barNavigation";
import styles from "./ClickView.module.css";

interface NavigationShortcutsProps {
  readonly bars: readonly ClickBar[];
  readonly index: number;
  readonly enabled: boolean;
  readonly onSelect: (index: number) => void;
}

function missingBarMessage(bars: readonly ClickBar[], number: number): string {
  return bars.some((bar) => bar.number === number)
    ? `Bar ${number} has no full-bar visit to start from.`
    : `There is no bar ${number}.`;
}

/** Previous/Next rehearsal and direct bar entry; each commits one start without moving the dials first. */
export function NavigationShortcuts({ bars, index, enabled, onSelect }: NavigationShortcutsProps) {
  const [entry, setEntry] = useState("");
  const [message, setMessage] = useState("");
  const inputId = useId();
  const messageId = useId();
  const hasLandmarks = useMemo(() => bars.some((bar) => bar.startable && isClickLandmark(bar)), [bars]);
  const previous = adjacentClickLandmark(bars, index, -1);
  const next = adjacentClickLandmark(bars, index, 1);

  function select(target: number | undefined): void {
    if (target === undefined) return;
    setMessage("");
    onSelect(target);
  }

  function goToBar(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = entry.trim();
    if (!/^\d+$/.test(text)) {
      setMessage("Enter a bar number.");
      return;
    }
    const number = Number(text);
    const target = clickBarForNumber(bars, number, index);
    if (target === undefined) {
      setMessage(missingBarMessage(bars, number));
      return;
    }
    setEntry("");
    select(target);
  }

  return (
    <div className={styles.shortcuts}>
      {hasLandmarks && (
        <Button
          variant="default"
          ariaLabel="Previous rehearsal"
          disabled={!enabled || previous === undefined}
          onClick={() => select(previous)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          Previous
        </Button>
      )}
      <form className={styles.goToBar} onSubmit={goToBar}>
        <label htmlFor={inputId}>Go to bar</label>
        <FormInput
          id={inputId}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          value={entry}
          disabled={!enabled}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => {
            setEntry(event.target.value);
            setMessage("");
          }}
        />
        <Button type="submit" variant="default" disabled={!enabled}>
          Go
        </Button>
      </form>
      {hasLandmarks && (
        <Button
          variant="default"
          ariaLabel="Next rehearsal"
          disabled={!enabled || next === undefined}
          onClick={() => select(next)}
        >
          Next
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      )}
      <p id={messageId} className={styles.shortcutMessage} role="status">
        {message}
      </p>
    </div>
  );
}
