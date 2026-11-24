import type {
  ActiveInstrumentState,
  DiagnosticCollector,
  EffectiveStaffMeter,
  GlobalMeasure,
  KeySignature,
  LayoutDefinition,
  LayoutSource,
  LocatedInstrumentChange,
  MnxDiagnostic,
  Part,
  ScoreDefinition,
  TimeSignature,
} from "@viritura/core";
import type { Rational, TimedSequence } from "./rhythm";

export interface MusicXmlExportOptions {
  /** Export one declared score/part view. Omission exports all instruments. */
  scoreIndex?: number;
  diagnostics?: DiagnosticCollector;
}

export interface MusicXmlExportResult {
  xml: string;
  diagnostics: readonly MnxDiagnostic[];
}

export interface MxlExportResult {
  bytes: Uint8Array;
  diagnostics: readonly MnxDiagnostic[];
}

export interface ExportPart {
  part: Part;
  sourceIndex: number;
  xmlId: string;
  sources: LayoutSource[];
  /** Original staff number to MusicXML staff number. */
  staves: Map<number, number>;
}

export interface ExportSelection {
  parts: ExportPart[];
  definition?: ScoreDefinition;
  layout?: LayoutDefinition;
  useWritten: boolean;
}

export interface ExportSequence extends TimedSequence {
  voice: string;
  sourceStaff: number;
  staff: number;
}

interface MeasurePlan {
  global: GlobalMeasure;
  time: TimeSignature;
  key: KeySignature;
  duration: Rational;
  sequences: ExportSequence[];
  staffMeters: Map<number, EffectiveStaffMeter>;
}

export interface PartPlan {
  selection: ExportPart;
  measures: MeasurePlan[];
  initialInstrument: ActiveInstrumentState;
  instrumentChanges: LocatedInstrumentChange[];
  measureStarts: Rational[];
  ottavaSpans: { start: Rational; end: Rational; staff: number; voice?: string; value: number }[];
}
