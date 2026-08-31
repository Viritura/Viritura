import { useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  Dialog,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogCancelButton,
  DialogPrimaryButton,
  Section,
  FormField,
  FormInput,
  Select,
  ButtonGroup,
  Button,
  Checkbox,
} from "@viritura/ui";
import {
  type PageSetup,
  type PageTurnSettings,
  DEFAULT_PAGE_SETUP,
  RASTRAL_SPATIUM_MM,
  PAGE_SIZE_PRESETS,
} from "@viritura/core";
import css from "./PageSetupDialog.module.css";

const PAGE_SETUP_SPACER_STYLE: CSSProperties = { flex: 1 };
function previewPageStyle(w: number, h: number): CSSProperties {
  return { width: w, height: h };
}
function previewMarginsStyle(top: number, left: number, right: number, bottom: number): CSSProperties {
  return { top, left, right, bottom };
}
function previewStaffRowStyle(
  marginTop: number,
  pageH: number,
  marginBottom: number,
  marginLeft: number,
  marginRight: number,
  frac: number,
): CSSProperties {
  return {
    top: marginTop + (pageH - marginTop - marginBottom) * frac,
    left: marginLeft + 2,
    right: marginRight + 2,
  };
}
import {
  LAYOUT_PRESETS,
  findMatchingPreset,
  parseUnitValue,
  formatMm,
  RASTRAL_LABELS,
  PAGE_SIZE_NAMES,
  findPageSizeName,
  findRastralIndex,
  type LayoutPreset,
} from "./pageSetupHelpers";

// ─── UnitInput ─────────────────────────────────────────────────────

interface UnitInputProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  "aria-labelledby"?: string;
  /** Current value in mm */
  value: number;
  /** Called with the new value in mm */
  onChange: (mm: number) => void;
  /** Minimum allowed value in mm */
  min?: number;
  /** Maximum allowed value in mm */
  max?: number;
}

/**
 * A text input that accepts values with unit suffixes (mm, cm, in).
 * Shows the current mm value when not focused, allows free-text editing,
 * and converts on blur.
 */
function UnitInput({
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-labelledby": ariaLabelledBy,
  value,
  onChange,
  min = 0,
  max = 1000,
}: UnitInputProps) {
  const [text, setText] = useState(formatMm(value));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync display text when value changes externally (not while focused)
  useEffect(() => {
    if (!focused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setText(formatMm(value));
    }
  }, [value, focused]);

  const commit = useCallback(() => {
    const parsed = parseUnitValue(text);
    if (parsed !== null) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
      setText(formatMm(clamped));
    } else {
      // Revert to current value on invalid input
      setText(formatMm(value));
    }
  }, [text, value, onChange, min, max]);

  return (
    <FormInput
      ref={inputRef}
      id={id}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-labelledby={ariaLabelledBy}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        setFocused(true);
        // Select all text on focus for easy overwriting
        requestAnimationFrame(() => inputRef.current?.select());
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          inputRef.current?.blur();
        }
      }}
      className={css.unitInput}
    />
  );
}

// ─── Types ─────────────────────────────────────────────────────────

interface PageSetupDialogProps {
  open?: boolean;
  onClose?: () => void;
  onApply: (setup: PageSetup) => void;
  initialSetup: PageSetup;
  /** Render the editor directly in a panel instead of inside a modal dialog. */
  embedded?: boolean;
  /**
   * Optional name of the score/layout being formatted (e.g. "Violin I",
   * "Full Score"). Shown in the dialog title so the user knows what
   * they're editing. If omitted, the title is just "Page Setup".
   */
  scopeName?: string;
  /**
   * Optional callback for the "Reset to default" button. For per-score
   * dialogs this should clear the score's pageSetup override so it
   * falls back to the document default. If omitted, the button still
   * resets the form fields to DEFAULT_PAGE_SETUP but does not fire any
   * external action.
   */
  onResetToDefault?: () => void;
}

function EmbeddedPageSetup({
  children,
  onReset,
  onApply,
}: {
  children: React.ReactNode;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <div className={css.embedded}>
      <div className={css.form}>{children}</div>
      <div className={css.embeddedActions}>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset to document default
        </Button>
        <Button variant="primary" size="sm" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

interface PageSetupStateSetters {
  width: (value: number) => void;
  height: (value: number) => void;
  orientation: (value: PageSetup["orientation"]) => void;
  marginTop: (value: number) => void;
  marginRight: (value: number) => void;
  marginBottom: (value: number) => void;
  marginLeft: (value: number) => void;
  spatiumMm: (value: number) => void;
  pageTurnsEnabled: (value: boolean) => void;
  pageTurnsPreset: (value: "relaxed" | "professional") => void;
}

function usePageSetupStateSync(initialSetup: PageSetup, active: boolean, setters: PageSetupStateSetters) {
  const {
    width,
    height,
    orientation,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    spatiumMm,
    pageTurnsEnabled,
    pageTurnsPreset,
  } = setters;
  useEffect(() => {
    if (!active) return;
    width(initialSetup.width);
    height(initialSetup.height);
    orientation(initialSetup.orientation);
    marginTop(initialSetup.margins.top);
    marginRight(initialSetup.margins.right);
    marginBottom(initialSetup.margins.bottom);
    marginLeft(initialSetup.margins.left);
    spatiumMm(initialSetup.spatiumMm);
    pageTurnsEnabled(initialSetup.pageTurns?.enabled ?? false);
    pageTurnsPreset(initialSetup.pageTurns?.preset ?? "relaxed");
  }, [
    active,
    initialSetup.width,
    initialSetup.height,
    initialSetup.orientation,
    initialSetup.margins.top,
    initialSetup.margins.right,
    initialSetup.margins.bottom,
    initialSetup.margins.left,
    initialSetup.spatiumMm,
    initialSetup.pageTurns?.enabled,
    initialSetup.pageTurns?.preset,
    width,
    height,
    orientation,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    spatiumMm,
    pageTurnsEnabled,
    pageTurnsPreset,
  ]);
}

// ─── Component ─────────────────────────────────────────────────────

function pageTurnsForApply(
  initial: PageTurnSettings | undefined,
  enabled: boolean,
  preset: "relaxed" | "professional",
): PageTurnSettings {
  if (!enabled) return { ...initial, enabled: false };
  if (preset === (initial?.preset ?? "relaxed")) {
    return { ...initial, enabled: true, preset };
  }
  return { enabled: true, preset };
}

export function PageSetupDialog({
  open,
  onClose = () => {},
  onApply,
  initialSetup,
  embedded = false,
  scopeName,
  onResetToDefault,
}: PageSetupDialogProps) {
  const [width, setWidth] = useState(initialSetup.width);
  const [height, setHeight] = useState(initialSetup.height);
  const [orientation, setOrientation] = useState(initialSetup.orientation);
  const [marginTop, setMarginTop] = useState(initialSetup.margins.top);
  const [marginRight, setMarginRight] = useState(initialSetup.margins.right);
  const [marginBottom, setMarginBottom] = useState(initialSetup.margins.bottom);
  const [marginLeft, setMarginLeft] = useState(initialSetup.margins.left);
  const [spatiumMm, setSpatiumMm] = useState(initialSetup.spatiumMm);
  const [pageTurnsEnabled, setPageTurnsEnabled] = useState(initialSetup.pageTurns?.enabled ?? false);
  const [pageTurnsPreset, setPageTurnsPreset] = useState<"relaxed" | "professional">(
    initialSetup.pageTurns?.preset ?? "relaxed",
  );

  usePageSetupStateSync(initialSetup, Boolean(open || embedded), {
    width: setWidth,
    height: setHeight,
    orientation: setOrientation,
    marginTop: setMarginTop,
    marginRight: setMarginRight,
    marginBottom: setMarginBottom,
    marginLeft: setMarginLeft,
    spatiumMm: setSpatiumMm,
    pageTurnsEnabled: setPageTurnsEnabled,
    pageTurnsPreset: setPageTurnsPreset,
  });

  const pageSizeName = findPageSizeName(width, height);
  const rastralIdx = findRastralIndex(spatiumMm);

  const handlePageSizeChange = useCallback(
    (name: string) => {
      const preset = PAGE_SIZE_PRESETS[name];
      if (!preset) return;
      if (orientation === "landscape") {
        setWidth(preset.height);
        setHeight(preset.width);
      } else {
        setWidth(preset.width);
        setHeight(preset.height);
      }
    },
    [orientation],
  );

  const handleOrientationChange = useCallback(
    (newOrientation: "portrait" | "landscape") => {
      if (newOrientation === orientation) return;
      // Swap width and height
      setWidth(height);
      setHeight(width);
      setOrientation(newOrientation);
    },
    [orientation, width, height],
  );

  const handleRastralChange = useCallback((idx: number) => {
    const val = RASTRAL_SPATIUM_MM[idx];
    if (idx >= 0 && val !== undefined) {
      setSpatiumMm(val);
    }
  }, []);

  const handleApply = useCallback(() => {
    // Always emit an explicit object so a user's choice (including turning the
    // on-by-default optimization OFF) persists; omitting it would let the
    // part default (enabled) win again on reload.
    const pageTurns = pageTurnsForApply(initialSetup.pageTurns, pageTurnsEnabled, pageTurnsPreset);
    onApply({
      width,
      height,
      orientation,
      margins: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
      spatiumMm,
      pageTurns,
    });
    if (!embedded) onClose();
  }, [
    width,
    height,
    orientation,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    spatiumMm,
    pageTurnsEnabled,
    pageTurnsPreset,
    initialSetup.pageTurns,
    onApply,
    onClose,
    embedded,
  ]);

  const applyPreset = useCallback((presetId: string) => {
    if (presetId === "custom") return;
    const preset = LAYOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setWidth(preset.setup.width);
    setHeight(preset.setup.height);
    setOrientation(preset.setup.orientation);
    setMarginTop(preset.setup.margins.top);
    setMarginRight(preset.setup.margins.right);
    setMarginBottom(preset.setup.margins.bottom);
    setMarginLeft(preset.setup.margins.left);
    setSpatiumMm(preset.setup.spatiumMm);
  }, []);

  const currentSetup: PageSetup = {
    width,
    height,
    orientation,
    margins: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
    spatiumMm,
  };
  const matchingPreset = findMatchingPreset(currentSetup);
  const presetSelectValue = matchingPreset?.id ?? "custom";
  const resetToDefault = () => {
    setWidth(DEFAULT_PAGE_SETUP.width);
    setHeight(DEFAULT_PAGE_SETUP.height);
    setOrientation(DEFAULT_PAGE_SETUP.orientation);
    setMarginTop(DEFAULT_PAGE_SETUP.margins.top);
    setMarginRight(DEFAULT_PAGE_SETUP.margins.right);
    setMarginBottom(DEFAULT_PAGE_SETUP.margins.bottom);
    setMarginLeft(DEFAULT_PAGE_SETUP.margins.left);
    setSpatiumMm(DEFAULT_PAGE_SETUP.spatiumMm);
    onResetToDefault?.();
  };
  const formFields = (
    <>
      <PresetSection presetSelectValue={presetSelectValue} applyPreset={applyPreset} matchingPreset={matchingPreset} />
      <PageSizeSection
        pageSizeName={pageSizeName}
        onPageSizeChange={handlePageSizeChange}
        width={width}
        height={height}
        onWidthChange={setWidth}
        onHeightChange={setHeight}
        orientation={orientation}
        onOrientationChange={handleOrientationChange}
      />
      <MarginsSection
        marginTop={marginTop}
        marginBottom={marginBottom}
        marginLeft={marginLeft}
        marginRight={marginRight}
        onMarginTopChange={setMarginTop}
        onMarginBottomChange={setMarginBottom}
        onMarginLeftChange={setMarginLeft}
        onMarginRightChange={setMarginRight}
      />
      <StaffSizeSection
        rastralIdx={rastralIdx}
        spatiumMm={spatiumMm}
        onRastralChange={handleRastralChange}
        onSpatiumChange={setSpatiumMm}
      />
      <PageTurnsSection
        enabled={pageTurnsEnabled}
        preset={pageTurnsPreset}
        onEnabledChange={setPageTurnsEnabled}
        onPresetChange={setPageTurnsPreset}
      />
    </>
  );

  if (embedded) {
    return (
      <EmbeddedPageSetup onReset={resetToDefault} onApply={handleApply}>
        {formFields}
      </EmbeddedPageSetup>
    );
  }

  return (
    <Dialog open={open ?? false} onClose={onClose} size="wide">
      <DialogTitle className={css.title}>{scopeName ? `Page Setup — ${scopeName}` : "Page Setup"}</DialogTitle>
      <DialogBody>
        <div className={css.layout}>
          {/* Left: form fields */}
          <div className={css.form}>{formFields}</div>

          <PreviewPane
            width={width}
            height={height}
            marginTop={marginTop}
            marginRight={marginRight}
            marginBottom={marginBottom}
            marginLeft={marginLeft}
          />
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="sm" onClick={resetToDefault}>
          {onResetToDefault ? "Reset to document default" : "Reset Defaults"}
        </Button>
        <div style={PAGE_SETUP_SPACER_STYLE} />
        <DialogCancelButton />
        <DialogPrimaryButton onClick={handleApply}>Apply</DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

interface PresetSectionProps {
  readonly presetSelectValue: string;
  readonly applyPreset: (id: string) => void;
  readonly matchingPreset: LayoutPreset | null;
}

function PresetSection({ presetSelectValue, applyPreset, matchingPreset }: PresetSectionProps) {
  const presetOptions = [
    ...LAYOUT_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    { value: "custom", label: "Custom" },
  ];
  return (
    <Section title="Preset">
      <FormField label="Layout type" horizontal>
        <Select value={presetSelectValue} onValueChange={applyPreset} options={presetOptions} />
      </FormField>
      {matchingPreset && <div className={css.helperText}>{matchingPreset.description}</div>}
    </Section>
  );
}

interface PageSizeSectionProps {
  readonly pageSizeName: string;
  readonly onPageSizeChange: (name: string) => void;
  readonly width: number;
  readonly height: number;
  readonly onWidthChange: (mm: number) => void;
  readonly onHeightChange: (mm: number) => void;
  readonly orientation: "portrait" | "landscape";
  readonly onOrientationChange: (o: "portrait" | "landscape") => void;
}

function PageSizeSection({
  pageSizeName,
  onPageSizeChange,
  width,
  height,
  onWidthChange,
  onHeightChange,
  orientation,
  onOrientationChange,
}: PageSizeSectionProps) {
  const pageSizeOptions = [
    ...PAGE_SIZE_NAMES.map((name) => ({ value: name, label: name })),
    ...(pageSizeName === "Custom" && !PAGE_SIZE_NAMES.includes("Custom") ? [{ value: "Custom", label: "Custom" }] : []),
  ];
  return (
    <Section title="Page Size">
      <FormField label="Preset" horizontal>
        <Select value={pageSizeName} onValueChange={onPageSizeChange} options={pageSizeOptions} />
      </FormField>
      <FormField label="Width" horizontal>
        <UnitInput value={width} onChange={onWidthChange} min={50} max={1000} />
      </FormField>
      <FormField label="Height" horizontal>
        <UnitInput value={height} onChange={onHeightChange} min={50} max={1000} />
      </FormField>
      <FormField label="Orientation" horizontal>
        <ButtonGroup
          options={[
            { value: "portrait", label: "Portrait" },
            { value: "landscape", label: "Landscape" },
          ]}
          value={orientation}
          onChange={onOrientationChange}
        />
      </FormField>
    </Section>
  );
}

interface MarginsSectionProps {
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly onMarginTopChange: (mm: number) => void;
  readonly onMarginBottomChange: (mm: number) => void;
  readonly onMarginLeftChange: (mm: number) => void;
  readonly onMarginRightChange: (mm: number) => void;
}

function MarginsSection({
  marginTop,
  marginBottom,
  marginLeft,
  marginRight,
  onMarginTopChange,
  onMarginBottomChange,
  onMarginLeftChange,
  onMarginRightChange,
}: MarginsSectionProps) {
  return (
    <Section title="Margins">
      <div className={css.marginGrid}>
        <FormField label="Top" horizontal>
          <UnitInput value={marginTop} onChange={onMarginTopChange} min={0} max={100} />
        </FormField>
        <FormField label="Bottom" horizontal>
          <UnitInput value={marginBottom} onChange={onMarginBottomChange} min={0} max={100} />
        </FormField>
        <FormField label="Left" horizontal>
          <UnitInput value={marginLeft} onChange={onMarginLeftChange} min={0} max={100} />
        </FormField>
        <FormField label="Right" horizontal>
          <UnitInput value={marginRight} onChange={onMarginRightChange} min={0} max={100} />
        </FormField>
      </div>
    </Section>
  );
}

interface StaffSizeSectionProps {
  readonly rastralIdx: number;
  readonly spatiumMm: number;
  readonly onRastralChange: (idx: number) => void;
  readonly onSpatiumChange: (mm: number) => void;
}

function StaffSizeSection({ rastralIdx, spatiumMm, onRastralChange, onSpatiumChange }: StaffSizeSectionProps) {
  const rastralOptions = [
    ...RASTRAL_LABELS.map((label, i) => ({ value: String(i), label })),
    ...(rastralIdx === -1 ? [{ value: "-1", label: `Custom (${spatiumMm.toFixed(3)} mm)` }] : []),
  ];
  return (
    <Section title="Staff Size">
      <FormField label="Rastral" horizontal>
        <Select value={String(rastralIdx)} onValueChange={(v) => onRastralChange(Number(v))} options={rastralOptions} />
      </FormField>
      <FormField label="Spatium (mm)" horizontal>
        <FormInput
          type="number"
          value={spatiumMm}
          onChange={(e) => onSpatiumChange(Math.max(0.5, Math.min(3.0, Number(e.target.value))))}
          min={0.5}
          max={3.0}
          step={0.001}
        />
      </FormField>
    </Section>
  );
}

interface PageTurnsSectionProps {
  readonly enabled: boolean;
  readonly preset: "relaxed" | "professional";
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onPresetChange: (preset: "relaxed" | "professional") => void;
}

function PageTurnsSection({ enabled, preset, onEnabledChange, onPresetChange }: PageTurnsSectionProps) {
  return (
    <Section title="Page Turns">
      <FormField label="Optimize page turns" horizontal>
        <Checkbox checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
      </FormField>
      {enabled && (
        <FormField label="Style" horizontal>
          <Select
            value={preset}
            onValueChange={(v) => onPresetChange(v === "professional" ? "professional" : "relaxed")}
            options={[
              { value: "relaxed", label: "Relaxed (easy turns)" },
              { value: "professional", label: "Professional (dense pages)" },
            ]}
          />
        </FormField>
      )}
    </Section>
  );
}

interface PreviewPaneProps {
  readonly width: number;
  readonly height: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
}

function PreviewPane({ width, height, marginTop, marginRight, marginBottom, marginLeft }: PreviewPaneProps) {
  const previewScale = 180 / Math.max(width, height);
  const previewW = width * previewScale;
  const previewH = height * previewScale;
  const previewMarginTop = marginTop * previewScale;
  const previewMarginRight = marginRight * previewScale;
  const previewMarginBottom = marginBottom * previewScale;
  const previewMarginLeft = marginLeft * previewScale;

  return (
    <div className={css.preview}>
      <div className={css.previewLabel}>Preview</div>
      <div className={css.previewPage} style={previewPageStyle(previewW, previewH)}>
        {/* Margin guidelines */}
        <div
          className={css.previewMargins}
          style={previewMarginsStyle(previewMarginTop, previewMarginLeft, previewMarginRight, previewMarginBottom)}
        />
        {/* Staff lines (decorative) */}
        {[0.25, 0.45, 0.65].map((frac) => (
          <div
            key={frac}
            className={css.previewStaffRow}
            style={previewStaffRowStyle(
              previewMarginTop,
              previewH,
              previewMarginBottom,
              previewMarginLeft,
              previewMarginRight,
              frac,
            )}
          >
            {[0, 1, 2, 3, 4].map((line) => (
              <div key={line} className={css.previewStaffLine} />
            ))}
          </div>
        ))}
      </div>
      <div className={css.previewDimensions}>
        {width} × {height} mm
      </div>
    </div>
  );
}
