//! Offline VST3 effect probe.
//!
//! Renders a known input signal through a VST3 audio effect entirely offline —
//! no cpal device, no mixer, no threads, no transport — and writes the result to
//! a WAV. Every step of the host load/activation sequence is a CLI toggle so the
//! cause of a silent effect (e.g. EastWest Spaces II reverb) can be bisected
//! against a known-good one (e.g. ValhallaRoom).
//!
//! The default input is a unit impulse (one sample of 1.0, then silence): for a
//! reverb, the output *is* its impulse response, so "silent output" vs "a
//! decaying tail" is unambiguous.
//!
//! Example:
//!   vst-reverb-probe --plugin "C:\\Program Files\\...\\EW Spaces II.vst3" \
//!     --state ew.bin --out ew.wav --duration 4
//!
//! Bisect flags (defaults mirror the Viritura desktop host):
//!   --host-in-channels N   host builder input_channels (default 2; app uses 0)
//!   --feed-channels N      channels allocated/filled in the input buffer (2)
//!   --no-bus-arrange       skip set_bus_arrangements(STEREO,STEREO)
//!   --no-set-playing       skip set_playing(true)
//!   --state-order early    load_state before reconfigure (default: late)
//!   --isolation            host with_process_isolation(true)
//!   --warmup SECS          sleep after activation before rendering
//!   --prime-blocks N       process N silent blocks before the measured render
//!   --prime-sleep-ms MS    wall-clock sleep between prime blocks
//!   --input FILE.wav       replay a WAV instead of the impulse
//!   --noise                0.5 s white-noise burst instead of the impulse
//!   --open-editor          open the plugin's native GUI, then feed continuous
//!                          noise while pumping its message loop until you close
//!                          the window (tests lazy content-load-on-editor-open)

use std::path::Path;

use vst3_host::audio::{write_wav, AudioBuffers, SpeakerArrangement};
use vst3_host::Vst3Host;

#[derive(Debug)]
struct Args {
    plugin: String,
    out: String,
    state: Option<String>,
    input_wav: Option<String>,
    noise: bool,
    duration: f64,
    sample_rate: f64,
    block: usize,
    host_in_channels: usize,
    feed_channels: usize,
    bus_arrange: bool,
    set_playing: bool,
    state_late: bool,
    isolation: bool,
    warmup: f64,
    prime_blocks: usize,
    prime_sleep_ms: u64,
    open_editor: bool,
    close_after: f64,
    hide_editor: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args {
        plugin: String::new(),
        out: String::new(),
        state: None,
        input_wav: None,
        noise: false,
        duration: 4.0,
        sample_rate: 48_000.0,
        block: 512,
        host_in_channels: 2,
        feed_channels: 2,
        bus_arrange: true,
        set_playing: true,
        state_late: true,
        isolation: false,
        warmup: 0.0,
        prime_blocks: 0,
        prime_sleep_ms: 0,
        open_editor: false,
        close_after: 0.0,
        hide_editor: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut next = || it.next().ok_or_else(|| format!("missing value after {arg}"));
        match arg.as_str() {
            "--plugin" => a.plugin = next()?,
            "--out" => a.out = next()?,
            "--state" => a.state = Some(next()?),
            "--input" => a.input_wav = Some(next()?),
            "--noise" => a.noise = true,
            "--duration" => a.duration = next()?.parse().map_err(|e| format!("{e}"))?,
            "--sr" => a.sample_rate = next()?.parse().map_err(|e| format!("{e}"))?,
            "--block" => a.block = next()?.parse().map_err(|e| format!("{e}"))?,
            "--host-in-channels" => a.host_in_channels = next()?.parse().map_err(|e| format!("{e}"))?,
            "--feed-channels" => a.feed_channels = next()?.parse().map_err(|e| format!("{e}"))?,
            "--no-bus-arrange" => a.bus_arrange = false,
            "--no-set-playing" => a.set_playing = false,
            "--state-order" => a.state_late = matches!(next()?.as_str(), "late"),
            "--isolation" => a.isolation = true,
            "--warmup" => a.warmup = next()?.parse().map_err(|e| format!("{e}"))?,
            "--prime-blocks" => a.prime_blocks = next()?.parse().map_err(|e| format!("{e}"))?,
            "--prime-sleep-ms" => a.prime_sleep_ms = next()?.parse().map_err(|e| format!("{e}"))?,
            "--open-editor" => a.open_editor = true,
            "--close-after" => a.close_after = next()?.parse().map_err(|e| format!("{e}"))?,
            "--hide-editor" => a.hide_editor = true,
            "-h" | "--help" => return Err("help".to_string()),
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if a.plugin.is_empty() || a.out.is_empty() {
        return Err("--plugin and --out are required".to_string());
    }
    Ok(a)
}

/// Peak absolute sample across every channel of a deinterleaved buffer.
fn peak(channels: &[Vec<f32>]) -> f32 {
    channels
        .iter()
        .flat_map(|c| c.iter())
        .fold(0.0_f32, |m, &s| m.max(s.abs()))
}

/// RMS across every channel of a deinterleaved buffer.
fn rms(channels: &[Vec<f32>]) -> f32 {
    let mut sum = 0.0_f64;
    let mut n = 0usize;
    for c in channels {
        for &s in c {
            sum += (s as f64) * (s as f64);
            n += 1;
        }
    }
    if n == 0 {
        0.0
    } else {
        (sum / n as f64).sqrt() as f32
    }
}

/// Build the full input signal `[channel][frame]` for the whole render.
fn build_input(a: &Args, total_frames: usize) -> Result<Vec<Vec<f32>>, String> {
    let ch = a.feed_channels.max(1);
    if let Some(path) = &a.input_wav {
        let (mut data, sr) = vst3_host::audio::read_wav(path).map_err(|e| format!("read_wav: {e}"))?;
        if (sr as f64 - a.sample_rate).abs() > 0.5 {
            eprintln!(
                "[warn] input WAV is {sr} Hz but rendering at {} Hz — no resampling is applied; \
                 re-export the WAV at {} Hz for accurate results",
                a.sample_rate, a.sample_rate
            );
        }
        // Pad/truncate every channel to total_frames; fan out / fold to `ch` channels.
        let mut out = vec![vec![0.0_f32; total_frames]; ch];
        for (c, dst) in out.iter_mut().enumerate() {
            let src = &data.get(c % data.len().max(1)).cloned().unwrap_or_default();
            let n = total_frames.min(src.len());
            dst[..n].copy_from_slice(&src[..n]);
        }
        data.clear();
        return Ok(out);
    }

    let mut out = vec![vec![0.0_f32; total_frames]; ch];
    if a.noise {
        // 0.5 s of deterministic white noise, then silence — a broadband burst so
        // the reverb tail is easy to see. Simple xorshift so there are no deps.
        let burst = ((a.sample_rate * 0.5) as usize).min(total_frames);
        let mut state: u32 = 0x1234_5678;
        for f in 0..burst {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            let v = (state as f32 / u32::MAX as f32) * 2.0 - 1.0;
            for c in out.iter_mut() {
                c[f] = v * 0.5;
            }
        }
    } else {
        // Unit impulse: one full-scale sample on every channel, then silence.
        for c in out.iter_mut() {
            if !c.is_empty() {
                c[0] = 1.0;
            }
        }
    }
    Ok(out)
}

fn run() -> Result<(), String> {
    let a = parse_args()?;
    println!("=== vst-reverb-probe ===");
    println!(
        "plugin={}\n  sr={} block={} duration={}s host_in_channels={} feed_channels={}",
        a.plugin, a.sample_rate, a.block, a.duration, a.host_in_channels, a.feed_channels
    );
    println!(
        "  bus_arrange={} set_playing={} state_order={} isolation={} state={:?} input={}",
        a.bus_arrange,
        a.set_playing,
        if a.state_late { "late" } else { "early" },
        a.isolation,
        a.state.as_deref().unwrap_or("<none>"),
        a.input_wav.as_deref().unwrap_or(if a.noise { "<noise>" } else { "<impulse>" }),
    );

    let state_bytes = match &a.state {
        Some(p) => Some(std::fs::read(p).map_err(|e| format!("read state {p}: {e}"))?),
        None => None,
    };

    // Build the host exactly like the app does (input_channels is the key variable
    // — the desktop app currently uses 0 for the reverb).
    let mut host = Vst3Host::builder()
        .sample_rate(a.sample_rate)
        .block_size(a.block)
        .input_channels(a.host_in_channels)
        .output_channels(2)
        .with_process_isolation(a.isolation)
        .build()
        .map_err(|e| format!("host build: {e}"))?;

    let mut plugin = host.load_plugin(&a.plugin).map_err(|e| format!("load_plugin: {e}"))?;
    println!("loaded '{}'", plugin.info().name);

    // --- load_state EARLY variant (mirrors the pre-fix instrument ordering) ---
    if !a.state_late {
        if let Some(bytes) = &state_bytes {
            plugin.load_state(bytes).map_err(|e| format!("load_state(early): {e}"))?;
            println!("state: applied early (before reconfigure)");
        }
    }

    plugin
        .reconfigure(a.sample_rate, a.block)
        .map_err(|e| format!("reconfigure: {e}"))?;

    if a.bus_arrange {
        let arr = vec![SpeakerArrangement::STEREO];
        match plugin.set_bus_arrangements(&arr, &arr) {
            Ok(()) => println!("set_bus_arrangements(STEREO, STEREO): ok"),
            Err(e) => println!("set_bus_arrangements failed: {e} (continuing with default layout)"),
        }
    } else {
        println!("set_bus_arrangements: SKIPPED");
    }

    plugin.start_processing().map_err(|e| format!("start_processing: {e}"))?;

    if a.set_playing {
        let _ = plugin.set_playing(true);
        println!("set_playing(true): sent");
    } else {
        println!("set_playing: SKIPPED");
    }

    // --- load_state LATE variant (mirrors the current reverb ordering) ---
    if a.state_late {
        if let Some(bytes) = &state_bytes {
            match plugin.load_state(bytes) {
                Ok(()) => println!("state: applied late (after activation)"),
                Err(e) => println!("load_state(late) failed: {e} (keeping default patch)"),
            }
        }
    }

    let info = plugin.info();
    let arrangements = plugin.bus_arrangements();
    println!(
        "info: audio_inputs={} audio_outputs={} latency={} samples",
        info.audio_inputs,
        info.audio_outputs,
        plugin.latency_samples()
    );
    println!(
        "arrangement: in={:?} out={:?}",
        arrangements.as_ref().map(|x| &x.inputs),
        arrangements.as_ref().map(|x| &x.outputs)
    );

    let out_channels = plugin.output_channel_count().max(1);
    let total_frames = (a.duration * a.sample_rate).round() as usize;
    let input = build_input(&a, total_frames)?;
    let in_channels = input.len();

    // Warm-up: give any background IR/sample streaming thread wall-clock time to
    // finish loading before we measure. EW convolution reverbs stream their
    // impulse response from disk asynchronously after activation.
    if a.warmup > 0.0 {
        println!("warmup: sleeping {:.2}s after activation before render", a.warmup);
        std::thread::sleep(std::time::Duration::from_secs_f64(a.warmup));
    }

    // Prime: process N blocks of silence before measuring, in case the effect
    // gates DSP on having processed some blocks (and to hand the loader thread
    // scheduling opportunities) without polluting the impulse response.
    if a.prime_blocks > 0 {
        for _ in 0..a.prime_blocks {
            let mut warm = AudioBuffers::new(in_channels, out_channels, a.block, a.sample_rate);
            plugin
                .process_audio(&mut warm)
                .map_err(|e| format!("process_audio (prime): {e}"))?;
            if a.prime_sleep_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(a.prime_sleep_ms));
            }
        }
        println!(
            "prime: processed {} silent block(s) before render ({}ms sleep between)",
            a.prime_blocks, a.prime_sleep_ms
        );
    }

    println!(
        "rendering {total_frames} frames — feeding {in_channels} input channel(s) into a {out_channels}-channel effect",
    );

    // --open-editor: open the plugin GUI and drive it live until the user closes
    // the window. This tests whether the effect only loads its content (e.g. an
    // impulse response) once its editor view is created.
    if a.open_editor {
        return run_with_editor(plugin, &a, out_channels, in_channels);
    }

    let mut captured: Vec<Vec<f32>> = vec![Vec::with_capacity(total_frames); out_channels];
    let mut rendered = 0usize;
    let mut block_idx = 0u64;
    // Log the first few blocks (impulse energy is front-loaded) plus ~1 Hz after.
    let log_every = ((a.sample_rate / a.block as f64).round() as u64).max(1);
    while rendered < total_frames {
        let frames = a.block.min(total_frames - rendered);
        let mut buffers = AudioBuffers::new(in_channels, out_channels, frames, a.sample_rate);
        for (c, dst) in buffers.inputs.iter_mut().enumerate() {
            let src = &input[c];
            let n = frames.min(dst.len());
            dst[..n].copy_from_slice(&src[rendered..rendered + n]);
        }
        plugin
            .process_audio(&mut buffers)
            .map_err(|e| format!("process_audio at frame {rendered}: {e}"))?;

        let in_peak = peak(&buffers.inputs);
        let out_peak = peak(&buffers.outputs);
        if block_idx < 4 || block_idx % log_every == 0 {
            println!(
                "  block {block_idx:>5} (t={:>6.3}s) in_peak={in_peak:.5} out_peak={out_peak:.5}",
                rendered as f64 / a.sample_rate
            );
        }

        for (c, dst) in captured.iter_mut().enumerate() {
            if let Some(src) = buffers.outputs.get(c) {
                dst.extend_from_slice(&src[..frames.min(src.len())]);
            }
        }
        rendered += frames;
        block_idx += 1;
    }
    let _ = plugin.stop_processing();

    let out_peak = peak(&captured);
    let out_rms = rms(&captured);
    println!("---");
    println!("output over whole render: peak={out_peak:.6} rms={out_rms:.6}");
    if out_peak < 1.0e-5 {
        println!("VERDICT: output is SILENT — the effect produced nothing.");
    } else {
        println!("VERDICT: output has signal — the effect is producing audio.");
    }

    write_wav(Path::new(&a.out), &captured, a.sample_rate as u32).map_err(|e| format!("write_wav: {e}"))?;
    println!("wrote {}", a.out);
    Ok(())
}

/// Open the plugin's native editor and drive it with live audio until the user
/// closes the window. Pumps the editor's Win32 message loop between audio blocks
/// so the GUI stays responsive and any content it loads on editor-open (an
/// impulse response, samples) has real time to arrive. Feeds continuous white
/// noise so a working reverb produces an audible, measurable wet signal.
#[cfg(target_os = "windows")]
fn run_with_editor(
    plugin: vst3_host::Plugin,
    a: &Args,
    out_channels: usize,
    in_channels: usize,
) -> Result<(), String> {
    use std::ptr;
    use std::sync::{Arc, Mutex};

    use vst3_host::window::PluginWindow;
    use winapi::shared::minwindef::DWORD;
    use winapi::um::processthreadsapi::GetCurrentProcessId;
    use winapi::um::winuser::{
        DispatchMessageW, FindWindowExW, GetWindowThreadProcessId, IsWindow, PeekMessageW,
        ShowWindow, TranslateMessage, PM_REMOVE, SW_HIDE, WM_QUIT,
    };

    if !plugin.has_editor() {
        return Err("plugin reports no editor — cannot use --open-editor".to_string());
    }
    let name = plugin.info().name.clone();

    let shared = Arc::new(Mutex::new(plugin));
    let mut window = PluginWindow::new(shared.clone());
    window.open().map_err(|e| format!("open_editor: {e}"))?;
    println!("--- editor opened: the '{name}' GUI should now be visible ---");
    println!("feeding continuous white noise. CLOSE THE WINDOW to stop and write the WAV.");

    // Locate the native window vst3-host created for this process's editor so we
    // can detect when the user closes it (its WndProc is DefWindowProcW, so the
    // close button destroys it and IsWindow then returns 0).
    let class_name: Vec<u16> = "VST3PluginWindow\0".encode_utf16().collect();
    let title: Vec<u16> = format!("{name} - VST3\0").encode_utf16().collect();
    let our_pid = unsafe { GetCurrentProcessId() };
    let mut hwnd = ptr::null_mut();
    let mut cursor = ptr::null_mut();
    loop {
        let cand = unsafe {
            FindWindowExW(ptr::null_mut(), cursor, class_name.as_ptr(), title.as_ptr())
        };
        if cand.is_null() {
            break;
        }
        let mut pid: DWORD = 0;
        unsafe { GetWindowThreadProcessId(cand, &mut pid) };
        if pid == our_pid {
            hwnd = cand;
            break;
        }
        cursor = cand;
    }
    if hwnd.is_null() {
        eprintln!("[warn] editor window handle not found; will run for --duration then stop");
    } else if a.hide_editor {
        // Hide the editor window but keep it (and the plugin's editor) attached
        // and active — the Reaper "hidden FX window" model. Tests whether the
        // effect still streams its content while its window is not visible.
        unsafe { ShowWindow(hwnd, SW_HIDE) };
        println!("editor window HIDDEN (SW_HIDE) — plugin editor stays attached/active");
    }

    let block = a.block;
    let sr = a.sample_rate;
    let block_ms = ((block as f64 / sr) * 1000.0).max(1.0) as u64;
    let log_every = ((sr / block as f64).round() as u64).max(1);
    let manual = a.close_after <= 0.0;
    // In manual mode, cap so a forgotten window can't run forever. In
    // close-after mode, run for exactly --duration then stop.
    let stop_frames = if manual {
        (a.duration.max(600.0) * sr) as usize
    } else {
        (a.duration * sr) as usize
    };
    let capture_cap = (30.0 * sr) as usize; // bound WAV memory to ~30 s
    if !manual {
        println!(
            "will programmatically CLOSE the editor at t={:.1}s and keep processing until t={:.1}s",
            a.close_after, a.duration
        );
    }

    let mut noise: u32 = 0x1234_5678;
    let mut captured: Vec<Vec<f32>> = vec![Vec::new(); out_channels];
    let mut max_out = 0.0_f32;
    let mut max_out_after_close = 0.0_f32;
    let mut block_idx = 0u64;
    let mut frames_done = 0usize;
    let mut editor_closed = false;

    loop {
        let elapsed = frames_done as f64 / sr;

        // In close-after mode, tear the editor down mid-session and keep going so
        // we can see whether the wet path survives losing the editor.
        if !manual && !editor_closed && elapsed >= a.close_after {
            window.close();
            editor_closed = true;
            hwnd = ptr::null_mut();
            println!("*** editor CLOSED programmatically at t={elapsed:.1}s — still processing, no editor ***");
        }

        // Drain any pending editor messages first.
        unsafe {
            let mut msg = std::mem::zeroed();
            while PeekMessageW(&mut msg, ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    break;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if manual && !hwnd.is_null() && IsWindow(hwnd) == 0 {
                break; // user closed the editor
            }
        }

        let mut buffers = AudioBuffers::new(in_channels, out_channels, block, sr);
        for f in 0..block {
            noise ^= noise << 13;
            noise ^= noise >> 17;
            noise ^= noise << 5;
            let v = (noise as f32 / u32::MAX as f32) * 2.0 - 1.0;
            for dst in buffers.inputs.iter_mut() {
                if f < dst.len() {
                    dst[f] = v * 0.25;
                }
            }
        }
        {
            let mut p = shared.lock().unwrap_or_else(|e| e.into_inner());
            p.process_audio(&mut buffers)
                .map_err(|e| format!("process_audio: {e}"))?;
        }

        let in_peak = peak(&buffers.inputs);
        let out_peak = peak(&buffers.outputs);
        max_out = max_out.max(out_peak);
        if editor_closed {
            max_out_after_close = max_out_after_close.max(out_peak);
        }
        if block_idx % log_every == 0 {
            let phase = if editor_closed { "CLOSED" } else { "OPEN  " };
            println!(
                "  [{phase}] t={:>5.1}s  in_peak={in_peak:.4}  out_peak={out_peak:.4}  (session max_out={max_out:.4})",
                frames_done as f64 / sr
            );
        }
        for (c, dst) in captured.iter_mut().enumerate() {
            if dst.len() < capture_cap {
                if let Some(src) = buffers.outputs.get(c) {
                    dst.extend_from_slice(src);
                }
            }
        }

        block_idx += 1;
        frames_done += block;
        if frames_done >= stop_frames {
            if manual {
                println!("[info] hit safety cap; stopping.");
            }
            break;
        }
        // Pace to roughly real time so streaming content can keep up and the GUI
        // remains interactive.
        std::thread::sleep(std::time::Duration::from_millis(block_ms));
    }

    {
        let mut p = shared.lock().unwrap_or_else(|e| e.into_inner());
        let _ = p.stop_processing();
    }
    window.close();

    println!("---");
    println!("session max output peak (whole run) = {max_out:.6}");
    if !manual {
        println!("max output peak AFTER editor closed = {max_out_after_close:.6}");
        if max_out_after_close < 1.0e-5 {
            println!("VERDICT: wet path DIED when the editor closed — the editor (or its message-driven streaming) must stay alive during processing.");
        } else if max_out_after_close < 0.26 {
            println!("VERDICT: after close, output collapsed to ~dry-only — wet path went dead without the editor.");
        } else {
            println!("VERDICT: wet path SURVIVED editor close — a one-time editor-open trigger is enough.");
        }
    } else if max_out < 1.0e-5 {
        println!("VERDICT: wet path stayed SILENT even with the editor open.");
    } else {
        println!("VERDICT: output HAD signal while the editor was open.");
    }
    write_wav(Path::new(&a.out), &captured, sr as u32).map_err(|e| format!("write_wav: {e}"))?;
    println!("wrote {}", a.out);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn run_with_editor(
    _plugin: vst3_host::Plugin,
    _a: &Args,
    _out_channels: usize,
    _in_channels: usize,
) -> Result<(), String> {
    Err("--open-editor is only implemented on Windows".to_string())
}

fn main() {
    if let Err(e) = run() {
        if e == "help" {
            eprintln!("{}", include_str!("usage.txt"));
            return;
        }
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
