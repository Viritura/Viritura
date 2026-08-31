use viritura_engine::layout::config::LayoutConfig;
use viritura_engine::layout::layout_score;
use viritura_engine::parse::parse_mnx;
use viritura_engine::render::*;

fn main() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"side": "up", "target": "ev4"}]},
                {"id": "ev2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev4", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    for (i, cmd) in dl.commands.iter().enumerate() {
        match cmd {
            RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                icx1,
                icy1,
                icx2,
                icy2,
                ocx1,
                ocy1,
                ocx2,
                ocy2,
                ..
            } => {
                println!(
                    "Bezier cmd[{}]: x1={:.2} y1={:.2}  x2={:.2} y2={:.2}",
                    i, x1, y1, x2, y2
                );
                println!("  ICP: ({:.2},{:.2}) ({:.2},{:.2})", icx1, icy1, icx2, icy2);
                println!("  OCP: ({:.2},{:.2}) ({:.2},{:.2})", ocx1, ocy1, ocx2, ocy2);
            }
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } => {
                if *codepoint >= 0xE0A0 && *codepoint <= 0xE0AF {
                    println!(
                        "Notehead cmd[{}]: x={:.2} y={:.2} cp={:X}",
                        i, x, y, codepoint
                    );
                }
            }
            _ => {}
        }
    }
}
