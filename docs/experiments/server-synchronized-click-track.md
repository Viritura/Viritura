# Server-Synchronized Click Track Experiment

> **Status: Shelved (November 2026).** The experiment did not establish
> reliable, join-and-play synchronization across arbitrary devices. Relative
> microphone calibration worked in one setup, but its setup burden is
> undesirable and its long-term stability remains unverified.

## Goal and decision

Investigate a host-controlled metronome whose participants join on phones and
hear the same click during rehearsal. The desired result is close **relative**
alignment between listeners, not necessarily alignment with the server clock.
Approximately 5 ms was an aspirational goal; no rehearsal-validated acceptance
threshold was established. Bluetooth headphones were outside the experiment.

The practical decision was to shelve this approach: use a single metronome
over loudspeakers for rehearsal and a wired click feed for studio recording.
A loudspeaker still has room-dependent sound-travel delays, but avoids
independently timed outputs on every phone. The experiment does not prove that
browser synchronization is impossible; it did not demonstrate that it is
convenient and reliable enough for this use case.

## Prototype and measurement

The standalone browser prototype used a server to establish a future beat
anchor, rather than streaming each click. Each client:

- Estimated its server-clock offset using four-timestamp exchanges, selecting
  the lowest-round-trip sample from a recent window.
- Scheduled clicks locally ahead of time on the Web Audio timeline.
- Used `getOutputTimestamp()` to map between audio and browser clocks when
  available; otherwise it fell back to `baseLatency + outputLatency`. Those
  methods are alternatives, not corrections to add together. Missing latency
  reports were treated as zero in the fallback.
- Offered a per-device timing adjustment. Clicks had device-specific pitches
  and an accented downbeat to help compare the same beat.

Network delay does not directly delay an already scheduled click, but clock
estimation, asymmetric network paths, mapping to the audio clock, device output,
and scheduling or lifecycle interruptions can all affect alignment. Visually
similar displayed clocks did not establish millisecond accuracy.

Tests used Windows Edge with a Focusrite audio interface and an Android phone
running Chrome. The recorded comparisons were largely by ear; the experiment
did not retain a quantitative post-calibration error distribution.

## Observations

In the initial Windows/Android comparison, reported audio timing was enabled.
After changes to the route and buffer, the user reported these approximate
relative adjustments; settings were not fully logged for every run:

- **Focusrite buffer at 512 samples:** advancing the Windows host by about
  70 ms aligned it with the phone.
- **Focusrite buffer at 16 samples:** the host needed about 30 ms of
  advancement. A 1024-sample setting sounded worse; no numeric result was
  recorded.
- **Computer output instead of Focusrite:** the host needed approximately
  15 ms of delay.
- **Shared-microphone calibration:** in a later run, the prototype delayed
  the phone by about 70 ms. The user reported that this worked well and agreed
  with the earlier host adjustment in relative terms. The exact conditions
  between runs were not fully recorded.

These are **relative corrections**, not measurements of either device's
absolute error relative to the server. They show that the result depended on
the setup, including the output route and buffer setting. They do not isolate
the error to a particular browser API, driver, device, clock mapping, or
implementation bug. The user's approximately 50 ms uncalibrated variance was
not a formal statistical measurement.

### Shared-microphone calibration

The prototype recorded two distinguishable clicks with one microphone and
adjusted one device according to their arrival-time difference. A fixed input
delay common to both click onsets cancels, provided the microphone path and its
processing remain stable. This can align the two acoustic outputs at the
microphone; it does not determine either output's absolute server-clock error.

Speaker-to-microphone distance, reflections, noise, processing, and
pitch-dependent onset detection can bias the result. Sound travels roughly
2.9 ms per metre, so speakers should be equally distant from the microphone.
The same playback route must be used after calibration: a phone's speaker and
wired earphones need not have the same latency. One successful adjustment did
not establish repeatability across routes, devices, or a full rehearsal.

### Self-calibration

The prototype also measured a device's own speaker through its microphone.
It compared a scheduled audio-context frame with the detected onset in the
microphone stream, using a matched filter. This is an effective audio-graph
round trip, not an independently timestamped physical input or output:

- **Windows / Focusrite:** 287.247 ms round trip over 15 detected clicks, with
  0.09 ms median deviation; output-timestamp estimate 67.258 ms; reported
  base / output / microphone latencies 10 / 58 / 10 ms. The raw
  round-trip-minus-output-estimate gap was 219.989 ms.
- **Android:** approximately 140 ms round trip, 21 ms browser output
  estimate, and 3 / 22 / 40 ms reported base / output / microphone
  latencies. The reported raw gap was about 117 ms, or 77 ms after assuming
  40 ms of input delay. An additional +90 ms value was reported without a
  clear label. The rounded values do not reconcile exactly.

A small deviation shows repeatability within that measurement, not absolute
accuracy. The round trip contains output, acoustic travel, input, and
graph/timestamp or detection effects. The browser's microphone latency
setting is not an independent measurement of physical capture delay.
Subtracting it cannot reliably separate the input and output contributions;
the Windows gap is not proven to be Focusrite input latency or unreported
output latency. No suggested self-calibration correction was verified.

Microphone access on the Android LAN page also required a secure-context
workaround during testing. The browser's development flag did not encrypt the
connection and is not a suitable deployment solution.

## Learnings and limits

- Browser output timing values are estimates, not acoustic ground truth.
  Their presence and millisecond precision do not guarantee millisecond
  accuracy on a particular route. With valid output timestamps, applying the
  separate reported latencies again would double-count the correction.
- A common microphone can compare outputs without knowing its fixed input
  latency, but only at the microphone's position and subject to the biases
  above. A host that only controls the session need not produce a click;
  whichever device is the reference still needs its own output evaluated if
  it participates.
- An ordinary electrical or acoustic loopback measures a combined path, not
  independent input and output delays. Absolute timing requires a physical
  reference whose timestamp is independently mapped to the relevant clock,
  with its uncertainty assessed.
- Native low-latency audio, different network infrastructure, device profiles,
  two-way acoustic calibration, or drift correction may help, but none was
  validated here as a join-and-play solution. Lower latency alone is not an
  absolute timing reference.
- A common output offset is acceptable when everyone follows their own click
  and there is no external cue. Synchronization to another audio or video
  source is a separate requirement. Hearing a distant speaker introduces
  position-dependent delay.

If revisited, test multiple actual phones and intended output routes using an
independent shared reference. Record residual alignment and variability,
startup and tempo changes, drift over a rehearsal, route changes, and
calibration repeatability. Establish an acceptable rehearsal tolerance with
musicians rather than treating this experiment's aspirational 5 ms as a proven
requirement.

## References

- [MDN: `AudioContext.outputLatency`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- [MDN: `AudioContext.getOutputTimestamp()`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
- [Metronome.fm: Building SYNC rooms](https://metronome.fm/blog/en/sync-room) describes a separate browser-based system using clock synchronization and manual relative output adjustment.
