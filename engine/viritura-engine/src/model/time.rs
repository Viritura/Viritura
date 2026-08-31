use serde::{Deserialize, Deserializer, Serialize};

/// Largest supported time-signature scale. Outside-staff digits are designed
/// to be enlarged dramatically; film-score group meters commonly need 6–10×.
pub const TIME_SIGNATURE_SCALE_MAX: f64 = 12.0;

/// Display style for time signatures (MNX "display" field).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TimeSignatureDisplay {
    /// Common time (C symbol)
    #[serde(rename = "common")]
    Common,
    /// Cut time (₵ symbol)
    #[serde(rename = "cut")]
    Cut,
    /// Senza misura — no time signature displayed (free rhythm)
    #[serde(rename = "senzaMisura")]
    SenzaMisura,
    /// Note value display (e.g. dotted quarter = dotted quarter glyph)
    #[serde(rename = "note")]
    Note,
}

/// Time signature (MNX-aligned).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeSignature {
    /// Numerator (beats per measure)
    pub count: u32,
    /// Denominator (beat unit: 4=quarter, 8=eighth, etc.)
    pub unit: u32,
    /// Optional display style (common or cut time glyph)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<TimeSignatureDisplay>,
}

impl TimeSignature {
    /// Total quarter-note beats in a measure.
    pub fn measure_beats(&self) -> f64 {
        (self.count as f64 * 4.0) / self.unit as f64
    }
}

impl Default for TimeSignature {
    fn default() -> Self {
        Self {
            count: 4,
            unit: 4,
            display: None,
        }
    }
}

/// Glyph treatment for a time signature, independent of its placement,
/// distribution, and scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum TimeSignatureRenderStyle {
    #[default]
    #[serde(rename = "standard")]
    Standard,
    #[serde(rename = "narrow")]
    Narrow,
    /// Bravura `ss04`: tightly condensed digits intended to be enlarged
    /// outside a staff, historically used by the spanning-groups preset.
    #[serde(rename = "outsideStaff")]
    OutsideStaff,
    #[serde(rename = "singleNumber")]
    SingleNumber,
    #[serde(rename = "noteValue")]
    NoteValue,
}

/// Whether every staff or every staff group receives a meter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum TimeSignatureDistribution {
    #[default]
    #[serde(rename = "perStaff")]
    PerStaff,
    #[serde(rename = "perGroup")]
    PerGroup,
}

/// Whether brace groups (grand staves) count as one group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum TimeSignatureGrandStaff {
    #[default]
    #[serde(rename = "include")]
    Include,
    #[serde(rename = "exclude")]
    Exclude,
}

/// Vertical alignment relative to the target staff or staff group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum TimeSignaturePosition {
    #[default]
    #[serde(rename = "center")]
    Center,
    #[serde(rename = "top")]
    Top,
    #[serde(rename = "bottom")]
    Bottom,
    #[serde(rename = "above")]
    Above,
}

/// How a `senzaMisura` time declaration is engraved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum SenzaMisuraDisplay {
    #[default]
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "hidden")]
    Hidden,
}

fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    value == &T::default()
}

fn is_default_scale(value: &f64) -> bool {
    (*value - 1.0).abs() < f64::EPSILON
}

/// Orthogonal time signature engraving settings.
///
/// The object is stored at `_x.viritura.timeSignatures.{score,parts}`. The
/// custom deserializer also accepts the combined string presets written by
/// the first implementation, but serialization always emits this object.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSignatureSettings {
    #[serde(default, skip_serializing_if = "is_default")]
    pub render_style: TimeSignatureRenderStyle,
    #[serde(default, skip_serializing_if = "is_default")]
    pub distribution: TimeSignatureDistribution,
    #[serde(default, skip_serializing_if = "is_default")]
    pub grand_staff: TimeSignatureGrandStaff,
    #[serde(default, skip_serializing_if = "is_default")]
    pub position: TimeSignaturePosition,
    #[serde(default = "default_scale", skip_serializing_if = "is_default_scale")]
    pub scale: f64,
    #[serde(default, skip_serializing_if = "is_default")]
    pub senza_misura: SenzaMisuraDisplay,
}

const fn default_scale() -> f64 {
    1.0
}

impl Default for TimeSignatureSettings {
    fn default() -> Self {
        Self {
            render_style: TimeSignatureRenderStyle::Standard,
            distribution: TimeSignatureDistribution::PerStaff,
            grand_staff: TimeSignatureGrandStaff::Include,
            position: TimeSignaturePosition::Center,
            scale: 1.0,
            senza_misura: SenzaMisuraDisplay::Open,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeSignatureSettingsObject {
    #[serde(default)]
    render_style: TimeSignatureRenderStyle,
    #[serde(default)]
    distribution: TimeSignatureDistribution,
    #[serde(default)]
    grand_staff: TimeSignatureGrandStaff,
    #[serde(default)]
    position: TimeSignaturePosition,
    #[serde(default = "default_scale")]
    scale: f64,
    #[serde(default)]
    senza_misura: SenzaMisuraDisplay,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum TimeSignatureSettingsWire {
    Object(TimeSignatureSettingsObject),
    Legacy(String),
}

impl<'de> Deserialize<'de> for TimeSignatureSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let settings = match TimeSignatureSettingsWire::deserialize(deserializer)? {
            TimeSignatureSettingsWire::Object(value) => Self {
                render_style: value.render_style,
                distribution: value.distribution,
                grand_staff: value.grand_staff,
                position: value.position,
                scale: value.scale.clamp(0.25, TIME_SIGNATURE_SCALE_MAX),
                senza_misura: value.senza_misura,
            },
            TimeSignatureSettingsWire::Legacy(value) => match value.as_str() {
                "normal" => Self::default(),
                "large" => Self {
                    scale: 1.5,
                    ..Self::default()
                },
                "narrow" => Self {
                    render_style: TimeSignatureRenderStyle::Narrow,
                    ..Self::default()
                },
                "aboveStaff" => Self {
                    position: TimeSignaturePosition::Above,
                    scale: 0.8,
                    ..Self::default()
                },
                "spanning" => Self {
                    render_style: TimeSignatureRenderStyle::OutsideStaff,
                    distribution: TimeSignatureDistribution::PerGroup,
                    scale: 2.0,
                    ..Self::default()
                },
                "singleNumber" => Self {
                    render_style: TimeSignatureRenderStyle::SingleNumber,
                    scale: 2.0,
                    ..Self::default()
                },
                "noteValue" => Self {
                    render_style: TimeSignatureRenderStyle::NoteValue,
                    ..Self::default()
                },
                other => {
                    return Err(serde::de::Error::unknown_variant(
                        other,
                        &[
                            "normal",
                            "large",
                            "narrow",
                            "aboveStaff",
                            "spanning",
                            "singleNumber",
                            "noteValue",
                        ],
                    ));
                }
            },
        };
        Ok(settings)
    }
}

/// Per-document time signature styles, chosen independently for full scores
/// and for single-part layouts: the large and spanning styles belong to the
/// conductor's score, while players read conventional in-staff meters.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct TimeSignatureStyles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<TimeSignatureSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<TimeSignatureSettings>,
}

/// Which kind of layout is being engraved, so the document's score/parts
/// styles can be resolved without threading a flag through the WASM surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LayoutContext {
    /// A full score: the primary score definition, or any layout that draws
    /// more than one part.
    #[default]
    Score,
    /// A single player's layout — a non-primary score definition whose layout
    /// draws exactly one part.
    Part,
}

impl TimeSignatureStyles {
    /// The settings this document asks for in the given layout context.
    pub fn resolve(&self, context: LayoutContext) -> TimeSignatureSettings {
        match context {
            LayoutContext::Score => self.score,
            LayoutContext::Part => self.parts,
        }
        .unwrap_or_default()
    }
}
