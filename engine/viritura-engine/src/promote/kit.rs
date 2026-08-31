//! Promote MNX kit / sound / kit-component objects.
//!
//! The notehead vendor extension (`_x.viritura.notehead` on a kit
//! component) is hoisted onto `KitComponent.notehead` — replacing the
//! custom `Deserialize` impl on the model.

use crate::model::kit::{KitComponent, NoteheadShape, PerformOptions, Sound};
use crate::promote::vendor_ext::read_viritura_ext;
use crate::raw;

pub(crate) fn promote_sound(raw: raw::Sound) -> Sound {
    Sound {
        midi_number: raw.midi_number.map(|n| i32::try_from(n.0).unwrap_or(0)),
        name: raw.name.map(|n| n.0),
        id: raw.id.map(|i| i.to_string()),
    }
}

pub(crate) fn promote_kit_component(raw: raw::KitComponent) -> KitComponent {
    let notehead = read_viritura_ext(raw.x.as_ref())
        .and_then(|v| v.get("notehead"))
        .and_then(|v| v.as_str())
        .and_then(parse_notehead_shape);
    KitComponent {
        name: raw.name.map(|n| n.0),
        sound: raw.sound.map(|id| id.to_string()),
        staff_position: i32::try_from(raw.staff_position.0).unwrap_or(0),
        notehead,
    }
}

fn parse_notehead_shape(s: &str) -> Option<NoteheadShape> {
    Some(match s {
        "normal" => NoteheadShape::Normal,
        "x" => NoteheadShape::X,
        "circleX" => NoteheadShape::CircleX,
        "diamond" => NoteheadShape::Diamond,
        "slash" => NoteheadShape::Slash,
        "triangleUp" => NoteheadShape::TriangleUp,
        "triangleDown" => NoteheadShape::TriangleDown,
        _ => return None,
    })
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
    fn promotes_kit_component_with_notehead_ext() {
        let json = r#"{
            "name":"Hi-hat","sound":"snd-hihat","staffPosition":5,
            "_x":{"viritura":{"notehead":"x"}}
        }"#;
        let raw: raw::KitComponent = serde_json::from_str(json).unwrap();
        let promoted = promote_kit_component(raw);
        assert_eq!(promoted.notehead, Some(crate::model::kit::NoteheadShape::X));
        assert_eq!(promoted.name.as_deref(), Some("Hi-hat"));
    }

    #[test]
    fn promotes_sound() {
        let json = r#"{"midiNumber":35,"name":"Bass Drum 1"}"#;
        let raw: raw::Sound = serde_json::from_str(json).unwrap();
        let direct: Sound = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_sound(raw));
    }
}
