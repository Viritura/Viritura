use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub use crate::raw_viritura::{
    FretboardFirstFretLocation as FretboardLabelLocation, FretboardNoteBarre as BarreEndpoint,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fretboard {
    pub part_id: String,
    pub frame_strings: i64,
    pub frame_frets: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_fret: Option<FirstFret>,
    pub frame_notes: Vec<FretboardNote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unplayed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FirstFret {
    pub fret: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<FretboardLabelLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FretboardNote {
    pub string: i64,
    pub fret: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingering: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub barre: Option<BarreEndpoint>,
}

impl Fretboard {
    pub fn first(&self) -> i64 {
        self.first_fret.as_ref().map_or(1, |first| first.fret)
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.part_id.is_empty()
            || !(2..=12).contains(&self.frame_strings)
            || !(1..=12).contains(&self.frame_frets)
            || !(1..=36).contains(&self.first())
            || self.first() + self.frame_frets - 1 > 36
        {
            return Err("Invalid fretboard instrument or fret range");
        }
        let mut strings = HashSet::new();
        let mut barres: HashMap<i64, (Option<i64>, Option<i64>)> = HashMap::new();
        for note in &self.frame_notes {
            if !(1..=self.frame_strings).contains(&note.string)
                || !strings.insert(note.string)
                || (note.fret != 0
                    && !(self.first()..self.first() + self.frame_frets).contains(&note.fret))
            {
                return Err("Invalid fretboard string or stopped position");
            }
            if let Some(endpoint) = note.barre {
                if note.fret == 0 {
                    return Err("An open string cannot be a barre endpoint");
                }
                let pair = barres.entry(note.fret).or_default();
                let slot = match endpoint {
                    BarreEndpoint::Start => &mut pair.0,
                    BarreEndpoint::Stop => &mut pair.1,
                };
                if slot.replace(note.string).is_some() {
                    return Err("Duplicate barre endpoint");
                }
            }
        }
        for pair in barres.values() {
            if !matches!(pair, (Some(start), Some(stop)) if start > stop) {
                return Err("Unpaired or reversed barre endpoints");
            }
        }
        Ok(())
    }
}

impl From<crate::raw_viritura::Fretboard> for Fretboard {
    fn from(raw: crate::raw_viritura::Fretboard) -> Self {
        Self {
            part_id: raw.part_id.to_string(),
            frame_strings: raw.frame_strings,
            frame_frets: raw.frame_frets,
            first_fret: raw.first_fret.map(|first| FirstFret {
                fret: first.fret,
                text: first.text.map(|text| text.to_string()),
                location: first.location,
            }),
            frame_notes: raw
                .frame_notes
                .into_iter()
                .map(|note| FretboardNote {
                    string: note.string,
                    fret: note.fret,
                    fingering: note.fingering.map(|text| text.to_string()),
                    barre: note.barre,
                })
                .collect(),
            unplayed: raw.unplayed.map(|text| text.to_string()),
        }
    }
}
