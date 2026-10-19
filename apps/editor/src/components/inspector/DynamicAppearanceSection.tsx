import { Button, Select } from "@viritura/ui";
import { DYNAMIC_SYMBOL_OPTIONS } from "./dynamicAppearance";
import { labelStyle } from "./types";

interface DynamicAppearanceSectionProps {
  glyphs: readonly string[] | undefined;
  onChange: (glyphs: string[] | undefined) => void;
}

export function DynamicAppearanceSection({ glyphs, onChange }: DynamicAppearanceSectionProps) {
  const move = (index: number, offset: number) => {
    const next = [...(glyphs ?? [])];
    const other = index + offset;
    const symbol = next[index];
    const neighbor = next[other];
    if (symbol === undefined || neighbor === undefined) return;
    next[index] = neighbor;
    next[other] = symbol;
    onChange(next);
  };

  return (
    <details>
      <summary>Appearance</summary>
      <p>Adjust the printed symbols without changing playback.</p>
      {glyphs === undefined && <p>Standard appearance</p>}
      {glyphs?.length === 0 && <p>No printed dynamic symbols</p>}
      {glyphs?.map((glyph, index) => {
        const options = DYNAMIC_SYMBOL_OPTIONS.some((option) => option.value === glyph)
          ? DYNAMIC_SYMBOL_OPTIONS
          : [{ value: glyph, label: "Imported symbol" }, ...DYNAMIC_SYMBOL_OPTIONS];
        return (
          <div key={index}>
            <label style={labelStyle}>
              Symbol {index + 1}
              <Select
                value={glyph}
                options={options}
                onValueChange={(value) => {
                  const next = [...glyphs];
                  next[index] = value;
                  onChange(next);
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move symbol ${index + 1} left`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              Move left
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move symbol ${index + 1} right`}
              disabled={index === glyphs.length - 1}
              onClick={() => move(index, 1)}
            >
              Move right
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove symbol ${index + 1}`}
              onClick={() => onChange(glyphs.filter((_, position) => position !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={() => onChange([...(glyphs ?? []), "dynamicForte"])}>
        Add symbol
      </Button>
      <Button size="sm" variant="ghost" disabled={glyphs === undefined} onClick={() => onChange(undefined)}>
        Reset appearance
      </Button>
    </details>
  );
}
