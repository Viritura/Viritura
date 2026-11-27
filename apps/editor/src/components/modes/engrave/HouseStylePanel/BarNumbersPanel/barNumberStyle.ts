import {
  DEFAULT_TEXT_STYLES,
  type BarNumberSettings,
  type BarNumberTextStyle,
  type ResolvedTextStyle,
  type Score,
  type TextStyles,
} from "@viritura/core";

type BarNumberStyleField = keyof BarNumberTextStyle;

const LEGACY_FIELDS: readonly BarNumberStyleField[] = ["size", "family", "bold", "italic"];

function legacyStyle(settings: BarNumberSettings | undefined): BarNumberTextStyle {
  const style: BarNumberTextStyle = {};
  if (settings?.size !== undefined) style.size = settings.size;
  if (settings?.family !== undefined) style.family = settings.family;
  if (settings?.bold !== undefined) style.bold = settings.bold;
  if (settings?.italic !== undefined) style.italic = settings.italic;
  return style;
}

/** Resolve the shared role style, including legacy values and the selected view's sparse overrides. */
export function effectiveBarNumberStyle(
  score: Score,
  scoreIndex: number,
  scope: "document" | "layout",
): ResolvedTextStyle {
  const rootStyle = {
    ...DEFAULT_TEXT_STYLES.barNumber!,
    ...score.textStyles?.barNumber,
    ...legacyStyle(score.barNumbers),
    ...score.barNumbers?.style,
  };
  if (scope !== "layout") return rootStyle;
  const layoutSettings = score.scores?.[scoreIndex]?.barNumbers;
  return { ...rootStyle, ...legacyStyle(layoutSettings), ...layoutSettings?.style };
}

/** Update role typography at document or view scope, keeping stored overrides sparse. */
export function updateBarNumberStyle(
  score: Score,
  scoreIndex: number,
  scope: "document" | "layout",
  changes: Partial<BarNumberTextStyle>,
): Score {
  if (scope === "document") {
    const textStyles: TextStyles = { ...(score.textStyles ?? {}) };
    const style: BarNumberTextStyle = { ...(textStyles.barNumber ?? {}) };
    setDocumentField(style, changes, "size", DEFAULT_TEXT_STYLES.barNumber!.size);
    setDocumentField(style, changes, "family", DEFAULT_TEXT_STYLES.barNumber!.family);
    setDocumentField(style, changes, "bold", DEFAULT_TEXT_STYLES.barNumber!.bold);
    setDocumentField(style, changes, "italic", DEFAULT_TEXT_STYLES.barNumber!.italic);
    if (Object.keys(style).length) textStyles.barNumber = style;
    else delete textStyles.barNumber;

    const barNumbers = stripStyleField(score.barNumbers, changes);
    return {
      ...score,
      textStyles: Object.keys(textStyles).length ? textStyles : undefined,
      barNumbers,
    };
  }

  const view = score.scores?.[scoreIndex];
  if (!view) return score;
  const inherited = effectiveBarNumberStyle(score, scoreIndex, "document");
  const style: BarNumberTextStyle = { ...(view.barNumbers?.style ?? {}) };
  setLayoutField(style, changes, "size", inherited.size);
  setLayoutField(style, changes, "family", inherited.family);
  setLayoutField(style, changes, "bold", inherited.bold);
  setLayoutField(style, changes, "italic", inherited.italic);

  const existing = stripStyleField(view.barNumbers, changes);
  const barNumbers: BarNumberSettings = {
    ...(existing ?? {}),
    ...(Object.keys(style).length ? { style } : {}),
  };
  const scores = [...score.scores!];
  scores[scoreIndex] = { ...view, barNumbers: Object.keys(barNumbers).length ? barNumbers : undefined };
  return { ...score, scores };
}

function setDocumentField<F extends BarNumberStyleField>(
  style: BarNumberTextStyle,
  changes: Partial<BarNumberTextStyle>,
  field: F,
  defaultValue: BarNumberTextStyle[F],
) {
  const value = changes[field];
  if (value === undefined) return;
  if (value === defaultValue) delete style[field];
  else style[field] = value;
}

function setLayoutField<F extends BarNumberStyleField>(
  style: BarNumberTextStyle,
  changes: Partial<BarNumberTextStyle>,
  field: F,
  inheritedValue: BarNumberTextStyle[F],
) {
  const value = changes[field];
  if (value === undefined) return;
  if (value === inheritedValue) delete style[field];
  else style[field] = value;
}

function stripStyleField(
  settings: BarNumberSettings | undefined,
  changes: Partial<BarNumberTextStyle>,
): BarNumberSettings | undefined {
  if (!settings) return undefined;
  const next = { ...settings };
  const style = { ...(next.style ?? {}) };
  for (const field of LEGACY_FIELDS) {
    if (changes[field] === undefined) continue;
    delete next[field];
    delete style[field];
  }
  next.style = Object.keys(style).length ? style : undefined;
  return Object.keys(next).length ? next : undefined;
}
