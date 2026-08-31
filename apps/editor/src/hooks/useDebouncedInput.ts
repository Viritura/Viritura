import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Hook that provides local state for an input with debounced commit to score.
 * The input updates immediately (local state) while the expensive commit
 * (serialize → WASM layout → React re-render) only fires after typing pauses.
 *
 * @param externalValue - The current value from score state
 * @param onCommit - Called with the new value after the debounce delay
 * @param delay - Debounce delay in ms (default: 300)
 */
export function useDebouncedInput(
  externalValue: string,
  onCommit: (value: string) => void,
  delay = 300,
): {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  reset: () => void;
} {
  const [localValue, setLocalValue] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Sync from external when it changes (e.g. selection change, undo)
  // but only if we don't have a pending commit
  useEffect(() => {
    if (!timerRef.current) {
      setLocalValue(externalValue);
    }
  }, [externalValue]);

  const onChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commitRef.current(value);
      }, delay);
    },
    [delay],
  );

  const onBlur = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      commitRef.current(localValue);
    }
  }, [localValue]);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLocalValue(externalValue);
  }, [externalValue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { value: localValue, onChange, onBlur, reset };
}
