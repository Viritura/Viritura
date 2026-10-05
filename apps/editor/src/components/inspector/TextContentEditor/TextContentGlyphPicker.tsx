import { Button, SearchInput } from "@viritura/ui";
import { useState } from "react";
import { Music2 } from "lucide-react";
import { glyphCharacter, glyphNamesMatching } from "./textContentEditorModel";
import styles from "./TextContentEditor.module.css";

interface TextContentGlyphPickerProps {
  query: string;
  onQueryChange: (query: string) => void;
  onInsert: (glyphName: string) => void;
  onRememberSelection: () => void;
}

export function TextContentGlyphPicker({
  query,
  onQueryChange,
  onInsert,
  onRememberSelection,
}: TextContentGlyphPickerProps) {
  const [open, setOpen] = useState(false);
  const matches = glyphNamesMatching(query);
  return (
    <div className={styles.glyphRow}>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onMouseDown={onRememberSelection}
        onClick={() => setOpen(!open)}
      >
        <Music2 size={14} aria-hidden="true" /> Insert notation glyph
      </Button>
      {open && (
        <>
          <SearchInput
            value={query}
            size="sm"
            ariaLabel="Search SMuFL glyphs"
            placeholder="Search notation glyphs"
            onMouseDown={onRememberSelection}
            onValueChange={onQueryChange}
          />
          {query.length > 0 && (
            <div className={styles.glyphResults} role="listbox" aria-label="SMuFL glyph results">
              {matches.map((name) => (
                <Button
                  key={name}
                  variant="ghost"
                  size="sm"
                  fullWidth
                  role="option"
                  aria-selected="false"
                  ariaLabel={`${name} glyph`}
                  className={styles.glyphResult}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onInsert(name);
                    setOpen(false);
                  }}
                >
                  <span className={styles.glyphPreview} aria-hidden="true">
                    {glyphCharacter(name)}
                  </span>
                  {name}
                </Button>
              ))}
              {matches.length === 0 && <span className={styles.noGlyphs}>No matching glyphs</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
