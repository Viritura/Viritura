#[derive(Clone, Hash)]
pub(in crate::layout) enum FlatLabel {
    Literal(String),
    Part {
        part_index: usize,
        reference: Option<crate::raw::LabelRefType>,
        base_name: bool,
    },
}
