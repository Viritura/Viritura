use super::super::element_id;
use crate::model::Note;
use crate::render::{DisplayList, ElementKind, RenderCommand};

/// Draw note-local slide curves near the corresponding notehead. Their
/// selectable command bounds also become obstacles for later slur placement.
pub(super) fn render_note_markings(
    dl: &mut DisplayList,
    event_id: &str,
    note: &Note,
    note_index: usize,
    x: f64,
    y: f64,
    sp: f64,
) {
    let Some(markings) = note.markings.as_ref() else {
        return;
    };
    if let Some(slide_in) = markings.slide_in.as_ref() {
        draw_mark(
            dl,
            event_id,
            note,
            note_index,
            "slideIn",
            x,
            y,
            sp,
            slide_in.type_,
        );
    }
    if let Some(slide_out) = markings.slide_out.as_ref() {
        draw_mark(
            dl,
            event_id,
            note,
            note_index,
            "slideOut",
            x,
            y,
            sp,
            slide_out.type_,
        );
    }
}

#[derive(Clone, Copy)]
enum SlideDirection {
    Scoop,
    Plop,
    Falloff,
    Doit,
}

impl From<crate::model::note_markings::SlideInType> for SlideDirection {
    fn from(value: crate::model::note_markings::SlideInType) -> Self {
        match value {
            crate::model::note_markings::SlideInType::Scoop => Self::Scoop,
            crate::model::note_markings::SlideInType::Plop => Self::Plop,
        }
    }
}

impl From<crate::model::note_markings::SlideOutType> for SlideDirection {
    fn from(value: crate::model::note_markings::SlideOutType) -> Self {
        match value {
            crate::model::note_markings::SlideOutType::Falloff => Self::Falloff,
            crate::model::note_markings::SlideOutType::Doit => Self::Doit,
        }
    }
}

#[allow(clippy::too_many_arguments)] // all four curves share this one note-relative geometry emitter
fn draw_mark<T: Into<SlideDirection>>(
    dl: &mut DisplayList,
    event_id: &str,
    note: &Note,
    note_index: usize,
    key: &str,
    x: f64,
    y: f64,
    sp: f64,
    kind: T,
) {
    let (start_x, start_y, control1_x, control1_y, control2_x, control2_y, end_x, end_y) =
        match kind.into() {
            SlideDirection::Scoop => (
                x - 1.15 * sp,
                y + 1.0 * sp,
                x - 0.65 * sp,
                y + 0.95 * sp,
                x - 0.35 * sp,
                y + 0.35 * sp,
                x - 0.05 * sp,
                y + 0.2 * sp,
            ),
            SlideDirection::Plop => (
                x - 1.15 * sp,
                y - 1.0 * sp,
                x - 0.65 * sp,
                y - 0.95 * sp,
                x - 0.35 * sp,
                y - 0.35 * sp,
                x - 0.05 * sp,
                y - 0.2 * sp,
            ),
            SlideDirection::Falloff => (
                x + 0.05 * sp,
                y + 0.2 * sp,
                x + 0.35 * sp,
                y + 0.35 * sp,
                x + 0.65 * sp,
                y + 0.95 * sp,
                x + 1.15 * sp,
                y + 1.0 * sp,
            ),
            SlideDirection::Doit => (
                x + 0.05 * sp,
                y - 0.2 * sp,
                x + 0.35 * sp,
                y - 0.35 * sp,
                x + 0.65 * sp,
                y - 0.95 * sp,
                x + 1.15 * sp,
                y - 1.0 * sp,
            ),
        };
    let command_index = dl.commands.len();
    dl.push(RenderCommand::DrawBezier {
        x1: start_x,
        y1: start_y,
        cx1: control1_x,
        cy1: control1_y,
        cx2: control2_x,
        cy2: control2_y,
        x2: end_x,
        y2: end_y,
        width: 0.11 * sp,
        color: "#000000".into(),
    });
    let notehead_id = element_id::source_notehead(event_id, Some(note), note_index);
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
