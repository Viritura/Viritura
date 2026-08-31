use crate::model::Note;
use std::collections::HashSet;

pub(super) fn is_suppressed_tied_accidental(
    note: &Note,
    suppressed_note_ids: Option<&HashSet<String>>,
) -> bool {
    note.accidental_display.is_none()
        && note
            .id
            .as_ref()
            .is_some_and(|id| suppressed_note_ids.is_some_and(|ids| ids.contains(id)))
}
