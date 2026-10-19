use super::super::element_id;
use crate::model::Note;
use crate::render::{smufl::smufl, DisplayList, ElementKind, RenderCommand};

pub(super) fn render_note_markings(
    dl: &mut DisplayList,
    event_id: &str,
    note: &Note,
    note_index: usize,
    note_edges: (f64, f64),
    y: f64,
    sp: f64,
) {
    let Some(markings) = note.markings.as_ref() else {
        return;
    };
    let notehead_id = element_id::source_notehead(event_id, Some(note), note_index);
    for (key, codepoint, incoming) in [
        (
            "slideIn",
            markings
                .slide_in
                .as_ref()
                .map(|marking| smufl::slide_in_glyph(marking.type_)),
            true,
        ),
        (
            "slideOut",
            markings
                .slide_out
                .as_ref()
                .map(|marking| smufl::slide_out_glyph(marking.type_)),
            false,
        ),
    ] {
        let Some(codepoint) = codepoint else {
            continue;
        };
        let (left, _, width, _) = smufl::glyph_bbox(codepoint);
        // Bravura's slide glyph origins align the note-adjacent end with the note's baseline.
        let x = if incoming {
            note_edges.0 - (smufl::NOTE_SLIDE_GAP_SP + left + width) * sp
        } else {
            note_edges.1 + (smufl::NOTE_SLIDE_GAP_SP - left) * sp
        };
        let command_index = dl.commands.len();
        dl.push(RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            font: "Bravura".into(),
            size: 4.0 * sp,
            color: "#000000".into(),
            rotation: 0.0,
        });
        let marking_id = element_id::note_marking(&notehead_id, key);
        dl.tag_command(command_index, marking_id.clone());
        dl.push_shape_cmd(
            command_index,
            marking_id,
            ElementKind::NoteMarking,
            None,
            None,
        );
    }
}
