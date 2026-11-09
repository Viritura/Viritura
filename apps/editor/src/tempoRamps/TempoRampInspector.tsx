import { useMemo, useState } from "react";
import type { Score, TempoRampCurve } from "@viritura/core";
import { buildTempoModel, playbackGlobalMeasures } from "@viritura/midi";
import { Button, FormField, FormInput, Select } from "@viritura/ui";
import type { Selection } from "../store/selectionStore";
import { errorStyle, legendStyle, sectionStyle } from "../components/inspector/types";
import { barBeats, selectedRampSpan, type RampSpan } from "./selection";
import { removeTempoRamp, saveTempoRamp, type RampEdit } from "./editing";

const CURVES: { value: TempoRampCurve; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "early", label: "Early change" },
  { value: "late", label: "Late change" },
  { value: "smooth", label: "Smooth" },
];
const MARKINGS = ["rit.", "accel.", "rall.", "stringendo"].map((text) => ({ value: text, label: text }));
const TARGETS = [
  { value: "ratio", label: "Percentage of starting tempo" },
  { value: "absolute", label: "Quarter-note BPM" },
];

interface TempoRampInspectorProps {
  score: Score;
  selection: Selection;
  updateScore: (score: Score) => void;
}

function initialEdit(score: Score, span: RampSpan): RampEdit {
  const ramp = score.global.measures[span.startMeasure]?.gradualTempo;
  if (!ramp) return { ...span, targetMode: "ratio", target: 80, curve: "linear", text: "rit." };
  const endMeasure = score.global.measures.findIndex((measure) => measure.id === ramp.end.measure);
  const text = score.global.measures[span.startMeasure]?.systemText?.find((entry) => entry.id === ramp.systemTextId);
  return {
    startMeasure: span.startMeasure,
    startBeat: (ramp.position.fraction[0] / ramp.position.fraction[1]) * 4,
    endMeasure: endMeasure >= 0 ? endMeasure : Number(ramp.end.measure),
    endBeat: (ramp.end.position.fraction[0] / ramp.end.position.fraction[1]) * 4,
    targetMode: ramp.endRatio !== undefined ? "ratio" : "absolute",
    target: ramp.endRatio !== undefined ? ramp.endRatio * 100 : ramp.endBpm,
    curve: ramp.curve ?? "linear",
    text: text?.text.map((chunk) => ("text" in chunk ? chunk.text : "")).join("") ?? "",
    startBpm: ramp.startBpm,
  };
}

function RampForm({ score, span, updateScore }: Omit<TempoRampInspectorProps, "selection"> & { span: RampSpan }) {
  const existing = score.global.measures[span.startMeasure]?.gradualTempo;
  const [edit, setEdit] = useState(() => initialEdit(score, span));
  const [error, setError] = useState<string>();
  const change = <K extends keyof RampEdit>(key: K, value: RampEdit[K]) =>
    setEdit((current) => ({ ...current, [key]: value }));
  const owner = existing ? span.startMeasure : undefined;
  const timing = useMemo(() => {
    const source = owner === undefined ? score : removeTempoRamp(score, owner);
    return buildTempoModel(
      playbackGlobalMeasures(
        source,
        source.global.measures.map((_, index) => index),
      ),
    );
  }, [score, owner]);
  const beat = timing.measureStartBeats[edit.startMeasure];
  const from = edit.startBpm ?? (beat === undefined ? undefined : timing.model.bpmAtBeat(beat + edit.startBeat));
  const to = edit.targetMode === "ratio" ? (from === undefined ? undefined : (from * edit.target) / 100) : edit.target;
  const save = () => {
    const result = saveTempoRamp(score, edit, owner);
    setError(result.error);
    if (result.score) updateScore(result.score);
  };
  const fields: { key: "startMeasure" | "startBeat" | "endMeasure" | "endBeat"; label: string; bar?: boolean }[] = [
    { key: "startMeasure", label: "Start bar", bar: true },
    { key: "startBeat", label: "Start offset (quarter notes)" },
    { key: "endMeasure", label: "End bar", bar: true },
    { key: "endBeat", label: "End offset (quarter notes)" },
  ];

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Tempo ramp</legend>
      <p>Applies to all parts. Offsets count quarter notes from the start of each bar, beginning at 0.</p>
      {fields.map(({ key, label, bar }) => (
        <FormField key={key} label={label}>
          <FormInput
            type="number"
            min={bar ? 1 : 0}
            max={
              bar
                ? score.global.measures.length
                : barBeats(score, key === "startBeat" ? edit.startMeasure : edit.endMeasure)
            }
            step={bar ? 1 : "any"}
            value={Number.isFinite(edit[key]) ? edit[key] + (bar ? 1 : 0) : ""}
            onChange={(event) =>
              change(key, event.target.value === "" ? NaN : Number(event.target.value) - (bar ? 1 : 0))
            }
          />
        </FormField>
      ))}
      <FormField label="Target mode">
        <Select
          options={TARGETS}
          value={edit.targetMode}
          onValueChange={(value) => {
            if (value !== "ratio" && value !== "absolute") throw new Error(`Unknown tempo target mode: ${value}`);
            setEdit((current) => ({
              ...current,
              targetMode: value,
              target: value === "absolute" ? (to ?? 120) : from && to ? (to / from) * 100 : 100,
            }));
          }}
        />
      </FormField>
      <FormField label={edit.targetMode === "ratio" ? "Target (% of starting tempo)" : "Target BPM (quarter note)"}>
        <FormInput
          type="number"
          min={Number.MIN_VALUE}
          step="any"
          value={Number.isFinite(edit.target) ? edit.target : ""}
          onChange={(event) => change("target", event.target.value === "" ? NaN : Number(event.target.value))}
        />
      </FormField>
      {edit.startBpm !== undefined && (
        <>
          <FormField label="Starting BPM override (quarter note)">
            <FormInput
              type="number"
              min={Number.MIN_VALUE}
              step="any"
              value={edit.startBpm}
              onChange={(event) => change("startBpm", Number(event.target.value))}
            />
          </FormField>
          <Button size="sm" label="Inherit starting tempo" onClick={() => change("startBpm", undefined)} />
        </>
      )}
      <FormField label="Tempo curve">
        <Select
          options={CURVES}
          value={edit.curve}
          onValueChange={(value) => {
            const option = CURVES.find((curve) => curve.value === value);
            if (!option) throw new Error(`Unknown tempo curve: ${value}`);
            change("curve", option.value);
          }}
        />
      </FormField>
      <FormField label="Marking preset">
        <Select
          options={[...MARKINGS, { value: "custom", label: "Custom text" }]}
          value={MARKINGS.some((marking) => marking.value === edit.text) ? edit.text : "custom"}
          onValueChange={(value) => change("text", value === "custom" ? "" : value)}
        />
      </FormField>
      <FormField label="Printed ramp text">
        <FormInput value={edit.text} onChange={(event) => change("text", event.target.value)} />
      </FormField>
      {from !== undefined && to !== undefined && Number.isFinite(from) && Number.isFinite(to) && to > 0 && (
        <output aria-label="Tempo ramp preview">
          {from.toFixed(1)} to {to.toFixed(1)} quarter-note BPM
        </output>
      )}
      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
      <Button size="sm" label={existing ? "Apply tempo ramp" : "Create tempo ramp"} onClick={save} />
      {existing && (
        <Button
          size="sm"
          label="Remove tempo ramp"
          onClick={() => updateScore(removeTempoRamp(score, span.startMeasure))}
        />
      )}
    </fieldset>
  );
}

function SelectedRampInspector({
  score,
  span,
  updateScore,
}: Omit<TempoRampInspectorProps, "selection"> & { span: RampSpan }) {
  const [expanded, setExpanded] = useState(false);
  if (expanded || score.global.measures[span.startMeasure]?.gradualTempo) {
    return <RampForm score={score} span={span} updateScore={updateScore} />;
  }
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Tempo ramp</legend>
      <Button size="sm" label="Add tempo ramp" onClick={() => setExpanded(true)} />
    </fieldset>
  );
}

export function TempoRampInspector({ score, selection, updateScore }: TempoRampInspectorProps) {
  const span = selectedRampSpan(score, selection);
  if (!span) return null;
  const measure = score.global.measures[span.startMeasure];
  const key = JSON.stringify([span, measure?.gradualTempo, measure?.systemText]);
  return <SelectedRampInspector key={key} score={score} span={span} updateScore={updateScore} />;
}
