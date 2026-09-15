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

/// How a meter's beat grouping is presented, independent of the semantic
/// [`TimeSignature::beat_structure`] the grouping is derived from.
///
/// `Standard` engraves an ordinary numeric (or symbolic) meter with no
/// grouping decoration — automatic beaming still honors `beatStructure`, but
/// nothing about the printed meter shows it. `Additive` and `Annotation` are
/// only ever engraved for a meter whose resolved beat structure is
/// structurally non-default and has more than one group; see
/// [`resolve_grouping_display`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum GroupingDisplay {
    /// Ordinary numeric (or symbolic) time signature — no grouping shown.
    #[default]
    #[serde(rename = "standard")]
    Standard,
    /// Numerator written as its beat groups joined by `+` (e.g. `2+3+2` over
    /// `8`), replacing the plain count.
    #[serde(rename = "additive")]
    Additive,
    /// Ordinary numeric meter, plus a generated grouping annotation (e.g.
    /// `2+3+2+2`) engraved above it.
    #[serde(rename = "annotation")]
    Annotation,
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
    /// Ordered beat-group lengths in denominator units.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "beatStructure"
    )]
    pub beat_structure: Option<Vec<u32>>,
    /// Explicit per-occurrence grouping-display override (`_x.viritura.groupingDisplay`
    /// on this time signature). Forces any mode regardless of the document's
    /// house style, subject only to the symbolic-display/single-group safety
    /// fallback in [`resolve_grouping_display`].
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "groupingDisplay"
    )]
    pub grouping_display: Option<GroupingDisplay>,
}

impl TimeSignature {
    /// Total quarter-note beats in a measure.
    pub fn measure_beats(&self) -> f64 {
        (self.count as f64 * 4.0) / self.unit as f64
    }

    /// Resolve authored grouping or conventional defaults into metric boundaries.
    ///
    /// # Errors
    ///
    /// Returns an error when an authored structure is empty, contains zero, or
    /// does not sum to the time-signature numerator.
    pub fn resolve_meter(&self) -> Result<ResolvedMeter, BeatStructureError> {
        if self.count == 0 || !matches!(self.unit, 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128) {
            return Err(BeatStructureError::InvalidTimeSignature);
        }
        let (beat_structure, source) = match &self.beat_structure {
            Some(groups)
                if groups.is_empty()
                    || groups.contains(&0)
                    || groups.iter().copied().sum::<u32>() != self.count =>
            {
                return Err(BeatStructureError::InvalidBeatStructure);
            }
            Some(groups) => (groups.clone(), MeterStructureSource::Authored),
            None => (
                default_beat_structure(self.count, self.unit),
                MeterStructureSource::Default,
            ),
        };
        let mut beat_boundaries = Vec::with_capacity(beat_structure.len() + 1);
        beat_boundaries.push(0.0);
        for group in &beat_structure {
            let next = beat_boundaries.last().copied().unwrap_or(0.0)
                + (*group as f64 * 4.0) / self.unit as f64;
            beat_boundaries.push(next);
        }
        Ok(ResolvedMeter {
            count: self.count,
            unit: self.unit,
            beat_structure,
            beat_boundaries,
            source,
        })
    }
}

impl Default for TimeSignature {
    fn default() -> Self {
        Self {
            count: 4,
            unit: 4,
            display: None,
            beat_structure: None,
            grouping_display: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeterStructureSource {
    Authored,
    Default,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedMeter {
    pub count: u32,
    pub unit: u32,
    pub beat_structure: Vec<u32>,
    pub beat_boundaries: Vec<f64>,
    pub source: MeterStructureSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeatStructureError {
    InvalidTimeSignature,
    InvalidBeatStructure,
}

impl std::fmt::Display for BeatStructureError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTimeSignature => formatter
                .write_str("time signature count must be positive and unit must be supported"),
            Self::InvalidBeatStructure => {
                formatter.write_str("beat structure must contain positive values that sum to count")
            }
        }
    }
}

impl std::error::Error for BeatStructureError {}

/// Resolve which [`GroupingDisplay`] mode a rendered meter should actually
/// engrave.
///
/// Precedence: an explicit staff occurrence override wins outright, then the
/// time signature's own occurrence override (`ts.grouping_display`), then the
/// document's non-default house style — but only when `resolved` is
/// structurally non-default (its beat structure differs from the meter's
/// conventional default). Ordinary/default meters always stay `Standard`
/// under the house style, so a plain 4/4 never engraves `1+1+1+1`.
///
/// A symbolic display (common/cut/senzaMisura/note-value) or a resolved beat
/// structure of one group has nothing for additive/annotation to show, so
/// both fall back to `Standard` unconditionally — even under an explicit
/// occurrence or staff override.
pub fn resolve_grouping_display(
    ts: &TimeSignature,
    resolved: &ResolvedMeter,
    house_style: GroupingDisplay,
    staff_override: Option<GroupingDisplay>,
) -> GroupingDisplay {
    if ts.display.is_some() || resolved.beat_structure.len() <= 1 {
        return GroupingDisplay::Standard;
    }
    if let Some(mode) = staff_override {
        return mode;
    }
    if let Some(mode) = ts.grouping_display {
        return mode;
    }
    if house_style != GroupingDisplay::Standard
        && is_non_default_grouping(resolved, ts.count, ts.unit)
    {
        return house_style;
    }
    GroupingDisplay::Standard
}

/// Whether a resolved beat structure differs from the meter's conventional
/// default — i.e. whether it is worth decorating at all. An authored
/// structure that happens to match the automatic default (a "redundant"
/// structure) does not count as non-default.
fn is_non_default_grouping(resolved: &ResolvedMeter, count: u32, unit: u32) -> bool {
    resolved.beat_structure != default_beat_structure(count, unit)
}

pub(crate) fn default_beat_structure(count: u32, unit: u32) -> Vec<u32> {
    if unit >= 8 {
        match count {
            5 => return vec![3, 2],
            7 => return vec![2, 2, 3],
            8 => return vec![3, 3, 2],
            _ => {}
        }
    }
    if count.is_multiple_of(3) && (unit >= 8 || count > 3) {
        return vec![3; (count / 3) as usize];
    }
    if unit >= 8 {
        let quarter_units = unit / 4;
        let mut groups = Vec::new();
        let mut remaining = count;
        while remaining > 0 {
            let group = quarter_units.min(remaining);
            groups.push(group);
            remaining -= group;
        }
        return groups;
    }
    vec![1; count as usize]
}

/// Effective time signature at every measure index of a global measure
/// sequence, computed in a single forward pass — each measure inherits the
/// prior explicit `time` until a new one is authored. Shared by reconcile
/// and per-staff measure resolution so both agree on "the global meter in
/// force at measure N" without duplicating the inheritance walk.
pub fn effective_time_signature_table(
    measures: &[super::measure::GlobalMeasure],
) -> Vec<TimeSignature> {
    let mut current = TimeSignature::default();
    measures
        .iter()
        .map(|measure| {
            if let Some(ref ts) = measure.time {
                current = ts.clone();
            }
            current.clone()
        })
        .collect()
}

#[cfg(test)]
mod meter_tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MeterCase {
        count: u32,
        unit: u32,
        beat_structure: Vec<u32>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AuthoredMeterCase {
        count: u32,
        unit: u32,
        beat_structure: Vec<u32>,
        beat_boundaries: Vec<f64>,
    }

    #[derive(Deserialize)]
    struct MeterFixture {
        defaults: Vec<MeterCase>,
        authored: AuthoredMeterCase,
    }

    fn fixture() -> MeterFixture {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../test-fixtures/meter-definitions.json"
        )))
        .expect("shared meter fixture must parse")
    }

    #[test]
    fn resolves_conventional_meter_defaults() {
        for test_case in fixture().defaults {
            let meter = TimeSignature {
                count: test_case.count,
                unit: test_case.unit,
                display: None,
                beat_structure: None,
                grouping_display: None,
            }
            .resolve_meter()
            .unwrap();
            assert_eq!(meter.beat_structure, test_case.beat_structure);
            assert_eq!(meter.source, MeterStructureSource::Default);
        }
    }

    #[test]
    fn resolves_authored_meter_boundaries() {
        let test_case = fixture().authored;
        let meter = TimeSignature {
            count: test_case.count,
            unit: test_case.unit,
            display: None,
            beat_structure: Some(test_case.beat_structure),
            grouping_display: None,
        }
        .resolve_meter()
        .unwrap();
        assert_eq!(meter.beat_boundaries, test_case.beat_boundaries);
        assert_eq!(meter.source, MeterStructureSource::Authored);
    }

    #[test]
    fn rejects_invalid_authored_meter_structure() {
        let meter = TimeSignature {
            count: 5,
            unit: 8,
            display: None,
            beat_structure: Some(vec![2, 2]),
            grouping_display: None,
        };
        assert_eq!(
            meter.resolve_meter(),
            Err(BeatStructureError::InvalidBeatStructure)
        );
    }
}

#[cfg(test)]
mod grouping_display_tests {
    use super::*;

    fn ts(count: u32, unit: u32, beat_structure: Option<Vec<u32>>) -> TimeSignature {
        TimeSignature {
            count,
            unit,
            display: None,
            beat_structure,
            grouping_display: None,
        }
    }

    #[test]
    fn default_meter_stays_standard_under_house_style() {
        // 4/4 with no authored beatStructure: resolved == default, so the
        // house style must never engrave "1+1+1+1".
        let time = ts(4, 4, None);
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(&time, &resolved, GroupingDisplay::Additive, None),
            GroupingDisplay::Standard
        );
    }

    #[test]
    fn redundant_authored_structure_stays_standard_under_house_style() {
        // Authored [1,1,1,1] for 4/4 duplicates the automatic default, so it
        // is not "non-default" even though it was explicitly authored.
        let time = ts(4, 4, Some(vec![1, 1, 1, 1]));
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(&time, &resolved, GroupingDisplay::Annotation, None),
            GroupingDisplay::Standard
        );
    }

    #[test]
    fn non_default_structure_takes_house_style() {
        let time = ts(7, 8, Some(vec![3, 2, 2]));
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(&time, &resolved, GroupingDisplay::Additive, None),
            GroupingDisplay::Additive
        );
    }

    #[test]
    fn time_occurrence_override_wins_over_house_style() {
        let mut time = ts(7, 8, Some(vec![3, 2, 2]));
        time.grouping_display = Some(GroupingDisplay::Annotation);
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(&time, &resolved, GroupingDisplay::Additive, None),
            GroupingDisplay::Annotation
        );
    }

    #[test]
    fn staff_override_wins_over_time_occurrence_and_house_style() {
        let mut time = ts(7, 8, Some(vec![3, 2, 2]));
        time.grouping_display = Some(GroupingDisplay::Annotation);
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(
                &time,
                &resolved,
                GroupingDisplay::Additive,
                Some(GroupingDisplay::Standard)
            ),
            GroupingDisplay::Standard
        );
    }

    #[test]
    fn single_group_structure_falls_back_to_standard_even_when_forced() {
        // A meter authored as one all-encompassing group has nothing to add.
        let mut time = ts(4, 4, Some(vec![4]));
        time.grouping_display = Some(GroupingDisplay::Additive);
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(&time, &resolved, GroupingDisplay::Standard, None),
            GroupingDisplay::Standard
        );
    }

    #[test]
    fn symbolic_display_falls_back_to_standard_even_when_forced() {
        let mut time = ts(4, 4, Some(vec![2, 2]));
        time.display = Some(TimeSignatureDisplay::Common);
        time.grouping_display = Some(GroupingDisplay::Additive);
        let resolved = time.resolve_meter().unwrap();
        assert_eq!(
            resolve_grouping_display(
                &time,
                &resolved,
                GroupingDisplay::Standard,
                Some(GroupingDisplay::Annotation)
            ),
            GroupingDisplay::Standard
        );
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
    /// House-style grouping display, applied only when a meter's resolved
    /// beat structure is structurally non-default (see
    /// [`resolve_grouping_display`]). Ordinary/default meters always stay
    /// `Standard` regardless of this setting.
    #[serde(default, skip_serializing_if = "is_default")]
    pub non_default_grouping_display: GroupingDisplay,
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
            non_default_grouping_display: GroupingDisplay::Standard,
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
    #[serde(default)]
    non_default_grouping_display: GroupingDisplay,
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
                non_default_grouping_display: value.non_default_grouping_display,
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
