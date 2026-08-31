/**
 * SolvePanel — deciding what the music between two hits is.
 *
 * The composer's decision here is meter and bar count, not tempo. Hits fix the
 * span; saying "four bars of 4/4 and a 3/4" fixes the beat count; the tempo is
 * then whatever makes those beats fill that many seconds. Presenting it the
 * other way round — nudge a BPM until a bar line happens to touch a cut — is
 * how this is usually done and it is backwards.
 *
 * So the panel's job is to make the plan easy to state and the cost impossible
 * to miss. Frame error is the headline, live, and it is signed: running two
 * frames long and two frames short are different problems.
 */

import { useCallback, useMemo, useState } from "react";
import { Button, Collapsible, FormInput, SectionLabel, Select, Switch } from "@viritura/ui";
import { Plus, Scissors, Trash2 } from "lucide-react";
import type { Score } from "@viritura/core";
import {
  barSpanFor,
  normalizePlan,
  planPatches,
  removeSegment,
  setSegmentBars,
  setSegmentMeter,
  solvePlan,
  splitSegment,
  suggestPlan,
  type SpanPlan,
  type TimelineBar,
  type TimelineMarkerInterval,
} from "@viritura/video-sync";
import type { DocumentStoreState } from "../../../store/documentStore";
import { useDocumentStore } from "../../../store/DocumentContext";
import styles from "./SolvePanel.module.css";

/** Meters offered in the picker. */
const METERS = ["4/4", "3/4", "2/4", "5/4", "6/8", "9/8", "12/8", "2/2", "7/8", "5/8"] as const;
const METER_OPTIONS = METERS.map((value) => ({ value, label: value }));

/** Tempo a first suggestion aims at, absent any other signal. */
const DEFAULT_PREFERRED_BPM = 100;

function parseMeter(label: string): { count: number; unit: number } {
  const [count, unit] = label.split("/").map(Number);
  return { count: count ?? 4, unit: unit ?? 4 };
}

function meterLabel(meter: { count: number; unit: number }): string {
  return `${meter.count}/${meter.unit}`;
}

function markerName(number: number, label: string | undefined): string {
  return label ? `Marker ${number} “${label}”` : `Marker ${number}`;
}

export interface SolvePanelProps {
  readonly score: Score | null;
  readonly bars: readonly TimelineBar[];
  readonly interval: TimelineMarkerInterval | null;
  readonly intervals: readonly TimelineMarkerInterval[];
  readonly onSelectInterval: (interval: TimelineMarkerInterval) => void;
  readonly frameRate: number;
}

export function SolvePanel({ score, bars, interval, intervals, onSelectInterval, frameRate }: SolvePanelProps) {
  if (!interval) {
    return (
      <div className={styles.panel}>
        <SectionLabel className={styles.sectionLabel} label="Solve" />
        {intervals.length > 0 && (
          <IntervalSelect intervals={intervals} interval={null} onSelectInterval={onSelectInterval} />
        )}
        <p className={styles.empty}>
          {intervals.length === 0
            ? "Add at least two locked markers to create a region."
            : "Click a region between markers to select it for solving."}
        </p>
      </div>
    );
  }

  // Remounting on an interval change is what discards the previous plan, rather than
  // an effect that resets state. A composer editing a plan and then moving the
  // region selection expects a fresh suggestion, while playhead movement must
  // leave the explicitly selected region alone.
  return (
    <SpanSolver
      key={`${interval.fromMarkerId}:${interval.fromSeconds}:${interval.toMarkerId}:${interval.toSeconds}`}
      score={score}
      bars={bars}
      interval={interval}
      intervals={intervals}
      onSelectInterval={onSelectInterval}
      frameRate={frameRate}
    />
  );
}

interface SpanSolverProps extends SolvePanelProps {
  readonly interval: TimelineMarkerInterval;
}

function SpanSolver({ score, bars, interval, intervals, onSelectInterval, frameRate }: SpanSolverProps) {
  const commitPatches = useDocumentStore((s: DocumentStoreState) => s.commitPatches);
  const [changeStructure, setChangeStructure] = useState(false);
  const [plan, setPlan] = useState<SpanPlan>(() =>
    suggestPlan(interval.fromSeconds, interval.toSeconds, {
      meter: currentMeter(bars, interval.fromSeconds),
      preferredBpm: currentBpm(bars, interval.fromSeconds) ?? DEFAULT_PREFERRED_BPM,
    }),
  );

  const solution = useMemo(() => solvePlan(plan, frameRate), [plan, frameRate]);

  const placement = useMemo(
    () => barSpanFor(bars, interval.fromSeconds, interval.toSeconds),
    [bars, interval.fromSeconds, interval.toSeconds],
  );

  const application = useMemo(() => {
    if (!score || !solution || !placement) return null;
    return planPatches({
      score,
      plan,
      startMeasureIndex: placement.startIndex,
      currentBars: placement.barCount,
      bpm: solution.bpm,
      changeStructure,
    });
  }, [score, plan, solution, placement, changeStructure]);

  const apply = useCallback(() => {
    if (application) commitPatches(application.patches);
  }, [application, commitPatches]);

  const edit = useCallback((next: SpanPlan) => setPlan(normalizePlan(next)), []);

  return (
    <div className={styles.panel}>
      <SectionLabel className={styles.sectionLabel} label="Solve" />

      <IntervalSelect intervals={intervals} interval={interval} onSelectInterval={onSelectInterval} />

      <p className={styles.span}>
        {markerName(interval.fromMarkerNumber, interval.fromLabel)} →{" "}
        {markerName(interval.toMarkerNumber, interval.toLabel)} ·{" "}
        {(interval.toSeconds - interval.fromSeconds).toFixed(2)} s
        {/* The plan's extent, not the span's current one: this is the range the
            bars will occupy once applied, which is what the composer is about
            to commit to. Past the end of the score those bars do not exist
            yet — applying with structure enabled creates them. */}
        {placement && solution ? ` · bars ${placement.startIndex + 1}–${placement.startIndex + solution.bars}` : ""}
      </p>

      <Collapsible title={`Tempo fit · ♩=${solution ? formatBpm(solution.bpm) : "—"}`} className={styles.fitDetails}>
        <ul className={styles.segments}>
          {plan.segments.map((segment, index) => (
            <li key={index} className={styles.segment}>
              <FormInput
                type="number"
                min={1}
                className={styles.count}
                value={String(segment.bars)}
                aria-label="Bars"
                onChange={(event) => edit(setSegmentBars(plan, index, Number(event.currentTarget.value)))}
              />
              <span className={styles.times}>×</span>
              <Select
                value={meterLabel(segment.meter)}
                options={METER_OPTIONS}
                aria-label="Meter"
                onValueChange={(value) => edit(setSegmentMeter(plan, index, parseMeter(value)))}
              />
              <Button
                variant="ghost"
                size="sm"
                shape="icon"
                tooltip="Split this section so the meter can change partway through"
                disabled={segment.bars < 2}
                onClick={() => edit(splitSegment(plan, index, Math.floor(segment.bars / 2)))}
              >
                <Scissors size={12} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                shape="icon"
                tooltip="Remove this section"
                disabled={plan.segments.length < 2}
                onClick={() => edit(removeSegment(plan, index))}
              >
                <Trash2 size={12} />
              </Button>
            </li>
          ))}
        </ul>

        <Button
          variant="ghost"
          size="sm"
          label="Add section"
          tooltip="Add another section with its own bar count and meter"
          onClick={() => edit({ ...plan, segments: [...plan.segments, { meter: parseMeter("4/4"), bars: 1 }] })}
        >
          <Plus size={12} />
          <span>Add section</span>
        </Button>

        {solution ? <SolutionReadout bpm={solution.bpm} errorFrames={solution.errorFrames} /> : null}

        <label className={styles.structure}>
          <Switch
            checked={changeStructure}
            onCheckedChange={setChangeStructure}
            aria-label="Change bars and meters, not just the tempo"
          />
          <span>Change bars and meters too</span>
        </label>

        {application?.warnings.map((warning) => (
          <p key={warning} className={styles.warning}>
            {warning}
          </p>
        ))}

        <Button
          variant="primary"
          size="sm"
          label="Apply to score"
          tooltip="Write this plan into the score"
          disabled={!application}
          onClick={apply}
        />
      </Collapsible>
    </div>
  );
}

function IntervalSelect({
  intervals,
  interval,
  onSelectInterval,
}: {
  readonly intervals: readonly TimelineMarkerInterval[];
  readonly interval: TimelineMarkerInterval | null;
  readonly onSelectInterval: (interval: TimelineMarkerInterval) => void;
}) {
  const options = intervals.map((candidate) => ({
    value: intervalId(candidate),
    label: `${markerName(candidate.fromMarkerNumber, candidate.fromLabel)} → ${markerName(
      candidate.toMarkerNumber,
      candidate.toLabel,
    )}`,
  }));
  return (
    <Select
      value={interval ? intervalId(interval) : ""}
      placeholder="Select marker region"
      options={options}
      aria-label="Solve region"
      onValueChange={(value) => {
        const next = intervals.find((candidate) => intervalId(candidate) === value);
        if (next) onSelectInterval(next);
      }}
    />
  );
}

function intervalId(interval: TimelineMarkerInterval): string {
  return `${interval.fromMarkerId}:${interval.toMarkerId}`;
}

interface SolutionReadoutProps {
  readonly bpm: number;
  readonly errorFrames: number;
}

function formatBpm(bpm: number): string {
  return Number.parseFloat(bpm.toFixed(3)).toString();
}

function SolutionReadout({ bpm, errorFrames }: SolutionReadoutProps) {
  const magnitude = Math.abs(errorFrames);
  const tone = magnitude < 0.5 ? styles.good : magnitude < 2 ? styles.fair : styles.poor;
  const direction = errorFrames > 0 ? "long" : "short";

  return (
    <div className={styles.readout}>
      <span className={styles.bpm}>♩= {formatBpm(bpm)}</span>
      <span className={`${styles.error} ${tone}`}>
        {magnitude < 0.05 ? "on the frame" : `${magnitude.toFixed(2)} frames ${direction}`}
      </span>
    </div>
  );
}

/** Meter in force at a picture time, for seeding a suggestion. */
function currentMeter(bars: readonly TimelineBar[], seconds: number): { count: number; unit: number } {
  let meter = { count: 4, unit: 4 };
  for (const bar of bars) {
    if (bar.startSeconds > seconds) break;
    if (bar.meter) meter = { count: bar.meter.count, unit: bar.meter.unit };
  }
  return meter;
}

/** Tempo in force at a picture time, so a suggestion starts from the cue's pace. */
function currentBpm(bars: readonly TimelineBar[], seconds: number): number | undefined {
  let bpm: number | undefined;
  for (const bar of bars) {
    if (bar.startSeconds > seconds) break;
    if (bar.bpm !== undefined) bpm = bar.bpm;
  }
  return bpm;
}
