use crate::model::PartMeasure;

pub(super) fn restate_clef(part: &mut PartMeasure) {
    if let Some(mut clef) = part
        .clefs
        .as_ref()
        .and_then(|clefs| {
            clefs.iter().find(|clef| {
                clef.position
                    .as_ref()
                    .is_none_or(|position| position.fraction.0 == 0)
            })
        })
        .cloned()
    {
        clef.position = None;
        part.clefs.get_or_insert_with(Vec::new).insert(0, clef);
    }
}
