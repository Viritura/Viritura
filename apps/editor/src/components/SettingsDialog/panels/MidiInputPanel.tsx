import { useEffect, useMemo, useState } from "react";
import {
  controllerPortRole,
  controllerProfileSourceUrl,
  findControllerProfile,
  type ControllerAction,
  type ControllerBinding,
  type ControllerProfile,
  type MidiInputMessage,
  type MidiInputPort,
} from "@viritura/midi";
import { Button, Select, SettingsRow } from "@viritura/ui";
import {
  initializeProfiledMidiInputs,
  midiControllerManager as manager,
  midiPerformanceManager,
} from "../../../midiController";
import styles from "./MidiInputPanel.module.css";

const MAX_MESSAGES = 100;

interface MonitorEntry {
  readonly message: MidiInputMessage;
  readonly source: "Controls" | "Performance";
}

function messageDescription(message: MidiInputMessage): string {
  const channel = message.channel === null ? "" : ` ch ${message.channel + 1}`;
  switch (message.kind) {
    case "note-on":
    case "note-off":
      return `${message.kind}${channel} note ${message.data1} velocity ${message.data2}`;
    case "control-change":
      return `control-change${channel} CC ${message.data1} value ${message.data2}`;
    case "program-change":
      return `program-change${channel} program ${message.data1}`;
    case "pitch-bend": {
      const value = (message.data1 ?? 0) | ((message.data2 ?? 0) << 7);
      return `pitch-bend${channel} value ${value}`;
    }
    case "polyphonic-key-pressure":
      return `poly-pressure${channel} note ${message.data1} pressure ${message.data2}`;
    case "channel-pressure":
      return `channel-pressure${channel} pressure ${message.data1}`;
    default:
      return `${message.kind}${channel}`;
  }
}

function hexBytes(message: MidiInputMessage): string {
  return message.data.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function inputOptions(inputs: readonly MidiInputPort[]) {
  return [
    { value: "", label: inputs.length === 0 ? "No MIDI inputs found" : "Select an input" },
    ...inputs.map((input) => ({
      value: input.id,
      label: (() => {
        const profile = findControllerProfile(input);
        const role = profile ? controllerPortRole(profile, input.name) : undefined;
        const device = input.manufacturer ? `${input.name} - ${input.manufacturer}` : input.name;
        return role ? `${device} [${role}]` : device;
      })(),
    })),
  ];
}

function selectedProfile(...inputs: Array<MidiInputPort | null>): ControllerProfile | undefined {
  return inputs.flatMap((input) => {
    const profile = input ? findControllerProfile(input) : undefined;
    return profile ? [profile] : [];
  })[0];
}

function actionLabel(action: ControllerAction): string {
  switch (action.type) {
    case "transport.play-stop":
      return "Play / stop";
    case "history.undo":
      return "Undo";
    case "note-input.toggle":
      return "Toggle note entry";
    case "note-input.set-duration":
      return `Set duration: ${action.duration}`;
    case "note-input.move-cursor":
      return `Move cursor ${action.direction}`;
  }
}

function bindingLabel(binding: ControllerBinding): string {
  const event =
    binding.message === "control-change"
      ? `CC ${binding.number}${binding.value === undefined ? "" : ` = ${binding.value}`}`
      : `Note ${binding.number}`;
  return `${binding.portRole}, ch ${binding.channel}, ${event}`;
}

function ProfileConfiguration({ profile }: { readonly profile: ControllerProfile | undefined }) {
  if (!profile) {
    return <p className={styles.profileEmpty}>No predefined controller profile detected for the selected inputs.</p>;
  }
  const sourceUrl = controllerProfileSourceUrl(profile.id);
  return (
    <section className={styles.profileCard} aria-label={`${profile.name} controller profile`}>
      <div className={styles.profileHeading}>
        <div>
          <strong>{profile.name}</strong>
          <span>{profile.manufacturer}</span>
        </div>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            View JSON on GitHub
          </a>
        )}
      </div>
      <p className={styles.profileNote}>
        This configuration comes from Viritura&apos;s predefined device profiles. Custom profile editing will be added
        later.
      </p>
      <div className={styles.profilePorts}>
        {profile.ports.map((port) => (
          <div key={port.role}>
            <strong>{port.role}</strong>
            <span>{port.names.join(", ")}</span>
          </div>
        ))}
      </div>
      <div className={styles.bindingList} aria-label="Profile mappings">
        {profile.bindings.map((binding, index) => (
          <div
            className={styles.binding}
            key={`${binding.portRole}-${binding.message}-${binding.number}-${binding.value}-${index}`}
          >
            <code>{bindingLabel(binding)}</code>
            <span>{actionLabel(binding.action)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MidiInputPanel() {
  const initialControlInput = manager.selectedInput;
  const initialPerformanceInput = midiPerformanceManager.selectedInput;
  const [accessStatus, setAccessStatus] = useState(
    manager.isSupported
      ? manager.isInitialized
        ? "MIDI access granted"
        : "Not connected"
      : "Web MIDI is not supported",
  );
  const [controlInputs, setControlInputs] = useState<readonly MidiInputPort[]>(manager.getInputs());
  const [performanceInputs, setPerformanceInputs] = useState<readonly MidiInputPort[]>(
    midiPerformanceManager.getInputs(),
  );
  const [selectedControlId, setSelectedControlId] = useState(initialControlInput?.id ?? "");
  const [selectedPerformanceId, setSelectedPerformanceId] = useState(initialPerformanceInput?.id ?? "");
  const [selectedControl, setSelectedControl] = useState<MidiInputPort | null>(initialControlInput);
  const [selectedPerformance, setSelectedPerformance] = useState<MidiInputPort | null>(initialPerformanceInput);
  const [messages, setMessages] = useState<readonly MonitorEntry[]>([]);

  useEffect(() => {
    const handleControlChanged = (input: MidiInputPort | null) => {
      setSelectedControlId(input?.id ?? "");
      setSelectedControl(input);
    };
    const handlePerformanceChanged = (input: MidiInputPort | null) => {
      setSelectedPerformanceId(input?.id ?? "");
      setSelectedPerformance(input);
    };
    const addMessage = (source: MonitorEntry["source"], message: MidiInputMessage) => {
      setMessages((current) => [{ source, message }, ...current].slice(0, MAX_MESSAGES));
    };
    const handleControlMessage = (message: MidiInputMessage) => addMessage("Controls", message);
    const handlePerformanceMessage = (message: MidiInputMessage) => addMessage("Performance", message);

    manager.on("inputschanged", setControlInputs);
    manager.on("inputchanged", handleControlChanged);
    manager.on("message", handleControlMessage);
    midiPerformanceManager.on("inputschanged", setPerformanceInputs);
    midiPerformanceManager.on("inputchanged", handlePerformanceChanged);
    midiPerformanceManager.on("message", handlePerformanceMessage);
    return () => {
      manager.off("inputschanged", setControlInputs);
      manager.off("inputchanged", handleControlChanged);
      manager.off("message", handleControlMessage);
      midiPerformanceManager.off("inputschanged", setPerformanceInputs);
      midiPerformanceManager.off("inputchanged", handlePerformanceChanged);
      midiPerformanceManager.off("message", handlePerformanceMessage);
    };
  }, []);

  const controlOptions = useMemo(() => inputOptions(controlInputs), [controlInputs]);
  const performanceOptions = useMemo(() => inputOptions(performanceInputs), [performanceInputs]);
  const profile = useMemo(
    () => selectedProfile(selectedControl, selectedPerformance),
    [selectedControl, selectedPerformance],
  );

  const connect = async () => {
    setAccessStatus("Requesting MIDI access...");
    const initialized = await initializeProfiledMidiInputs();
    if (!initialized) {
      setAccessStatus(manager.isSupported ? "MIDI access was denied or unavailable" : "Web MIDI is not supported");
      return;
    }

    setControlInputs(manager.getInputs());
    setPerformanceInputs(midiPerformanceManager.getInputs());
    setAccessStatus(manager.getInputs().length === 0 ? "Access granted; no MIDI inputs found" : "MIDI access granted");
  };

  const selectControlInput = (inputId: string) => {
    if (!manager.selectInput(inputId || null)) {
      setAccessStatus("The selected control input is no longer available");
    }
  };

  const selectPerformanceInput = (inputId: string) => {
    if (!midiPerformanceManager.selectInput(inputId || null)) {
      setAccessStatus("The selected performance input is no longer available");
    }
  };

  return (
    <>
      <SettingsRow
        label="Web MIDI access"
        description={`${accessStatus}. First use requires permission; later visits reconnect automatically in Chromium-based browsers.`}
      >
        <Button size="sm" variant="primary" disabled={!manager.isSupported} onClick={() => void connect()}>
          {manager.isInitialized ? "Refresh" : "Enable"}
        </Button>
      </SettingsRow>
      <SettingsRow label="Performance input" description="Keyboard notes used for audition and note entry.">
        {({ controlId, descriptionId }) => (
          <Select
            id={controlId}
            aria-describedby={descriptionId}
            value={selectedPerformanceId}
            options={performanceOptions}
            disabled={!midiPerformanceManager.isInitialized || performanceInputs.length === 0}
            onValueChange={selectPerformanceInput}
          />
        )}
      </SettingsRow>
      <SettingsRow label="Control input" description="Transport, pads, knobs, and other mapped controller commands.">
        {({ controlId, descriptionId }) => (
          <Select
            id={controlId}
            aria-describedby={descriptionId}
            value={selectedControlId}
            options={controlOptions}
            disabled={!manager.isInitialized || controlInputs.length === 0}
            onValueChange={selectControlInput}
          />
        )}
      </SettingsRow>

      <ProfileConfiguration profile={profile} />

      <details className={styles.diagnostics}>
        <summary>MIDI diagnostics</summary>
        <div className={styles.monitorHeader}>
          <span>Incoming messages</span>
          <Button size="sm" variant="ghost" disabled={messages.length === 0} onClick={() => setMessages([])}>
            Clear
          </Button>
        </div>
        <div className={styles.monitor} role="log" aria-live="polite">
          {messages.length === 0 ? (
            <p className={styles.empty}>Play a key, turn a knob, or press a pedal to inspect its MIDI data.</p>
          ) : (
            messages.map(({ message, source }, index) => (
              <div className={styles.message} key={`${source}-${message.receivedTime}-${index}`}>
                <span className={styles.source}>{source}</span>
                <code className={styles.bytes}>{hexBytes(message)}</code>
                <span>{messageDescription(message)}</span>
              </div>
            ))
          )}
        </div>
      </details>
    </>
  );
}
