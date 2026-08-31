import type { GlobalMeasure } from "./measure";
import type { Part } from "./part";
import type { LayoutDefinition, ScoreDefinition } from "./layout";
import type { Sound } from "./kit";

/** Score-level metadata (title, composer, etc.) — stored in root _x.viritura.metadata. */
export interface ScoreMetadata {
  title?: string;
  subtitle?: string;
  composer?: string;
  lyricist?: string;
  arranger?: string;
  copyright?: string;
}

/** A generic font family for score text. Maps to a CSS generic family. */
export type FontFamily = "serif" | "sans-serif" | "monospace";

/** Horizontal alignment of a text run relative to its anchor. */
export type TextAlignment = "left" | "center" | "right";

/**
 * A partial text style override for one role. Any omitted field falls back to
 * the engine's built-in default for that role.
 */
export interface TextStyleOverride {
  /** Font size in staff spaces. */
  size?: number;
  family?: FontFamily;
  bold?: boolean;
  italic?: boolean;
  /** Fill color as #RRGGBB. */
  color?: string;
  align?: TextAlignment;
}

/**
 * Per-document text style overrides — a partial map of role name → partial
 * style. Stored in root `_x.viritura.textStyles` and merged over the engine
 * defaults at layout time. Roles: title, subtitle, composer, arranger,
 * staffLabel, pageNumber, tempo, pedalText, copyright.
 */
export type TextStyles = Partial<Record<string, TextStyleOverride>>;

/** Glyph treatment, independent of placement, distribution, and scale. */
export type TimeSignatureRenderStyle = "standard" | "narrow" | "outsideStaff" | "singleNumber" | "noteValue";

/** Whether each staff or each staff group receives a meter. */
export type TimeSignatureDistribution = "perStaff" | "perGroup";

/** Whether brace groups count as one group for `perGroup` distribution. */
export type TimeSignatureGrandStaff = "include" | "exclude";

/** Vertical alignment relative to the target staff or staff group. */
export type TimeSignaturePosition = "center" | "top" | "bottom" | "above";

/** Printed treatment for MNX `display: "senzaMisura"`. */
export type SenzaMisuraDisplay = "open" | "hidden";

/**
 * Orthogonal time signature engraving settings. Omitted fields use standard
 * digits, one per staff, centered at 1× scale.
 */
export interface TimeSignatureSettings {
  renderStyle?: TimeSignatureRenderStyle;
  distribution?: TimeSignatureDistribution;
  grandStaff?: TimeSignatureGrandStaff;
  position?: TimeSignaturePosition;
  /** Scale multiplier over the selected render style's normal optical size. */
  scale?: number;
  /** Whether open-meter cadenza signs render as an X or are suppressed. */
  senzaMisura?: SenzaMisuraDisplay;
}

/**
 * Time signature styles chosen independently for full scores and for
 * single-part layouts: the large and spanning styles belong to the
 * conductor's score, while players read conventional in-staff meters.
 * Stored in root `_x.viritura.timeSignatures`; either side omitted engraves
 * `normal`.
 */
export interface TimeSignatureStyles {
  score?: TimeSignatureSettings;
  parts?: TimeSignatureSettings;
}

/** A selected source from a score sound profile. */
export interface PartSoundOverride {
  /** Stable profile-defined source ID, never a MIDI program number. */
  sourceId: string;
  /**
   * Profile this source belongs to. Lets different parts target different
   * profiles (e.g. some parts on a user VST profile, others on VirituraSounds)
   * within one score. Absent → the assignment-level `profileId` (back-compat
   * with scores authored before per-part profiles existed).
   */
  profileId?: string;
  /** Version of the per-part `profileId`'s rules. Absent → assignment-level. */
  profileVersion?: number;
}

/**
 * Score-scoped playback sound assignment, stored in root
 * `_x.viritura.soundProfile`. The `parts` map is keyed by stable MNX part ID.
 */
export interface SoundProfileAssignment {
  profileId: string;
  profileVersion: number;
  parts: Record<string, PartSoundOverride>;
}

/**
 * Identity of a picture attached to a score, stored in root
 * `_x.viritura.videoSync.media`.
 *
 * Deliberately carries no filesystem path and no media bytes. A score has to
 * open on another machine and round-trip through any MNX reader, so the video
 * stays a device-local binding that the user relinks; `contentHash` is what
 * makes that relink verifiable rather than a guess.
 */
export interface VideoMediaIdentity {
  /** File or clip name shown in the UI. Never a path. */
  displayName: string;
  /**
   * `sha256:<hex>` over sampled regions of a local file plus its byte length.
   * Absent for demo clips, which are identified by {@link demoSourceId}.
   */
  contentHash?: string;
  /**
   * Identifier of a clip from Viritura's built-in demo catalog. Such a clip
   * streams from a public URL, so it needs no device-local binding and can be
   * reattached automatically when the score is reopened.
   */
  demoSourceId?: string;
  /** Media duration in seconds, when known at attach time. */
  durationSeconds?: number;
}

/**
 * Score-to-picture synchronization settings, stored in root
 * `_x.viritura.videoSync`.
 *
 * MNX has no concept of picture, so the whole feature lives in one versioned
 * vendor object instead of scattering unrelated extensions across the document.
 */
export interface VideoSyncSettings {
  /** Schema version of this payload. */
  version: number;
  /** Attached picture identity; absent when settings exist but no media does. */
  media?: VideoMediaIdentity;
  /**
   * Media time (seconds) corresponding to score time zero. 120 means the score
   * starts two minutes into the picture; negative values place the score before
   * the first frame.
   */
  pictureOffsetSeconds: number;
  /** Whether the picture's production audio is audible. */
  pictureAudioEnabled: boolean;
  /**
   * Display-only offset applied to the picture timecode readout, for deliveries
   * that start at e.g. 01:00:00:00. Never affects the media time we seek to.
   */
  startTimecodeSeconds?: number;
  /**
   * Frame rate of the delivery, as an identifier rather than a decimal.
   *
   * NTSC rates are rational — 23.976 is exactly 24000/1001, and storing the
   * decimal drifts more than a frame per hour. Drop-frame is a labelling
   * convention rather than a distinct speed, so it rides along in the same id.
   * The browser exposes neither the file's true rate nor its drop-frame flag,
   * so this is declared by the user.
   */
  frameRate?: string;
  /**
   * Spotted moments in the picture. Stored here rather than against the score's
   * own timeline because they describe the film, and so must survive any amount
   * of rewriting of the music.
   */
  hitPoints?: HitPoint[];
}

/**
 * A moment in the picture that music is written against.
 *
 * Addressed in picture time because that is what it is: a fact about the film,
 * fixed while the score around it changes. Solving a cue means choosing bars,
 * meters and tempi that place a downbeat here.
 */
export interface HitPoint {
  /** Stable identifier, so a hit survives edits and reordering. */
  id: string;
  /**
   * Seconds from the picture's first frame. Independent of
   * `pictureOffsetSeconds`, so re-aligning picture against score does not move
   * hits relative to the film.
   */
  pictureSeconds: number;
  /** What happens on screen; free text from the spotting session. */
  label?: string;
  /**
   * Whether the solver must land a downbeat here. An unlocked hit is a
   * note-to-self the solver may ignore. Defaults to true.
   */
  locked?: boolean;
}

/** Metadata for a single lyric line (MNX lyric-line-metadata). */
export interface LyricLineMetadataEntry {
  label?: string;
  lang?: string;
}

/** Global lyrics configuration (MNX lyrics-global). */
export interface GlobalLyrics {
  lineMetadata?: Record<string, LyricLineMetadataEntry>;
  lineOrder?: string[];
}

/** MNX support flags — declares which optional features the document uses. */
export interface Support {
  /** When true, every note with a visible accidental has accidentalDisplay set. */
  useAccidentalDisplay?: boolean;
  /** When true, all beaming is explicitly encoded in beams[]. */
  useBeams?: boolean;
}

/**
 * The root score document — our in-memory model.
 * This is what the MNX parser produces and what the renderer consumes.
 */
export interface Score {
  /** MNX version info */
  mnx: {
    version: number;
    /** Optional support flags declaring which features the document uses. */
    support?: Support;
  };
  /** Global data shared across all parts */
  global: {
    measures: GlobalMeasure[];
    /** Global lyrics configuration */
    lyrics?: GlobalLyrics;
    /** Named GM-MIDI sounds (used by drum-kit components and other instruments). */
    sounds?: Record<string, Sound>;
  };
  /** Instrument parts */
  parts: Part[];
  /** MNX layout definitions (staff groupings, brackets, braces) */
  layouts?: LayoutDefinition[];
  /** MNX score definitions (page/system structure with layout references) */
  scores?: ScoreDefinition[];
  /** Score-level metadata (title, composer, etc.) */
  metadata?: ScoreMetadata;
  /** Per-document text style overrides (root _x.viritura.textStyles). */
  textStyles?: TextStyles;
  /** Time signature engraving styles (root `_x.viritura.timeSignatures`). */
  timeSignatures?: TimeSignatureStyles;
  /** Per-part playback sound assignments (root `_x.viritura.soundProfile`). */
  soundProfile?: SoundProfileAssignment;
  /** Score-to-picture synchronization settings (root `_x.viritura.videoSync`). */
  videoSync?: VideoSyncSettings;
}
