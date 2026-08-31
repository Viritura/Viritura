/** Find first direct child element with the given tag name. */
export function findChild(el: Element, tag: string): Element | null {
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (child != null && child.nodeType === 1 && (child as Element).tagName === tag) {
      return child as Element;
    }
  }
  return null;
}

/** Find all direct child elements with the given tag name. */
export function findChildren(el: Element, tag: string): Element[] {
  const result: Element[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (child != null && child.nodeType === 1 && (child as Element).tagName === tag) {
      result.push(child as Element);
    }
  }
  return result;
}

/** Get all direct child elements (any tag). */
export function childElements(el: Element): Element[] {
  const result: Element[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (child != null && child.nodeType === 1) {
      result.push(child as Element);
    }
  }
  return result;
}

/**
 * Collect direct children matching `tag` across ALL `<notations>` blocks of a
 * `<note>`. MusicXML permits multiple sibling `<notations>` elements on a
 * single note (e.g. articulations in one block, a slur in another); reading
 * only the first via `findChild(note, "notations")` silently drops the rest.
 */
export function notationChildren(noteEl: Element, tag: string): Element[] {
  const result: Element[] = [];
  for (const notations of findChildren(noteEl, "notations")) {
    for (const child of findChildren(notations, tag)) result.push(child);
  }
  return result;
}

/** First child matching `tag` across all `<notations>` blocks of a note, or null. */
export function notationChild(noteEl: Element, tag: string): Element | null {
  for (const notations of findChildren(noteEl, "notations")) {
    const found = findChild(notations, tag);
    if (found) return found;
  }
  return null;
}

/** Get text content of the first child element matching the tag, or null. */
export function childText(el: Element, tag: string): string | null {
  const child = findChild(el, tag);
  return child?.textContent ?? null;
}
