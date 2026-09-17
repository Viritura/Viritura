use std::future::Future;
use std::pin::{pin, Pin};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, TryLockError};
use std::task::{Context, Poll, Wake, Waker};
use std::thread;
use std::time::{Duration, Instant};

use super::{capture_state, HostError, PlaybackHost, BUSY};
use crate::playback_host::{self as playback, engine::HostCommand};

const TIMEOUT: Duration = Duration::from_secs(10);

struct NoopWake;

impl Wake for NoopWake {
    fn wake(self: Arc<Self>) {}
}

fn poll_pending(future: Pin<&mut impl Future>) {
    let waker = Waker::from(Arc::new(NoopWake));
    assert!(matches!(
        future.poll(&mut Context::from_waker(&waker)),
        Poll::Pending
    ));
}

fn receive<T>(rx: &Receiver<T>) -> T {
    rx.recv_timeout(TIMEOUT).expect("worker timed out")
}

fn fake_host() -> (PlaybackHost, Receiver<HostCommand>) {
    let host = PlaybackHost::default();
    let (tx, rx) = mpsc::channel();
    *host.sender.lock().unwrap() = Some(tx);
    (host, rx)
}

fn assert_busy<T: std::fmt::Debug>(result: Result<T, String>) {
    assert_eq!(result.unwrap_err(), BUSY);
}

fn assert_playback_busy(host: &PlaybackHost) {
    assert_busy(host.operation());
    assert_busy(playback::load(host, vec![]));
    assert_busy(playback::retain(host, vec![]));
    assert_busy(playback::start(host, 0.0));
    assert_busy(playback::stop(host));
    assert_busy(playback::seek(host, 0.0));
    assert_busy(playback::release_all(host));
    assert_busy(playback::set_muted(host, vec![]));
    assert_busy(playback::set_reverb_chain(host, vec![], 0.0));
    assert_busy(playback::set_master_chain(host, vec![]));
    assert_busy(playback::set_reverb_levels(host, 0.0, 0.0));
    assert_busy(playback::show_fx_editor(host, "master", 0));
    assert_busy(playback::close_fx_editor(host));
    assert_busy(playback::set_gain(host, "slot".to_owned(), 1.0));
    assert_busy(playback::set_pan(host, "slot".to_owned(), 0.0));
    assert_busy(playback::preview(host, "slot".to_owned(), 60, 100, 100));
}

#[test]
fn capture_yields_and_excludes_every_playback_operation_and_other_captures() {
    let host = PlaybackHost::default();
    let (entered, entering) = mpsc::channel();
    let (finish, finishing) = mpsc::channel();
    let ui_thread = thread::current().id();
    let mut capture = pin!(capture_state(host.clone(), move || {
        assert_ne!(thread::current().id(), ui_thread);
        entered.send(()).unwrap();
        receive(&finishing);
        Ok(vec![1, 2])
    }));

    poll_pending(capture.as_mut());
    receive(&entering);
    poll_pending(capture.as_mut());
    assert_eq!(
        tauri::async_runtime::block_on(tauri::async_runtime::spawn(async { 42 }))
            .unwrap_or_else(|_| panic!("async worker panicked")),
        42
    );
    assert_playback_busy(&host);
    assert_busy(tauri::async_runtime::block_on(capture_state(
        host.clone(),
        || panic!("overlapping capture must not run"),
    )));
    assert!(host.sender.lock().unwrap().is_none());
    finish.send(()).unwrap();
    assert_eq!(tauri::async_runtime::block_on(capture).unwrap(), vec![1, 2]);
    assert_eq!(
        tauri::async_runtime::block_on(capture_state(host.clone(), || Ok(vec![3]))).unwrap(),
        vec![3]
    );
    assert!(host.operation().is_ok());
}

#[test]
fn exclusive_gate_covers_release_reply_before_capture_starts() {
    let (host, commands) = fake_host();
    let (entered, entering) = mpsc::channel();
    let mut capture = pin!(capture_state(host.clone(), move || {
        entered.send(()).unwrap();
        Ok(vec![])
    }));
    poll_pending(capture.as_mut());
    let HostCommand::ReleaseAll { reply } = receive(&commands) else {
        panic!("capture must release playback first");
    };
    assert!(entering.try_recv().is_err());
    assert_playback_busy(&host);
    assert_busy(tauri::async_runtime::block_on(capture_state(
        host.clone(),
        || panic!("capture cannot overlap playback release"),
    )));
    reply.send(Ok(())).unwrap();
    assert!(tauri::async_runtime::block_on(capture).is_ok());
    receive(&entering);
    assert!(commands.try_recv().is_err());
    assert!(host.operation().is_ok());
}

struct NativeResource {
    host: PlaybackHost,
    created_on: thread::ThreadId,
    destroyed: mpsc::Sender<thread::ThreadId>,
}

impl Drop for NativeResource {
    fn drop(&mut self) {
        assert_eq!(self.created_on, thread::current().id());
        assert_busy(self.host.operation());
        self.destroyed.send(thread::current().id()).unwrap();
    }
}

#[test]
fn success_error_and_panic_cleanup_stay_on_worker_under_gate_and_allow_reuse() {
    let host = PlaybackHost::default();
    for outcome in 0..3 {
        let (destroyed, destruction) = mpsc::channel();
        let resource_host = host.clone();
        let result = tauri::async_runtime::block_on(capture_state(host.clone(), move || {
            let _resource = NativeResource {
                host: resource_host,
                created_on: thread::current().id(),
                destroyed,
            };
            match outcome {
                0 => Ok(vec![7]),
                1 => Err(HostError::Backend("capture failed".to_owned())),
                _ => panic!("injected native panic"),
            }
        }));
        match outcome {
            0 => assert_eq!(result.unwrap(), vec![7]),
            1 => assert_eq!(
                result.unwrap_err(),
                HostError::Backend("capture failed".to_owned()).to_string()
            ),
            _ => assert_eq!(
                result.unwrap_err(),
                HostError::HostThreadPanicked.to_string()
            ),
        }
        assert_ne!(receive(&destruction), thread::current().id());
        assert!(!host.gate.is_poisoned());
        assert!(host.operation().is_ok());
    }
    assert!(tauri::async_runtime::block_on(capture_state(host, || Ok(vec![]))).is_ok());
}

#[test]
fn failed_release_skips_capture_and_releases_gate() {
    let (host, commands) = fake_host();
    for disconnect in [false, true] {
        let mut capture = pin!(capture_state(host.clone(), || {
            panic!("capture must not run after failed release")
        }));
        poll_pending(capture.as_mut());
        let HostCommand::ReleaseAll { reply } = receive(&commands) else {
            panic!("expected release");
        };
        if disconnect {
            drop(reply);
        } else {
            reply.send(Err("release failed".to_owned())).unwrap();
        }
        assert_eq!(
            tauri::async_runtime::block_on(capture).unwrap_err(),
            if disconnect {
                playback::DEAD
            } else {
                "release failed"
            }
        );
        assert!(host.operation().is_ok());
    }
}

#[test]
fn in_flight_playback_request_excludes_capture_until_reply() {
    let (host, commands) = fake_host();
    let operation_host = host.clone();
    let operation = thread::spawn(move || playback::set_master_chain(&operation_host, vec![]));
    let HostCommand::SetMasterChain { reply, .. } = receive(&commands) else {
        panic!("expected FX load");
    };
    assert_busy(tauri::async_runtime::block_on(capture_state(
        host.clone(),
        || panic!("capture cannot overlap an in-flight FX request"),
    )));
    assert!(commands.try_recv().is_err());
    reply.send(Ok(())).unwrap();
    operation.join().unwrap().unwrap();

    let mut capture = pin!(capture_state(host.clone(), || Ok(vec![])));
    poll_pending(capture.as_mut());
    let HostCommand::ReleaseAll { reply } = receive(&commands) else {
        panic!("expected release after operation finishes");
    };
    reply.send(Ok(())).unwrap();
    assert!(tauri::async_runtime::block_on(capture).is_ok());
}

#[test]
fn operation_locks_gate_before_sender_lookup_preventing_stale_sender_race() {
    let (host, commands) = fake_host();
    let sender = host.sender.lock().unwrap();
    let operation_host = host.clone();
    let operation = thread::spawn(move || loop {
        // The probe below can briefly win the gate before this request enters.
        match playback::load(&operation_host, vec![]) {
            Err(error) if error == BUSY => thread::yield_now(),
            result => break result,
        }
    });
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match host.gate.try_write() {
            Err(TryLockError::WouldBlock) => break,
            Ok(guard) => drop(guard),
            Err(error) => panic!("unexpected poisoned gate: {error}"),
        }
        assert!(Instant::now() < deadline, "operation did not take gate");
        thread::yield_now();
    }
    assert_busy(tauri::async_runtime::block_on(capture_state(
        host.clone(),
        || panic!("capture cannot pass a playback request awaiting its sender"),
    )));
    assert!(commands.try_recv().is_err());
    drop(sender);
    let HostCommand::Load { reply, .. } = receive(&commands) else {
        panic!("expected load, not capture release");
    };
    reply.send(Ok(())).unwrap();
    operation.join().unwrap().unwrap();
    assert!(host.operation().is_ok());
}

#[test]
fn identity_operation_guard_excludes_capture() {
    let host = PlaybackHost::default();
    let identity = host.operation().unwrap();
    assert_busy(tauri::async_runtime::block_on(capture_state(
        host.clone(),
        || panic!("capture cannot overlap plugin identity initialization"),
    )));
    drop(identity);
    assert!(tauri::async_runtime::block_on(capture_state(host, || Ok(vec![]))).is_ok());
}

#[test]
fn dropping_async_waiter_does_not_release_running_native_capture() {
    let host = PlaybackHost::default();
    let (entered, entering) = mpsc::channel();
    let (finish, finishing) = mpsc::channel();
    let (destroyed, destruction) = mpsc::channel();
    let resource_host = host.clone();
    let mut capture = Box::pin(capture_state(host.clone(), move || {
        let _resource = NativeResource {
            host: resource_host,
            created_on: thread::current().id(),
            destroyed,
        };
        entered.send(()).unwrap();
        receive(&finishing);
        Ok(vec![])
    }));
    poll_pending(capture.as_mut());
    receive(&entering);
    drop(capture);
    assert_playback_busy(&host);
    finish.send(()).unwrap();
    receive(&destruction);
    let deadline = Instant::now() + TIMEOUT;
    while host.operation().is_err() {
        assert!(Instant::now() < deadline, "capture did not release gate");
        thread::yield_now();
    }
    assert!(tauri::async_runtime::block_on(capture_state(host, || Ok(vec![]))).is_ok());
}
