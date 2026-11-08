use super::GlobalMeasure;
use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Serialize)]
pub(super) struct GlobalMeasureWire {
    #[serde(flatten)]
    fields: Map<String, Value>,
}

impl From<GlobalMeasure> for GlobalMeasureWire {
    fn from(measure: GlobalMeasure) -> Self {
        let mut fields = Map::new();
        macro_rules! field {
            ($name:literal, $value:expr) => {
                if let Some(value) = $value {
                    fields.insert(
                        $name.into(),
                        serde_json::to_value(value).expect("model field serializes"),
                    );
                }
            };
        }
        field!("caesura", measure.caesura);
        field!("id", measure.id);
        field!("number", measure.number);
        field!("time", measure.time);
        field!("key", measure.key);
        field!("barline", measure.barline);
        field!("repeatStart", measure.repeat_start);
        field!("repeatEnd", measure.repeat_end);
        field!("ending", measure.ending);
        field!("segno", measure.segno);
        field!("fine", measure.fine);
        field!("jump", measure.jump);
        field!("coda", measure.coda);

        let mut extensions = measure
            .extensions
            .map(|ext| serde_json::to_value(ext).expect("model extensions serialize"))
            .unwrap_or_else(|| Value::Object(Map::new()));
        if let Some(tempos) = measure.tempos {
            if tempos.iter().any(|tempo| tempo.bpm.is_none()) {
                let extension = extensions
                    .as_object_mut()
                    .expect("extension object")
                    .entry("viritura")
                    .or_insert_with(|| Value::Object(Map::new()));
                extension
                    .as_object_mut()
                    .expect("Viritura extension object")
                    .insert(
                        "tempos".into(),
                        serde_json::to_value(tempos).expect("tempo instructions serialize"),
                    );
            } else {
                let values = tempos
                    .into_iter()
                    .map(|tempo| {
                        let mut value = serde_json::to_value(tempo).expect("tempo serializes");
                        let object = value.as_object_mut().expect("tempo object");
                        let mut vendor = Map::new();
                        for name in [
                            "swing",
                            "text",
                            "showMetronomeMark",
                            "showText",
                            "manualOffset",
                            "avoidCollisions",
                        ] {
                            if let Some(field) = object.remove(name) {
                                vendor.insert(name.into(), field);
                            }
                        }
                        if !vendor.is_empty() {
                            object.insert("_x".into(), serde_json::json!({"viritura": vendor}));
                        }
                        value
                    })
                    .collect();
                fields.insert("tempos".into(), Value::Array(values));
            }
        }
        if extensions
            .as_object()
            .is_some_and(|object| !object.is_empty())
        {
            fields.insert("_x".into(), extensions);
        }
        Self { fields }
    }
}
