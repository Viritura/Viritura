//! Resolve a text-frame locator to one of the final paginated pages.
//!
//! Page locators index the finished page list directly (title and blank
//! leaves included). Musical locators follow the music through reflow: the
//! frame lands on whichever page currently holds the measure, or the measure
//! that contains the event. A measure folded into a multimeasure rest resolves
//! to the page of the rest that absorbed it.

use crate::model::{Event, Score, SequenceContent, TextFrameLocator};
use crate::render::PageLayout;

pub(super) struct PageResolver<'a> {
    score: &'a Score,
    pages: &'a [PageLayout],
    /// `(global measure index, system index)` for every rendered measure.
    measure_systems: &'a [(usize, usize)],
}

impl<'a> PageResolver<'a> {
    pub(super) fn new(
        score: &'a Score,
        pages: &'a [PageLayout],
        measure_systems: &'a [(usize, usize)],
    ) -> Self {
        Self {
            score,
            pages,
            measure_systems,
        }
    }

    pub(super) fn page_for(&self, locator: &TextFrameLocator) -> Option<usize> {
        match locator {
            TextFrameLocator::Page { page_index } => {
                (*page_index < self.pages.len()).then_some(*page_index)
            }
            TextFrameLocator::GlobalMeasure { measure_id } => {
                self.page_for_measure_index(self.measure_index(measure_id)?)
            }
            TextFrameLocator::Event { part_id, event_id } => {
                self.page_for_measure_index(self.event_measure_index(part_id, event_id)?)
            }
        }
    }

    fn measure_index(&self, id: &str) -> Option<usize> {
        self.score
            .global
            .measures
            .iter()
            .position(|measure| measure.id.as_deref() == Some(id))
    }

    fn event_measure_index(&self, part_id: &str, event_id: &str) -> Option<usize> {
        let part = self
            .score
            .parts
            .iter()
            .find(|part| part.id.as_deref() == Some(part_id))?;
        part.measures.iter().position(|measure| {
            measure
                .sequences
                .iter()
                .any(|sequence| content_holds_event(&sequence.content, event_id))
        })
    }

    fn page_for_measure_index(&self, index: usize) -> Option<usize> {
        let (_, system) = self
            .measure_systems
            .iter()
            .filter(|(measure, _)| *measure <= index)
            .max_by_key(|(measure, _)| *measure)?;
        self.pages
            .iter()
            .position(|page| page.system_indices.contains(system))
    }
}

fn content_holds_event(content: &[SequenceContent], id: &str) -> bool {
    content.iter().any(|item| match item {
        SequenceContent::Event(event) => event_has_id(event, id),
        SequenceContent::Tuplet(tuplet) => content_holds_event(&tuplet.content, id),
        SequenceContent::Grace(grace) => grace.content.iter().any(|event| event_has_id(event, id)),
        SequenceContent::MultiNoteTremolo(tremolo) => {
            tremolo.content.iter().any(|event| event_has_id(event, id))
        }
        SequenceContent::Space(_) | SequenceContent::Other(_) => false,
    })
}

fn event_has_id(event: &Event, id: &str) -> bool {
    event.id.as_deref() == Some(id)
}
