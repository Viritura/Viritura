import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { InputSurface } from "@viritura/ui";
import type { TextContent, TextRunStyle } from "@viritura/core";
import {
  glyphCharacter,
  htmlForTextContent,
  styleAtNode,
  styledTextContent,
  textContentFromEditor,
} from "./textContentEditorModel";
import {
  firstTextNode,
  insertGlyphChip,
  rangeAtEnd,
  rangeForOffsets,
  rangeForWholeContent,
  selectRange,
  styleProbeNode,
  textOffsetsOf,
} from "./textContentEditorDom";
import { TextContentEditorToolbar } from "./TextContentEditorToolbar";
import { TextContentGlyphPicker } from "./TextContentGlyphPicker";
import styles from "./TextContentEditor.module.css";

interface TextContentEditorProps {
  value: TextContent;
  onChange: (value: TextContent) => void;
  placeholder: string;
  ariaLabel?: string;
  onBlur?: () => void;
}

export function TextContentEditor({
  value,
  onChange,
  placeholder,
  ariaLabel = "Formatted score text",
  onBlur,
}: TextContentEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const renderedValue = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [activeStyle, setActiveStyle] = useState<TextRunStyle>({});
  const [glyphQuery, setGlyphQuery] = useState("");
  const serialized = JSON.stringify(value);

  const refreshActiveStyle = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const probe = range && editor.contains(range.commonAncestorContainer) ? styleProbeNode(range) : null;
    setActiveStyle(styleAtNode(probe ?? firstTextNode(editor), editor));
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && !focused && serialized !== renderedValue.current) {
      editor.innerHTML = htmlForTextContent(value);
      renderedValue.current = serialized;
      refreshActiveStyle();
    }
  }, [focused, refreshActiveStyle, serialized, value]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    }
    refreshActiveStyle();
  };

  const restoreSelection = (): Range | null => {
    const editor = editorRef.current;
    const range = savedRange.current;
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) return null;
    selectRange(range);
    return range;
  };

  /** Formatting acts on the selection, or on the whole field when nothing is selected. */
  const styleTargetRange = (): Range | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const restored = restoreSelection();
    if (restored && !restored.collapsed) return restored;
    const whole = rangeForWholeContent(editor);
    selectRange(whole);
    savedRange.current = whole.cloneRange();
    return whole.collapsed ? null : whole;
  };

  const commitEditor = () => {
    const editor = editorRef.current;
    if (editor) {
      const next = textContentFromEditor(editor);
      renderedValue.current = JSON.stringify(next);
      onChange(next);
    }
    rememberSelection();
  };

  /**
   * Formatting is computed on the model and the field is re-rendered from it,
   * so runs stay flat and clearing a key is never shadowed by an enclosing run.
   */
  const applyStyle = (style: Partial<TextRunStyle>) => {
    const editor = editorRef.current;
    const target = styleTargetRange();
    if (!editor || !target) return;
    const [start, end] = textOffsetsOf(editor, target);
    const next = styledTextContent(textContentFromEditor(editor), start, end, style);

    editor.innerHTML = htmlForTextContent(next);
    const restored = rangeForOffsets(editor, start, end);
    selectRange(restored);
    savedRange.current = restored.cloneRange();
    renderedValue.current = JSON.stringify(next);
    onChange(next);
    refreshActiveStyle();
  };

  const toggleInlineStyle = (command: "bold" | "italic" | "underline") => {
    if (command === "bold") applyStyle({ weight: activeStyle.weight === "bold" ? undefined : "bold" });
    else if (command === "italic") applyStyle({ fontStyle: activeStyle.fontStyle === "italic" ? undefined : "italic" });
    else applyStyle({ decoration: activeStyle.decoration === "underline" ? undefined : "underline" });
  };

  const insertGlyph = (name: string) => {
    const editor = editorRef.current;
    const character = glyphCharacter(name);
    if (!editor || character === undefined) return;
    const range = restoreSelection() ?? rangeAtEnd(editor);
    insertGlyphChip(range, name, character, styles.glyph ?? "");
    selectRange(range);
    savedRange.current = range.cloneRange();
    commitEditor();
    setGlyphQuery("");
    editor.focus();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      toggleInlineStyle("bold");
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
      event.preventDefault();
      toggleInlineStyle("italic");
    } else if (event.key === "Enter") {
      event.preventDefault();
    }
  };

  return (
    <div className={styles.root}>
      <TextContentEditorToolbar
        activeStyle={activeStyle}
        onToggleInlineStyle={toggleInlineStyle}
        onApplyStyle={applyStyle}
        onRememberSelection={rememberSelection}
      />
      <InputSurface
        ref={editorRef}
        className={styles.editor}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="false"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          rememberSelection();
          setFocused(false);
          onBlur?.();
        }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onKeyDown={handleEditorKeyDown}
        onInput={commitEditor}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          commitEditor();
        }}
      />
      <TextContentGlyphPicker
        query={glyphQuery}
        onQueryChange={setGlyphQuery}
        onInsert={insertGlyph}
        onRememberSelection={rememberSelection}
      />
    </div>
  );
}
