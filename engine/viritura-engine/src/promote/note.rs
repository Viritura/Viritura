//! Promote MNX `note` + `kit-note` objects.
//!
//! Pitched notes carry `pitch`; kit notes carry `kitComponent` and the model
//! gets a placeholder C4 pitch (callers know to look at `kit_component`).

use crate::model::event::{Note as ModelNote, Written as ModelWritten};
use crate::model::pitch::Pitch as ModelPitch;
use crate::promote::articulation::{promote_accidental_display, promote_tie};
use crate::promote::kit::promote_perform_options;
use crate::promote::pitch::promote_pitch;
use crate::raw;

fn placeholder_pitch() -> ModelPitch {
    ModelPitch {
        step: "C".into(),
        octave: 4,
        alter: None,
    }
}

pub(crate) fn promote_written(r: raw::Written) -> ModelWritten {
    ModelWritten {
        diatonic_delta: r.diatonic_delta.map(|d| i32::try_from(*d).unwrap_or(0)),
    }
}

pub(crate) fn promote_note(r: raw::Note) -> ModelNote {
    ModelNote {
        pitch: promote_pitch(r.pitch),
        id: r.id.map(String::from),
        ties: r
            .ties
            .map(|list| list.0.into_iter().map(promote_tie).collect()),
        accidental_display: r.accidental_display.map(promote_accidental_display),
        written: r.written.map(promote_written),
        staff: r.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        kit_component: None,
        perform: r.perform.map(promote_perform_options),
        source_part_index: None,
        source_event_id: None,
        source_note_index: None,
    }
}

pub(crate) fn promote_kit_note_to_note(r: raw::KitNote) -> ModelNote {
    ModelNote {
        pitch: placeholder_pitch(),
        id: r.id.map(String::from),
        ties: r
            .ties
            .map(|list| list.0.into_iter().map(promote_tie).collect()),
        accidental_display: None,
        written: None,
        staff: r.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        kit_component: Some(String::from(r.kit_component)),
        perform: r.perform.map(promote_perform_options),
        source_part_index: None,
        source_event_id: None,
        source_note_index: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_pitched_note() {
        let json = r#"{"pitch":{"step":"E","octave":4},"id":"n1"}"#;
        let r: raw::Note = serde_json::from_str(json).unwrap();
        let n = promote_note(r);
        assert_eq!(n.pitch.step, "E");
        assert_eq!(n.id.as_deref(), Some("n1"));
        assert!(n.kit_component.is_none());
    }

    #[test]
    fn promotes_kit_note_with_placeholder() {
        let json = r#"{"kitComponent":"snare","id":"k1"}"#;
        let r: raw::KitNote = serde_json::from_str(json).unwrap();
        let n = promote_kit_note_to_note(r);
        assert_eq!(n.kit_component.as_deref(), Some("snare"));
        assert_eq!(n.pitch.step, "C");
        assert_eq!(n.pitch.octave, 4);
    }
}
