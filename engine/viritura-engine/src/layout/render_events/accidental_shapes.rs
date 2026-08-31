use crate::layout::element_id;
use crate::model::AccidentalEnclosure;
use crate::render::{BoundingBox, DisplayList, ElementBBox, ElementKind};

/// One accidental awaiting placement: which note of the chord it qualifies,
/// where that note sits, and the glyph to draw for it.
pub(super) struct AccidentalPlacement {
    /// Index of the note within the chord. Names the accidental's element id,
    /// so a click can be resolved back to the note whose pitch it spells.
    pub note_index: usize,
    /// Staff position of the note, in half-spaces.
    pub pos: f64,
    /// Baseline y of the note, in pixels.
    pub note_y: f64,
    /// Chromatic alteration the glyph spells.
    pub alter: i32,
    /// SMuFL codepoint of the accidental glyph.
    pub codepoint: u32,
    /// Parentheses or brackets around the accidental, when editorial.
    pub enclosure: Option<AccidentalEnclosure>,
}

/// Register an accidental glyph in the shape registry for collision work.
pub(super) fn register_accidental_shape(
    display_list: &mut DisplayList,
    command_index: usize,
    event_id: Option<&str>,
    accidental_index: usize,
    component: &str,
) {
    display_list.push_shape_cmd(
        command_index,
        format!(
            "{}/accidental/{accidental_index}/{component}",
            event_id.unwrap_or("")
        ),
        ElementKind::Accidental,
        None,
        None,
    );
}

/// Tag every command of one placed accidental with its own element id and
/// publish the union of their boxes.
///
/// Without this the commands fall through to the event-wide backfill in
/// `render_measure`, which is what used to make an accidental unselectable
/// apart from its event. The bbox spans the accidental glyph and any
/// enclosure, so clicking a parenthesis selects the accidental it belongs to.
pub(super) fn tag_accidental(
    display_list: &mut DisplayList,
    command_indices: &[usize],
    event_element_id: &str,
    note_index: usize,
) {
    let id = element_id::accidental(event_element_id, note_index);
    let mut bounds: Option<BoundingBox> = None;
    for &command_index in command_indices {
        display_list.tag_command(command_index, id.clone());
        if let Some(bbox) = display_list.commands[command_index].bbox() {
            bounds = Some(match bounds {
                Some(acc) => union(&acc, &bbox),
                None => bbox,
            });
        }
    }
    if let Some(bbox) = bounds {
        display_list.push_element_bbox_with_shape(ElementBBox {
            element_id: id,
            bbox,
        });
    }
}

fn union(a: &BoundingBox, b: &BoundingBox) -> BoundingBox {
    let x = a.x.min(b.x);
    let y = a.y.min(b.y);
    BoundingBox::new(
        x,
        y,
        (a.x + a.width).max(b.x + b.width) - x,
        (a.y + a.height).max(b.y + b.height) - y,
    )
}
