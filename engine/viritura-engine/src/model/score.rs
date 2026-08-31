use super::kit::Sound;
use super::layout::{LayoutDefinition, ScoreDefinition};
use super::measure::GlobalMeasure;
use super::part::Part;
use super::time::TimeSignatureStyles;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// MNX support flags — declares which optional features the document uses.
/// See MNX spec: objects/support
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    /// When true, every note with a visible accidental has `accidentalDisplay` set.
    /// When false/absent, software should use its own accidental-display algorithm.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_accidental_display: Option<bool>,
    /// When true, all beaming is explicitly encoded in `beams[]`.
    /// When false/absent, software should auto-beam.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_beams: Option<bool>,
}

/// MNX version info.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MnxMeta {
    pub version: u32,
    /// Optional support flags declaring which features the document uses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support: Option<Support>,
}

/// Metadata for a single lyric line (MNX `lyric-line-metadata`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LyricLineMetadataEntry {
    /// Human-readable label (e.g., "English", "Nederlands")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// BCP 47 language code (e.g., "en", "nl")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

/// Global lyrics configuration (MNX `lyrics-global`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GlobalLyrics {
    /// Map of lyric line ID → metadata (label, lang)
    #[serde(skip_serializing_if = "Option::is_none", rename = "lineMetadata")]
    pub line_metadata: Option<HashMap<String, LyricLineMetadataEntry>>,
    /// Explicit display ordering of lyric line IDs
    #[serde(skip_serializing_if = "Option::is_none", rename = "lineOrder")]
    pub line_order: Option<Vec<String>>,
}

/// Global section of the score.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Global {
    pub measures: Vec<GlobalMeasure>,
    /// Global lyrics configuration (line metadata and ordering)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<GlobalLyrics>,
    /// Named GM-MIDI sounds (used by drum-kit components and other instruments).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sounds: Option<HashMap<String, Sound>>,
}

/// Score-level metadata (title, composer, etc.)
/// Stored in `_x.viritura.metadata` vendor extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ScoreMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyricist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arranger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copyright: Option<String>,
}

/// Wrapper for `_x.viritura` vendor extension at root level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RootVirituraExtension {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ScoreMetadata>,
    /// Per-document text style overrides: a partial map of role name → partial
    /// style (see `layout::text_styles`). Stored as raw JSON and merged over the
    /// engine's built-in defaults at layout time, so adding style properties
    /// never requires a model migration.
    #[serde(rename = "textStyles", skip_serializing_if = "Option::is_none")]
    pub text_styles: Option<serde_json::Value>,
    /// Per-document placement overrides: a partial map of dependent kind name →
    /// partial metrics (see `layout::placement_metrics`). Stored as raw JSON and
    /// merged over the engine's built-in defaults at layout time, mirroring
    /// `text_styles`.
    #[serde(rename = "placement", skip_serializing_if = "Option::is_none")]
    pub placement: Option<serde_json::Value>,
    /// Per-document time signature engraving styles for scores and parts.
    /// Unlike `text_styles` and `placement` this is a small closed enum pair,
    /// so it is promoted to typed values rather than carried as raw JSON.
    #[serde(rename = "timeSignatures", skip_serializing_if = "Option::is_none")]
    pub time_signatures: Option<TimeSignatureStyles>,
}

/// Wrapper for the `_x` vendor extension container at root level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RootVendorExtension {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viritura: Option<RootVirituraExtension>,
}

/// Root score document (MNX-aligned).
///
/// Model-internal type — construction goes through
/// `promote::root::promote_root` (driven by [`crate::parse::parse_mnx`]).
/// See `docs/spec/data-model-pipeline.md`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Score {
    pub mnx: MnxMeta,
    pub global: Global,
    pub parts: Vec<Part>,
    /// MNX layout definitions (staff groupings, brackets, braces).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layouts: Vec<LayoutDefinition>,
    /// MNX score definitions (page/system structure with layout references).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scores: Vec<ScoreDefinition>,
    /// Vendor extension: `_x.viritura` at root level.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_x")]
    pub vendor_ext: Option<RootVendorExtension>,
}

impl Score {
    /// Get the score metadata (title, composer, etc.) if present.
    pub fn metadata(&self) -> Option<&ScoreMetadata> {
        self.vendor_ext
            .as_ref()?
            .viritura
            .as_ref()?
            .metadata
            .as_ref()
    }

    /// Get the per-document text style overrides (`_x.viritura.textStyles`) if
    /// present. The value is a partial role → partial-style map merged over the
    /// engine defaults by `TextStylesheet::merge_json`.
    pub fn text_styles_json(&self) -> Option<&serde_json::Value> {
        self.vendor_ext
            .as_ref()?
            .viritura
            .as_ref()?
            .text_styles
            .as_ref()
    }

    /// Get the per-document placement overrides (`_x.viritura.placement`) if
    /// present. The value is a partial dependent-kind → partial-metrics map
    /// merged over the engine defaults by `PlacementTable::merge_json`.
    pub fn placement_json(&self) -> Option<&serde_json::Value> {
        self.vendor_ext
            .as_ref()?
            .viritura
            .as_ref()?
            .placement
            .as_ref()
    }

    /// The document's time signature styles (`_x.viritura.timeSignatures`),
    /// falling back to the engine default (`normal` for both score and parts).
    pub fn time_signature_styles(&self) -> TimeSignatureStyles {
        self.vendor_ext
            .as_ref()
            .and_then(|x| x.viritura.as_ref())
            .and_then(|v| v.time_signatures)
            .unwrap_or_default()
    }

    pub fn set_time_signature_styles(&mut self, styles: Option<TimeSignatureStyles>) {
        let vendor_ext = self
            .vendor_ext
            .get_or_insert_with(RootVendorExtension::default);
        let viritura = vendor_ext
            .viritura
            .get_or_insert_with(RootVirituraExtension::default);
        viritura.time_signatures = styles;
    }
}
