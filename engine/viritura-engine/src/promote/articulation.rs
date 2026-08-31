//! Promote articulations + small event leaves.
//!
//! - Standard MNX articulations (staccato/accent/etc.) are pulled from
//!   `raw::EventMarkings` top-level fields.
//! - Viritura-only markings (trill, ornaments, arpeggio, caesura,
//!   fingerings, staccatissimoWedge) come from
//!   `raw::EventMarkings._x.viritura`, deserialized into
//!   [`crate::raw_viritura::EventMarkingsExtensions`].
//! - Tie / Fermata / AccidentalDisplay / UpDown(Auto) are leaf promotes.

use crate::model::direction::Caesura as ModelCaesura;
use crate::model::event::{
    Accent as ModelAccent, AccidentalDisplay as ModelAccidentalDisplay,
    AccidentalEnclosure as ModelAccidentalEnclosure,
    AccidentalEnclosureSymbol as ModelAccidentalEnclosureSymbol, Arpeggio as ModelArpeggio,
    BowDirection as ModelBowDirection, BreathMark as ModelBreathMark,
    BreathMarkSymbol as ModelBreathMarkSymbol, Fermata as ModelFermata,
    FermataDuration as ModelFermataDuration, FermataSymbol as ModelFermataSymbol,
    Fingering as ModelFingering, Markings as ModelMarkings, Orientation as ModelOrientation,
    OrnamentType as ModelOrnamentType, SoftAccent as ModelSoftAccent, Spiccato as ModelSpiccato,
    Staccatissimo as ModelStaccatissimo, StaccatissimoWedge as ModelStaccatissimoWedge,
    Staccato as ModelStaccato, Stress as ModelStress, StrongAccent as ModelStrongAccent,
    Tenuto as ModelTenuto, Tie as ModelTie, Tremolo as ModelTremolo, Trill as ModelTrill,
    Unstress as ModelUnstress, UpDown as ModelUpDown, UpDownAuto as ModelUpDownAuto,
};
use crate::promote::vendor_ext::read_viritura_ext;
use crate::{raw, raw_viritura};

// ─── Enum leaves ──────────────────────────────────────────────────────

pub(crate) fn promote_orientation(r: raw::Orientation) -> ModelOrientation {
    match r {
        raw::Orientation::Above => ModelOrientation::Above,
        raw::Orientation::Below => ModelOrientation::Below,
        raw::Orientation::Auto => ModelOrientation::Auto,
    }
}

pub(crate) fn promote_up_down(r: raw::UpDown) -> ModelUpDown {
    match r {
        raw::UpDown::Up => ModelUpDown::Up,
        raw::UpDown::Down => ModelUpDown::Down,
    }
}

pub(crate) fn promote_up_down_auto(r: raw::UpDownAuto) -> ModelUpDownAuto {
    match r {
        raw::UpDownAuto::Up => ModelUpDownAuto::Up,
        raw::UpDownAuto::Down => ModelUpDownAuto::Down,
        raw::UpDownAuto::Auto => ModelUpDownAuto::Auto,
    }
}

pub(crate) fn promote_fermata_symbol(r: raw::FermataSymbol) -> ModelFermataSymbol {
    match r {
        raw::FermataSymbol::Normal => ModelFermataSymbol::Normal,
        raw::FermataSymbol::Angled => ModelFermataSymbol::Angled,
        raw::FermataSymbol::Square => ModelFermataSymbol::Square,
        raw::FermataSymbol::DoubleAngled => ModelFermataSymbol::DoubleAngled,
        raw::FermataSymbol::DoubleSquare => ModelFermataSymbol::DoubleSquare,
        raw::FermataSymbol::DoubleDot => ModelFermataSymbol::DoubleDot,
        raw::FermataSymbol::HalfCurve => ModelFermataSymbol::HalfCurve,
        raw::FermataSymbol::Curlew => ModelFermataSymbol::Curlew,
    }
}

pub(crate) fn promote_fermata_duration(r: raw::FermataDuration) -> ModelFermataDuration {
    match r {
        raw::FermataDuration::Auto => ModelFermataDuration::Auto,
        raw::FermataDuration::None => ModelFermataDuration::None,
        raw::FermataDuration::VeryShort => ModelFermataDuration::VeryShort,
        raw::FermataDuration::Short => ModelFermataDuration::Short,
        raw::FermataDuration::Normal => ModelFermataDuration::Normal,
        raw::FermataDuration::Long => ModelFermataDuration::Long,
        raw::FermataDuration::VeryLong => ModelFermataDuration::VeryLong,
    }
}

pub(crate) fn promote_accidental_enclosure_symbol(
    r: raw::AccidentalEnclosureSymbol,
) -> ModelAccidentalEnclosureSymbol {
    match r {
        raw::AccidentalEnclosureSymbol::Parentheses => ModelAccidentalEnclosureSymbol::Parentheses,
        raw::AccidentalEnclosureSymbol::Brackets => ModelAccidentalEnclosureSymbol::Brackets,
    }
}

pub(crate) fn promote_breath_mark_symbol(r: raw::BreathMarkSymbol) -> ModelBreathMarkSymbol {
    match r {
        raw::BreathMarkSymbol::Comma => ModelBreathMarkSymbol::Comma,
        raw::BreathMarkSymbol::Tick => ModelBreathMarkSymbol::Tick,
        raw::BreathMarkSymbol::Upbow => ModelBreathMarkSymbol::Upbow,
        raw::BreathMarkSymbol::Salzedo => ModelBreathMarkSymbol::Salzedo,
        raw::BreathMarkSymbol::Auto => ModelBreathMarkSymbol::Auto,
    }
}

// ─── Articulation structs (top-level) ────────────────────────────────

pub(crate) fn promote_staccato(r: raw::Staccato) -> ModelStaccato {
    ModelStaccato {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_staccatissimo(r: raw::Staccatissimo) -> ModelStaccatissimo {
    ModelStaccatissimo {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_spiccato(r: raw::Spiccato) -> ModelSpiccato {
    ModelSpiccato {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_tenuto(r: raw::Tenuto) -> ModelTenuto {
    ModelTenuto {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_accent(r: raw::Accent) -> ModelAccent {
    ModelAccent {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_strong_accent(r: raw::StrongAccent) -> ModelStrongAccent {
    ModelStrongAccent {
        orient: r.orient.map(promote_orientation),
        pointing: r.pointing.map(promote_up_down_auto),
    }
}

pub(crate) fn promote_soft_accent(r: raw::SoftAccent) -> ModelSoftAccent {
    ModelSoftAccent {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_stress(r: raw::StressMarking) -> ModelStress {
    ModelStress {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_unstress(r: raw::UnstressMarking) -> ModelUnstress {
    ModelUnstress {
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_tremolo_single(r: raw::TremoloSingle) -> ModelTremolo {
    ModelTremolo {
        marks: u32::try_from(r.marks.0).unwrap_or(1),
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_bow_direction(r: raw::BowDirection) -> ModelBowDirection {
    ModelBowDirection {
        direction: promote_up_down(r.direction),
        orient: r.orient.map(promote_orientation),
    }
}

pub(crate) fn promote_breath_mark(r: raw::BreathMark) -> ModelBreathMark {
    ModelBreathMark {
        symbol: r.symbol.map(promote_breath_mark_symbol),
        orient: r.orient.map(promote_orientation),
    }
}

// ─── Viritura-only articulation pieces ────────────────────────────────

pub(crate) fn promote_ornament_type(r: raw_viritura::OrnamentType) -> ModelOrnamentType {
    match r {
        raw_viritura::OrnamentType::Turn => ModelOrnamentType::Turn,
        raw_viritura::OrnamentType::InvertedTurn => ModelOrnamentType::InvertedTurn,
        raw_viritura::OrnamentType::Mordent => ModelOrnamentType::Mordent,
        raw_viritura::OrnamentType::InvertedMordent => ModelOrnamentType::InvertedMordent,
        raw_viritura::OrnamentType::ShortTrill => ModelOrnamentType::ShortTrill,
        raw_viritura::OrnamentType::TrillMordent => ModelOrnamentType::TrillMordent,
        raw_viritura::OrnamentType::DelayedTurn => ModelOrnamentType::DelayedTurn,
        raw_viritura::OrnamentType::Schleifer => ModelOrnamentType::Schleifer,
    }
}

pub(crate) fn promote_trill(r: raw_viritura::Trill) -> ModelTrill {
    ModelTrill {
        accidental: r.accidental.map(|a| *a as i32),
    }
}

pub(crate) fn promote_fingering(r: raw_viritura::Fingering) -> ModelFingering {
    ModelFingering {
        finger: u32::try_from(r.finger).unwrap_or(0),
    }
}

pub(crate) fn promote_caesura(r: raw_viritura::Caesura) -> ModelCaesura {
    ModelCaesura { style: r.style }
}

pub(crate) fn promote_staccatissimo_wedge(
    r: raw_viritura::EventMarkingsExtensionsStaccatissimoWedge,
) -> ModelStaccatissimoWedge {
    use raw_viritura::EventMarkingsExtensionsStaccatissimoWedgeOrient as O;
    ModelStaccatissimoWedge {
        orient: r.orient.map(|o| match o {
            O::Above => ModelOrientation::Above,
            O::Below => ModelOrientation::Below,
            O::Auto => ModelOrientation::Auto,
        }),
    }
}

// ─── Fermata / Tie / AccidentalDisplay ────────────────────────────────

pub(crate) fn promote_fermata(r: raw::Fermata) -> ModelFermata {
    ModelFermata {
        symbol: r.symbol.map(promote_fermata_symbol),
        duration: r.duration.map(promote_fermata_duration),
        orient: r.orient.map(promote_orientation),
        pointing: r.pointing.map(promote_up_down_auto),
    }
}

pub(crate) fn promote_tie(r: raw::Tie) -> ModelTie {
    ModelTie {
        target: r.target.map(String::from),
        target_type: r.target_type.map(|t| t.to_string()),
        side: r.side.map(|s| s.to_string()),
        lv: r.lv,
    }
}

pub(crate) fn promote_accidental_enclosure(
    r: raw::AccidentalEnclosure,
) -> ModelAccidentalEnclosure {
    ModelAccidentalEnclosure {
        symbol: promote_accidental_enclosure_symbol(r.symbol),
    }
}

pub(crate) fn promote_accidental_display(r: raw::AccidentalDisplay) -> ModelAccidentalDisplay {
    ModelAccidentalDisplay {
        show: r.show,
        force: r.force,
        enclosure: r.enclosure.map(promote_accidental_enclosure),
    }
}

// ─── Markings ─────────────────────────────────────────────────────────

pub(crate) fn promote_markings(r: raw::EventMarkings) -> ModelMarkings {
    // Pull Viritura-only markings out of `_x.viritura`.
    let viritura_json = read_viritura_ext(r.x.as_ref()).cloned();
    let ext: Option<raw_viritura::EventMarkingsExtensions> = viritura_json
        .as_ref()
        .and_then(|json| serde_json::from_value(serde_json::Value::Object(json.clone())).ok());

    let (staccatissimo_wedge, trill, ornaments, caesura, fingerings) = match ext {
        Some(e) => (
            e.staccatissimo_wedge.map(promote_staccatissimo_wedge),
            e.trill.map(promote_trill),
            if e.ornaments.is_empty() {
                None
            } else {
                Some(e.ornaments.into_iter().map(promote_ornament_type).collect())
            },
            e.caesura.map(promote_caesura),
            if e.fingerings.is_empty() {
                None
            } else {
                Some(e.fingerings.into_iter().map(promote_fingering).collect())
            },
        ),
        None => (None, None, None, None, None),
    };

    // Arpeggio is a Viritura-only marking not yet expressed in the
    // viritura-extensions schema. Pull it straight off the raw JSON map
    // when present.
    let arpeggio = viritura_json
        .as_ref()
        .and_then(|json| json.get("arpeggio").cloned())
        .and_then(|v| serde_json::from_value::<ModelArpeggio>(v).ok());

    ModelMarkings {
        staccato: r.staccato.map(promote_staccato),
        accent: r.accent.map(promote_accent),
        tenuto: r.tenuto.map(promote_tenuto),
        strong_accent: r.strong_accent.map(promote_strong_accent),
        tremolo: r.tremolo.map(promote_tremolo_single),
        staccatissimo: r.staccatissimo.map(promote_staccatissimo),
        staccatissimo_wedge,
        spiccato: r.spiccato.map(promote_spiccato),
        soft_accent: r.soft_accent.map(promote_soft_accent),
        stress: r.stress.map(promote_stress),
        unstress: r.unstress.map(promote_unstress),
        breath: r.breath.map(promote_breath_mark),
        bow_direction: r.bow_direction.map(promote_bow_direction),
        trill,
        ornaments,
        arpeggio,
        caesura,
        fingerings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_basic_markings_with_vendor_ext() {
        let json = r#"{
            "staccato": {},
            "accent": {"orient": "above"},
            "_x": {"viritura": {
                "trill": {"accidental": 1},
                "fingerings": [{"finger": 3}]
            }}
        }"#;
        let r: raw::EventMarkings = serde_json::from_str(json).unwrap();
        let m = promote_markings(r);
        assert!(m.staccato.is_some());
        assert!(matches!(
            m.accent.as_ref().unwrap().orient,
            Some(ModelOrientation::Above)
        ));
        assert_eq!(m.trill.as_ref().unwrap().accidental, Some(1));
        let fingerings = m.fingerings.expect("fingerings present");
        assert_eq!(fingerings[0].finger, 3);
    }

    #[test]
    fn promotes_fermata() {
        let json = r#"{"symbol":"angled","duration":"long"}"#;
        let r: raw::Fermata = serde_json::from_str(json).unwrap();
        let f = promote_fermata(r);
        assert!(matches!(f.symbol, Some(ModelFermataSymbol::Angled)));
        assert!(matches!(f.duration, Some(ModelFermataDuration::Long)));
    }

    #[test]
    fn promotes_tie() {
        let json = r#"{"target":"n1","side":"up"}"#;
        let r: raw::Tie = serde_json::from_str(json).unwrap();
        let t = promote_tie(r);
        assert_eq!(t.target.as_deref(), Some("n1"));
        assert_eq!(t.side.as_deref(), Some("up"));
    }
}
