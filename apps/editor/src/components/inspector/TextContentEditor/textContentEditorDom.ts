import { isEditorLineBreak, startsEditorLine } from "./textContentEditorModel";

/** Places a non-editable glyph chip at `range` and leaves the caret after it. */
export function insertGlyphChip(range: Range, glyphName: string, character: string, className: string): void {
  const chip = document.createElement("span");
  chip.className = className;
  chip.dataset.glyph = glyphName;
  chip.contentEditable = "false";
  chip.textContent = character;
  range.deleteContents();
  range.insertNode(chip);
  range.setStartAfter(chip);
  range.collapse(true);
}

export function selectRange(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function rangeForWholeContent(editor: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(editor);
  return range;
}

export function rangeAtEnd(editor: HTMLElement): Range {
  const range = rangeForWholeContent(editor);
  range.collapse(false);
  return range;
}

/** Fallback style probe when the caret is outside the field. */
export function firstTextNode(editor: HTMLElement): Node {
  return document.createTreeWalker(editor, NodeFilter.SHOW_TEXT).nextNode() ?? editor;
}

/** The node whose run style a range represents, resolving element boundaries. */
export function styleProbeNode(range: Range): Node {
  const { startContainer, startOffset } = range;
  if (startContainer instanceof HTMLElement) return startContainer.childNodes[startOffset] ?? startContainer;
  return startContainer;
}

function plainTextOffset(editor: HTMLElement, container: Node, offset: number): number {
  const probe = document.createRange();
  probe.setStart(editor, 0);
  probe.setEnd(container, offset);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLElement) {
      if (isEditorLineBreak(node, editor)) {
        const parent = node.parentNode!;
        const index = Array.from(parent.childNodes).indexOf(node);
        if (probe.comparePoint(parent, index + 1) <= 0) length++;
      } else if (startsEditorLine(node) && probe.comparePoint(node, 0) <= 0) {
        length++;
      }
    } else if (node instanceof Text) {
      if (probe.comparePoint(node, node.length) <= 0) length += node.length;
      else if (node === container) length += offset;
    }
  }
  return length;
}

/** Plain-text offsets of a range, stable across re-rendering the field markup. */
export function textOffsetsOf(editor: HTMLElement, range: Range): [number, number] {
  return [
    plainTextOffset(editor, range.startContainer, range.startOffset),
    plainTextOffset(editor, range.endContainer, range.endOffset),
  ];
}

function boundaryAt(editor: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let seen = 0;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLElement) {
      if (isEditorLineBreak(node, editor)) {
        const parent = node.parentNode!;
        const index = Array.from(parent.childNodes).indexOf(node);
        if (offset <= seen) return [parent, index];
        seen++;
        if (offset <= seen) return [parent, index + 1];
      } else if (startsEditorLine(node)) {
        seen++;
        if (offset <= seen) return [node, 0];
      }
      continue;
    }
    const text = node as Text;
    if (offset <= seen + text.data.length) return [text, offset - seen];
    seen += text.data.length;
    last = text;
  }
  return last ? [last, last.data.length] : [editor, 0];
}

export function rangeForOffsets(editor: HTMLElement, start: number, end: number): Range {
  const range = document.createRange();
  range.setStart(...boundaryAt(editor, start));
  range.setEnd(...boundaryAt(editor, end));
  return range;
}
