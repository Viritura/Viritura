import { childText, findChild, findChildren } from "../xmlHelpers";

export interface ScoreMetadata {
  title?: string;
  subtitle?: string;
  composer?: string;
  lyricist?: string;
  arranger?: string;
  workTitle?: string;
  workNumber?: string;
  movementTitle?: string;
  movementNumber?: string;
}

// eslint-disable-next-line complexity -- branchy metadata extraction over MusicXML credit/identification grammar
export function extractMetadata(root: Element): ScoreMetadata {
  const meta: ScoreMetadata = {};

  // Work info
  const work = findChild(root, "work");
  if (work) {
    meta.workTitle = childText(work, "work-title") ?? undefined;
    meta.workNumber = childText(work, "work-number") ?? undefined;
  }

  meta.movementTitle = childText(root, "movement-title") ?? undefined;
  meta.movementNumber = childText(root, "movement-number") ?? undefined;

  // Identification
  const ident = findChild(root, "identification");
  if (ident) {
    for (const creator of findChildren(ident, "creator")) {
      const type = creator.getAttribute("type");
      const text = creator.textContent ?? "";
      if (type === "composer") meta.composer = text;
      else if (type === "lyricist") meta.lyricist = text;
      else if (type === "arranger") meta.arranger = text;
    }
  }

  // Credits — first credit is usually title, second subtitle
  const credits = findChildren(root, "credit");
  for (const credit of credits) {
    const words = findChild(credit, "credit-words");
    if (!words) continue;
    const text = words.textContent ?? "";
    const justify = words.getAttribute("justify");
    const fontSize = parseFloat(words.getAttribute("font-size") ?? "0");
    if (!meta.title && fontSize >= 18 && justify === "center") {
      meta.title = text;
    } else if (meta.title && !meta.subtitle && fontSize >= 12 && fontSize < 18 && justify === "center") {
      meta.subtitle = text;
    }
  }

  // Fallback: use movement-title as title
  if (!meta.title) {
    meta.title = meta.movementTitle ?? meta.workTitle;
  }

  return meta;
}
