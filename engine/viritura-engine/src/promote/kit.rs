//! Promote MNX kit / sound / kit-component objects.

use crate::model::kit::{KitComponent, NoteheadShape, PerformOptions, Sound};
use crate::raw;

pub(crate) fn promote_sound(raw: raw::Sound) -> Sound {
    Sound {
        midi_number: raw.midi_number.map(|n| i32::try_from(n.0).unwrap_or(0)),
        name: raw.name.map(|n| n.0),
        id: raw.id.map(|i| i.to_string()),
    }
}

pub(crate) fn promote_kit_component(raw: raw::KitComponent) -> KitComponent {
    let notehead = raw.notehead.as_ref().and_then(promote_native_notehead);
    let notehead_wire = raw
        .notehead
        .as_ref()
        .map(|value| serde_json::to_value(value).expect("native notehead is JSON serializable"));
    KitComponent {
        name: raw.name.map(|n| n.0),
        sound: raw.sound.map(|id| id.to_string()),
        staff_position: i32::try_from(raw.staff_position.0).unwrap_or(0),
        notehead,
        notehead_wire,
    }
}

pub(crate) fn promote_native_notehead(raw: &raw::Notehead) -> Option<NoteheadShape> {
    match raw.shape {
        raw::NoteheadShape::Oval => Some(NoteheadShape::Normal),
        raw::NoteheadShape::X => Some(NoteheadShape::X),
        raw::NoteheadShape::Diamond => Some(NoteheadShape::Diamond),
        raw::NoteheadShape::Triangle => Some(NoteheadShape::TriangleUp),
        raw::NoteheadShape::TriangleDown => Some(NoteheadShape::TriangleDown),
        raw::NoteheadShape::Slash => Some(NoteheadShape::Slash),
        raw::NoteheadShape::Plus => Some(NoteheadShape::Plus),
        raw::NoteheadShape::CircleX => Some(NoteheadShape::CircleX),
        raw::NoteheadShape::Circled => Some(NoteheadShape::Circled),
        raw::NoteheadShape::Slashed => Some(NoteheadShape::Slashed),
        raw::NoteheadShape::BackSlashed => Some(NoteheadShape::BackSlashed),
        raw::NoteheadShape::Square => Some(NoteheadShape::Square),
        raw::NoteheadShape::Custom => Some(NoteheadShape::Custom(
            raw.glyph
                .as_ref()
                .and_then(|glyph| crate::render::smufl::smufl::smufl_name_to_codepoint(glyph))
                .unwrap_or(0),
        )),
    }
}
/// MNX `perform-options` is currently a stub on the model side too —
/// just pass through whatever id is present.
pub(crate) fn promote_perform_options(raw: raw::PerformOptions) -> PerformOptions {
    // raw::PerformOptions is `PerformOptions(GlobalAttrs)`; GlobalAttrs has
    // optional id which we surface for round-trip parity. Skip vendor/comment.
    PerformOptions {
        id: raw.0.id.map(|i| i.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_kit_component_with_native_notehead() {
        let json = r#"{
            "name":"Hi-hat","sound":"snd-hihat","staffPosition":5,
            "notehead":{"shape":"x","id":"kit-head"}
        }"#;
        let raw: raw::KitComponent = serde_json::from_str(json).unwrap();
        let promoted = promote_kit_component(raw);
        assert_eq!(promoted.notehead, Some(crate::model::kit::NoteheadShape::X));
        assert_eq!(promoted.name.as_deref(), Some("Hi-hat"));
        assert_eq!(
            serde_json::to_value(promoted).unwrap()["notehead"],
            serde_json::json!({"shape":"x","id":"kit-head"})
        );
    }

    #[test]
    fn promotes_sound() {
        let json = r#"{"midiNumber":35,"name":"Bass Drum 1"}"#;
        let raw: raw::Sound = serde_json::from_str(json).unwrap();
        let direct: Sound = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_sound(raw));
    }
}
