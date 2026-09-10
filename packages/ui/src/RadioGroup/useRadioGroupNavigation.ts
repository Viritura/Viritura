import { useRef, type KeyboardEvent, type RefCallback } from "react";

interface RadioOption<T extends string> {
  readonly value: T;
}

export function radioNavigationIndex(key: string, currentIndex: number, optionCount: number): number | null {
  if (optionCount === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % optionCount;
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + optionCount) % optionCount;
    case "Home":
      return 0;
    case "End":
      return optionCount - 1;
    default:
      return null;
  }
}

export function selectedRadioIndex<T extends string>(options: readonly RadioOption<T>[], value: T): number {
  const selectedIndex = options.findIndex((option) => option.value === value);
  return selectedIndex >= 0 ? selectedIndex : 0;
}

export function useRadioGroupNavigation<T extends string>(
  options: readonly RadioOption<T>[],
  value: T,
  onChange: (value: T) => void,
  disabled: boolean,
) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = selectedRadioIndex(options, value);

  const optionRef =
    (index: number): RefCallback<HTMLButtonElement> =>
    (node) => {
      optionRefs.current[index] = node;
    };

  const optionTabIndex = (index: number): number => (disabled ? -1 : index === selectedIndex ? 0 : -1);

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number): void => {
    if (disabled) return;
    const nextIndex = radioNavigationIndex(event.key, currentIndex, options.length);
    if (nextIndex === null) return;
    const nextOption = options[nextIndex];
    if (!nextOption) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
    onChange(nextOption.value);
  };

  return { optionRef, optionTabIndex, onOptionKeyDown };
}
