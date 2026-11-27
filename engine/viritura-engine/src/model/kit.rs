//! Drum-kit / unpitched percussion model (MNX `kit`, `sound`, `kit-component`,
//! `kit-note`, `perform-options`).
//!
//! Noteheads are native MNX objects on notes, kit notes, and kit components.

use serde::{Deserialize, Serialize};

/// A GM MIDI sound entry (MNX `sound`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    /// GM MIDI program/note number (drum keys are MIDI numbers on channel 10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub midi_number: Option<i32>,
    /// Human-readable name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// MNX `perform-options` — currently a stub object. Round-tripped only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// Notehead shape used by the engraving engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NoteheadShape {
    #[default]
    Normal,
    X,
    CircleX,
    Circled,
    Slashed,
    BackSlashed,
    Diamond,
    Slash,
    TriangleUp,
    TriangleDown,
    Plus,
    Square,
    /// Native MNX custom notehead resolved to a Bravura codepoint; zero means
    /// the glyph is unsupported and the standard duration notehead is used.
    Custom(u32),
}

impl Serialize for NoteheadShape {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(match self {
            Self::Normal => "normal",
            Self::X => "x",
            Self::CircleX => "circleX",
            Self::Circled => "circled",
            Self::Slashed => "slashed",
            Self::BackSlashed => "backSlashed",
            Self::Diamond => "diamond",
            Self::Slash => "slash",
            Self::TriangleUp => "triangleUp",
            Self::TriangleDown => "triangleDown",
            Self::Plus => "plus",
            Self::Square => "square",
            Self::Custom(_) => "custom",
        })
    }
}

impl<'de> Deserialize<'de> for NoteheadShape {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "normal" => Ok(Self::Normal),
            "x" => Ok(Self::X),
            "circleX" => Ok(Self::CircleX),
            "circled" => Ok(Self::Circled),
            "slashed" => Ok(Self::Slashed),
            "backSlashed" => Ok(Self::BackSlashed),
            "diamond" => Ok(Self::Diamond),
            "slash" => Ok(Self::Slash),
            "triangleUp" => Ok(Self::TriangleUp),
            "triangleDown" => Ok(Self::TriangleDown),
            "plus" => Ok(Self::Plus),
            "square" => Ok(Self::Square),
            "custom" => Ok(Self::Custom(0)),
            _ => Err(serde::de::Error::unknown_variant(
                &value,
                &[
                    "normal",
                    "x",
                    "circleX",
                    "circled",
                    "slashed",
                    "backSlashed",
                    "diamond",
                    "slash",
                    "triangleUp",
                    "triangleDown",
                    "plus",
                    "square",
                    "custom",
                ],
            )),
        }
    }
}

pub(crate) fn native_notehead(
    shape: Option<NoteheadShape>,
    original: &Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>, &'static str> {
    let Some(shape) = shape else {
        return Ok(None);
    };
    let name = match shape {
        NoteheadShape::Normal => "oval",
        NoteheadShape::X => "x",
        NoteheadShape::CircleX => "circleX",
        NoteheadShape::Circled => "circled",
        NoteheadShape::Slashed => "slashed",
        NoteheadShape::BackSlashed => "backSlashed",
        NoteheadShape::Diamond => "diamond",
        NoteheadShape::Slash => "slash",
        NoteheadShape::TriangleUp => "triangle",
        NoteheadShape::TriangleDown => "triangleDown",
        NoteheadShape::Plus => "plus",
        NoteheadShape::Square => "square",
        NoteheadShape::Custom(_) => "custom",
    };
    if let Some(value) = original {
        if value.get("shape").and_then(serde_json::Value::as_str) == Some(name) {
            return Ok(Some(value.clone()));
        }
    }
    if matches!(shape, NoteheadShape::Custom(_)) {
        return Err("custom notehead requires its original SMuFL glyph");
    }
    Ok(Some(serde_json::json!({ "shape": name })))
}

/// A single drum/percussion instrument on a staff (MNX `kit-component`).
/// The component ID is the key in the `Part.kit` HashMap — not a field here.
#[derive(Debug, Clone, PartialEq)]
pub struct KitComponent {
    pub name: Option<String>,
    pub sound: Option<String>,
    pub staff_position: i32,
    /// Resolved native MNX notehead.
    pub notehead: Option<NoteheadShape>,
    /// Original native object, including glyph and global attributes.
    pub notehead_wire: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KitComponentRaw {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sound: Option<String>,
    staff_position: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notehead: Option<serde_json::Value>,
}

impl Serialize for KitComponent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let raw = KitComponentRaw {
            name: self.name.clone(),
            sound: self.sound.clone(),
            staff_position: self.staff_position,
            notehead: native_notehead(self.notehead, &self.notehead_wire)
                .map_err(serde::ser::Error::custom)?,
        };
        raw.serialize(serializer)
    }
}

// KitComponent: model-internal type. Construction goes through
// `promote::kit::promote_kit_component`. See `docs/spec/data-model-pipeline.md`.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_kit_component_notehead() {
        let c = KitComponent {
            name: Some("Kick".into()),
            sound: Some("snd-kick".into()),
            staff_position: -4,
            notehead: Some(NoteheadShape::Diamond),
            notehead_wire: None,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains(r#""notehead":{"shape":"diamond"}"#));
    }

    #[test]
    fn parse_sound() {
        let json = r#"{"midiNumber":35,"name":"Bass Drum 1"}"#;
        let s: Sound = serde_json::from_str(json).unwrap();
        assert_eq!(s.midi_number, Some(35));
        assert_eq!(s.name.as_deref(), Some("Bass Drum 1"));
    }
}
