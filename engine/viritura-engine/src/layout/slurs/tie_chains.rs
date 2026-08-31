use super::super::types::MeasureLayout;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResolvedTieEndpoint {
    pub(super) event_id: String,
    pub(super) note_id: Option<String>,
}

/// Note-ID tie graph shared by local and global slur passes. Event ownership
/// remains alongside note links so note-specific chord endpoints follow only
/// their own chains.
#[derive(Default)]
pub(super) struct TieChainIndex {
    note_to_event: HashMap<String, String>,
    event_notes: HashMap<String, Vec<String>>,
    incoming: HashMap<String, String>,
    outgoing: HashMap<String, String>,
}

impl TieChainIndex {
    pub(super) fn add_event<'a>(
        &mut self,
        event_id: &str,
        note_ids: impl IntoIterator<Item = &'a str>,
        links: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) {
        let owned_notes = self.event_notes.entry(event_id.to_string()).or_default();
        for note_id in note_ids {
            self.note_to_event
                .entry(note_id.to_string())
                .or_insert_with(|| event_id.to_string());
            if !owned_notes.iter().any(|existing| existing == note_id) {
                owned_notes.push(note_id.to_string());
            }
        }
        for (source_note, target_note) in links {
            self.outgoing
                .entry(source_note.to_string())
                .or_insert_with(|| target_note.to_string());
            self.incoming
                .entry(target_note.to_string())
                .or_insert_with(|| source_note.to_string());
        }
    }

    pub(super) fn has_incoming_event(&self, event_id: &str) -> bool {
        self.event_notes
            .get(event_id)
            .is_some_and(|notes| notes.iter().any(|note| self.incoming.contains_key(note)))
    }

    pub(super) fn resolve(
        &self,
        event_id: &str,
        authored_note_id: Option<&str>,
        toward_start: bool,
    ) -> ResolvedTieEndpoint {
        let links = if toward_start {
            &self.incoming
        } else {
            &self.outgoing
        };
        let start_note = authored_note_id.map(str::to_string).or_else(|| {
            self.event_notes
                .get(event_id)
                .and_then(|notes| notes.iter().find(|note| links.contains_key(*note)).cloned())
        });
        let Some(mut note_id) = start_note else {
            return ResolvedTieEndpoint {
                event_id: event_id.to_string(),
                note_id: authored_note_id.map(str::to_string),
            };
        };

        let mut visited = HashSet::from([note_id.clone()]);
        for _ in 0..64 {
            let Some(next) = links.get(&note_id) else {
                break;
            };
            if !visited.insert(next.clone()) {
                break;
            }
            note_id.clone_from(next);
        }
        ResolvedTieEndpoint {
            event_id: self
                .note_to_event
                .get(&note_id)
                .cloned()
                .unwrap_or_else(|| event_id.to_string()),
            note_id: Some(note_id),
        }
    }

    /// Resolve a slur target according to connector semantics. Phrase slurs
    /// encompass a forward tie chain, but a grace-to-principal slur is a local
    /// gesture and terminates at the first principal notehead.
    pub(super) fn resolve_slur_target(
        &self,
        event_id: &str,
        authored_note_id: Option<&str>,
        source_is_grace: bool,
    ) -> ResolvedTieEndpoint {
        if source_is_grace {
            ResolvedTieEndpoint {
                event_id: event_id.to_string(),
                note_id: authored_note_id.map(str::to_string),
            }
        } else {
            self.resolve(event_id, authored_note_id, false)
        }
    }
}

pub(super) fn build_tie_chain_index(measure_layouts: &[MeasureLayout]) -> TieChainIndex {
    let mut index = TieChainIndex::default();
    for measure in measure_layouts {
        for voice in &measure.voice_layouts {
            for event_index in 0..voice.events.len() {
                if let Some(event_id) = voice.events.id(event_index) {
                    let notes = voice.events.event(event_index).notes();
                    index.add_event(
                        event_id,
                        notes.iter().filter_map(|note| note.id.as_deref()),
                        notes.iter().flat_map(note_tie_links),
                    );
                }
                for grace in voice.events.grace_notes(event_index) {
                    let Some(event_id) = grace.id.as_deref() else {
                        continue;
                    };
                    let notes = grace.event.notes();
                    index.add_event(
                        event_id,
                        notes.iter().filter_map(|note| note.id.as_deref()),
                        notes.iter().flat_map(note_tie_links),
                    );
                }
            }
        }
    }
    index
}

fn note_tie_links(note: &crate::model::Note) -> impl Iterator<Item = (&str, &str)> {
    let source = note.id.as_deref();
    note.ties
        .iter()
        .flatten()
        .filter_map(move |tie| Some((source?, tie.target.as_deref()?)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain_index() -> TieChainIndex {
        let mut index = TieChainIndex::default();
        index.add_event("event-a", ["note-a"], [("note-a", "note-b")]);
        index.add_event("event-b", ["note-b"], [("note-b", "note-c")]);
        index.add_event("event-c", ["note-c"], []);
        index
    }

    #[test]
    fn resolves_source_to_chain_start_and_target_to_chain_end() {
        let index = chain_index();
        assert_eq!(
            index.resolve("event-b", Some("note-b"), true),
            ResolvedTieEndpoint {
                event_id: "event-a".to_string(),
                note_id: Some("note-a".to_string()),
            }
        );
        assert_eq!(
            index.resolve("event-b", Some("note-b"), false),
            ResolvedTieEndpoint {
                event_id: "event-c".to_string(),
                note_id: Some("note-c".to_string()),
            }
        );
    }

    #[test]
    fn note_specific_chord_endpoint_follows_only_its_chain() {
        let mut index = chain_index();
        index.add_event("chord", ["untied", "tied"], [("tied", "note-a")]);
        assert_eq!(
            index.resolve("chord", Some("untied"), false),
            ResolvedTieEndpoint {
                event_id: "chord".to_string(),
                note_id: Some("untied".to_string()),
            }
        );
        assert_eq!(
            index.resolve("chord", Some("tied"), false).event_id,
            "event-c"
        );
    }

    #[test]
    fn grace_slur_target_stays_at_tie_chain_start() {
        let index = chain_index();
        assert_eq!(
            index.resolve_slur_target("event-a", Some("note-a"), true),
            ResolvedTieEndpoint {
                event_id: "event-a".to_string(),
                note_id: Some("note-a".to_string()),
            }
        );
        assert_eq!(
            index
                .resolve_slur_target("event-a", Some("note-a"), false)
                .event_id,
            "event-c"
        );
    }

    #[test]
    fn malformed_cycle_terminates_at_first_repeated_edge() {
        let mut index = TieChainIndex::default();
        index.add_event("event-a", ["note-a"], [("note-a", "note-b")]);
        index.add_event("event-b", ["note-b"], [("note-b", "note-a")]);
        let first = index.resolve("event-a", Some("note-a"), false);
        assert_eq!(first, index.resolve("event-a", Some("note-a"), false));
        assert_eq!(first.note_id.as_deref(), Some("note-b"));
    }
}
