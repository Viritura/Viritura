/**
 * MixerPanel — per-part mixer with volume, mute, and solo.
 *
 * Visual design (refreshed 2026-05-17 to match Viritura design language):
 * - Track rows are subtle rounded glass cards (matches Parts panel /
 *   Publish Layout cards) rather than floating text-on-blur.
 * - Group sections are flat bands marked by a 3px left accent stripe
 *   in the family color — the visual weight goes to the tracks.
 * - Sliders use a hairline groove with a viridian-tinted fill and a
 *   slim vertical thumb cap, replacing chunky media-player knobs.
 * - M / S toggles are transparent capsules with a hairline border;
 *   active mute = soft red, active solo = soft amber.
 * - Numeric readouts share a fixed-width monospaced gutter so the
 *   eye doesn't dart between rows.
 * - Master section is pinned at the bottom with the same row format,
 *   slightly bolder glass to mark it as the bus output.
 * - Master FX uses neutral lucide icons (Waves / AudioWaveform /
 *   ShieldCheck) at var(--text-muted) — no emoji, no per-feature
 *   colorization. Collapsed by default to save vertical space.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Volume2, VolumeX, ChevronDown, ChevronRight, Waves, AudioWaveform, ShieldCheck } from "lucide-react";
import { useMixer, useMixerActions, type MixerChannelState, type MixerGroupState } from "../store/mixerStore";
import { usePlaybackActions } from "@viritura/playback";
import { REVERB_PRESETS } from "@viritura/audio";
import type { ReverbPreset } from "@viritura/audio";
import { Collapsible, IconButton, Select, PanelHeader, Slider, withTooltip, CascadingMenu, Button } from "@viritura/ui";
import type { CascadingMenuItem } from "@viritura/ui";
import type { Part, Score } from "@viritura/core";
import type { VstInstrumentProfile } from "@viritura/instrument-profiles";
import {
  useInstrumentProfileStore,
  loadInstrumentProfiles,
  useAudioRenderModeStore,
  useFxChainStore,
  useFxChainDialogStore,
  FxChainDialog,
  isDesktopHost,
} from "../instrumentProfiles";
import { extractFamilyGroups } from "../store/familyGroups";
import { SoundPicker, type PartSoundSourceChange } from "./mixerSoundPicker";
import {
  MIXER_DB_STEP,
  MIXER_MAX_DB,
  MIXER_MIN_DB,
  dbToGain,
  formatGainDb,
  gainToDb,
  gainToFaderPercent,
} from "../store/mixerGain";
import styles from "./MixerPanel.module.css";

const MASTER_ERROR_ICON_STYLE: CSSProperties = { color: "var(--error)", flexShrink: 0 };
const MASTER_DIM_ICON_STYLE: CSSProperties = { color: "var(--text-muted)", flexShrink: 0 };

// ═══════════════════════════════════════════
// Props
// ═══════════════════════════════════════════

export interface MixerPartInfo {
  /** Part display name. */
  name: string;
  /** Index into Score.parts[]. */
  index: number;
}

export interface MixerPanelProps {
  /** Parts to display in the mixer, in order. */
  parts: MixerPartInfo[];
  /** Optional score for layout-based family grouping. */
  score?: Score | null | undefined;
  /** Persist a selected profile source through the canonical document state. */
  onSoundSourceChange: (change: PartSoundSourceChange) => void;
  /** Bulk-assign every part to its matching slot in a chosen VST profile. */
  onAssignAllToProfile?: (profile: VstInstrumentProfile) => void;
}

// ═══════════════════════════════════════════
// Family grouping is now provided by ../store/familyGroups so the
// playback bridge (PlayView → MixerBridge) can read the same mapping.
// ═══════════════════════════════════════════

// ══════════════════════════════════════════
// FaderBar — full-row volume bar with a non-selectable name overlay.
//
// Replaces the cramped (name | slider | number | M | S) row with a
// single thick bar that *is* the row. Pointer-driven for click-anywhere
// + drag; keyboard-driven for accessibility.
// ══════════════════════════════════════════

interface FaderBarProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  /** Variant class (e.g. masterFader) applied alongside the base. */
  className?: string;
  /** Non-selectable label rendered as an overlay inside the bar. */
  children?: ReactNode;
}

function FaderBar({ value, onChange, ariaLabel, className, children }: FaderBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = gainToFaderPercent(value);
  const style = { "--fill": `${pct}%` } as CSSProperties;

  const valueFromClientX = useCallback(
    (clientX: number): number => {
      const el = ref.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return value;
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const rawDb = MIXER_MIN_DB + t * (MIXER_MAX_DB - MIXER_MIN_DB);
      const snappedDb = Math.round(rawDb / MIXER_DB_STEP) * MIXER_DB_STEP;
      return dbToGain(snappedDb);
    },
    [value],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onChange(valueFromClientX(e.clientX));
    },
    [onChange, valueFromClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      onChange(valueFromClientX(e.clientX));
    },
    [onChange, valueFromClientX],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let nextDb = Math.round(gainToDb(value) / MIXER_DB_STEP) * MIXER_DB_STEP;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowDown":
          nextDb -= MIXER_DB_STEP;
          break;
        case "ArrowRight":
        case "ArrowUp":
          nextDb += MIXER_DB_STEP;
          break;
        case "PageDown":
          nextDb -= MIXER_DB_STEP * 10;
          break;
        case "PageUp":
          nextDb += MIXER_DB_STEP * 10;
          break;
        case "Home":
          nextDb = MIXER_MIN_DB;
          break;
        case "End":
          nextDb = MIXER_MAX_DB;
          break;
        default:
          return;
      }
      e.preventDefault();
      onChange(dbToGain(nextDb));
    },
    [value, onChange],
  );

  return withTooltip(
    <div
      ref={ref}
      className={className ? `${styles.faderBar} ${className}` : styles.faderBar}
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={MIXER_MIN_DB}
      aria-valuemax={MIXER_MAX_DB}
      aria-valuenow={gainToDb(value)}
      aria-valuetext={formatGainDb(value)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.faderFill} />
      {children !== undefined ? (
        <div className={styles.faderLabel}>
          <span className={styles.faderName}>{children}</span>
          <span className={styles.readout}>{formatGainDb(value)}</span>
        </div>
      ) : null}
    </div>,
    `${ariaLabel}: ${formatGainDb(value)}`,
  );
}

// ══════════════════════════════════════════
// M / S toggle capsules
// ═══════════════════════════════════════════

const MUTE_ACTIVE_COLOR = "rgb(217, 74, 74)";
const SOLO_ACTIVE_COLOR = "rgb(218, 165, 70)";

function ToggleM({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <IconButton size="xs" active={active} activeColor={MUTE_ACTIVE_COLOR} tooltip={label} onClick={onClick}>
      M
    </IconButton>
  );
}

function ToggleS({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <IconButton size="xs" active={active} activeColor={SOLO_ACTIVE_COLOR} tooltip={label} onClick={onClick}>
      S
    </IconButton>
  );
}

// ═══════════════════════════════════════════
// AssignAllControl — bulk-assign every part to a VST profile
// ═══════════════════════════════════════════

/**
 * Header control that lists the user's configured VST instrument profiles and,
 * on selection, assigns every part to its matching slot in that profile.
 * Hidden when no profiles exist.
 */
function AssignAllControl({ onAssign }: { onAssign: (profile: VstInstrumentProfile) => void }) {
  const profiles = useInstrumentProfileStore((s) => s.profiles);
  const loaded = useInstrumentProfileStore((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void loadInstrumentProfiles();
  }, [loaded]);
  const items = useMemo<CascadingMenuItem[]>(
    () =>
      profiles.map((profile) => ({ id: profile.id, label: profile.displayName, onSelect: () => onAssign(profile) })),
    [profiles, onAssign],
  );
  if (items.length === 0) return null;
  return <CascadingMenu ariaLabel="Assign all instruments to a profile" label="Assign all…" items={items} />;
}

// ═══════════════════════════════════════════
// Component
// ═══════════════════════════════════════════

export function MixerPanel({ parts, score, onSoundSourceChange, onAssignAllToProfile }: MixerPanelProps) {
  const mixer = useMixer();
  const actions = useMixerActions();
  const anyChannelSolo = mixer.channels.some((ch) => ch.solo);
  const anyGroupSolo = useMemo(() => {
    for (const id in mixer.groups) {
      if (mixer.groups[id]!.solo) return true;
    }
    return false;
  }, [mixer.groups]);
  const familyGroups = useMemo(() => extractFamilyGroups(score ?? null, parts), [score, parts]);
  // "Assign all" bulk-assigns parts to a VST profile — only meaningful in the
  // desktop native render mode, where VST slots actually drive playback. Hidden
  // in web mode so the header doesn't offer an assignment that won't be heard.
  const nativeMode = useAudioRenderModeStore((s) => s.mode) === "native" && isDesktopHost();

  return (
    <div className={styles.panel}>
      <PanelHeader
        title="Mixer"
        subtitle="Levels, panning, and effects per part."
        actions={nativeMode && onAssignAllToProfile ? <AssignAllControl onAssign={onAssignAllToProfile} /> : undefined}
      />
      <div className={`${styles.groupList} viritura-scroll`}>
        {familyGroups.map((group) => (
          <FamilySection
            key={group.label}
            label={group.label}
            parts={parts}
            score={score}
            onSoundSourceChange={onSoundSourceChange}
            partIndices={group.partIndices}
            mixer={mixer}
            anyChannelSolo={anyChannelSolo}
            anyGroupSolo={anyGroupSolo}
            actions={actions}
            spatialControlDisabled={nativeMode}
          />
        ))}
      </div>

      <div className={styles.master}>
        <MasterStrip
          volume={mixer.masterVolume}
          muted={mixer.masterMuted}
          onVolumeChange={actions.setMasterVolume}
          onToggleMute={actions.toggleMasterMute}
        />
        <MasterFX />
      </div>
      <FxChainDialog />
    </div>
  );
}

// ═══════════════════════════════════════════
// FamilySection
// ═══════════════════════════════════════════

const DEFAULT_GROUP_STATE: MixerGroupState = { volume: 1, muted: false, solo: false };

function FamilySection({
  label,
  parts,
  score,
  onSoundSourceChange,
  partIndices,
  mixer,
  anyChannelSolo,
  anyGroupSolo,
  actions,
  spatialControlDisabled,
}: {
  label: string;
  parts: MixerPartInfo[];
  score?: Score | null | undefined;
  onSoundSourceChange: (change: PartSoundSourceChange) => void;
  partIndices: number[];
  mixer: {
    channels: MixerChannelState[];
    groups: Record<string, MixerGroupState>;
  };
  anyChannelSolo: boolean;
  anyGroupSolo: boolean;
  actions: ReturnType<typeof useMixerActions>;
  spatialControlDisabled: boolean;
}) {
  const [open, setOpen] = useState(true);

  // Group bus state. Falls back to defaults until SYNC_GROUPS lands the
  // first time (which happens on PlayView mount in MixerGroupSync).
  const group = mixer.groups[label] ?? DEFAULT_GROUP_STATE;
  const groupDimmed = anyGroupSolo && !group.solo;

  const handleGroupVolume = useCallback((v: number) => actions.setGroupVolume(label, v), [label, actions]);
  const handleGroupMute = useCallback(() => actions.toggleGroupMute(label), [label, actions]);
  const handleGroupSolo = useCallback(() => actions.toggleGroupSolo(label), [label, actions]);

  // Stop the parent <button>'s onClick from firing when interacting
  // with controls embedded in the header.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <section className={styles.group} data-dimmed={groupDimmed ? "true" : undefined}>
      <div className={styles.groupHeader}>
        <IconButton
          size="xs"
          onClick={() => setOpen((o) => !o)}
          tooltip={open ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </IconButton>
        <FaderBar
          className={styles.groupFader}
          value={group.volume}
          onChange={handleGroupVolume}
          ariaLabel={`${label} bus volume`}
        >
          <span className={styles.groupName}>{label}</span>
        </FaderBar>
        <span className={styles.toggles} onClick={stop}>
          <ToggleM active={group.muted} label={`Mute ${label} bus`} onClick={handleGroupMute} />
          <ToggleS active={group.solo} label={`Solo ${label} bus`} onClick={handleGroupSolo} />
        </span>
      </div>

      {open && (
        <div className={styles.groupTracks}>
          {partIndices.map((idx) => {
            const part = parts.find((p) => p.index === idx);
            const ch = mixer.channels[idx];
            if (!part || !ch) return null;
            const trackDimmed = (anyChannelSolo && !ch.solo) || (anyGroupSolo && !group.solo);
            return (
              <ChannelStrip
                key={idx}
                partIndex={idx}
                name={part.name}
                part={score?.parts[idx]}
                score={score}
                onSoundSourceChange={onSoundSourceChange}
                channel={ch}
                dimmed={trackDimmed}
                onVolumeChange={actions.setVolume}
                onToggleMute={actions.toggleMute}
                onToggleSolo={actions.toggleSolo}
                onToggleSpatialMode={actions.toggleSpatialMode}
                spatialControlDisabled={spatialControlDisabled}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════
// ChannelStrip — track row
// ═══════════════════════════════════════════

interface ChannelStripProps {
  partIndex: number;
  name: string;
  part?: Part;
  score?: Score | null;
  channel: MixerChannelState;
  dimmed: boolean;
  onVolumeChange: (partIndex: number, volume: number) => void;
  onToggleMute: (partIndex: number) => void;
  onToggleSolo: (partIndex: number) => void;
  onToggleSpatialMode: (partIndex: number) => void;
  spatialControlDisabled: boolean;
  onSoundSourceChange: (change: PartSoundSourceChange) => void;
}

function ChannelStrip({
  partIndex,
  name,
  part,
  score,
  channel,
  dimmed,
  onVolumeChange,
  onToggleMute,
  onToggleSolo,
  onToggleSpatialMode,
  spatialControlDisabled,
  onSoundSourceChange,
}: ChannelStripProps) {
  return (
    <div className={styles.track} data-dimmed={dimmed ? "true" : undefined} data-testid={`mixer-channel-${partIndex}`}>
      <FaderBar
        className={styles.channelFader}
        value={channel.volume}
        onChange={(v) => onVolumeChange(partIndex, v)}
        ariaLabel={`Volume ${name}`}
      >
        {name}
      </FaderBar>
      <span className={styles.channelControls}>
        <ToggleM active={channel.muted} label={`Mute ${name}`} onClick={() => onToggleMute(partIndex)} />
        <ToggleS active={channel.solo} label={`Solo ${name}`} onClick={() => onToggleSolo(partIndex)} />
        <SoundPicker part={part} score={score} partDisplayName={name} onSoundSourceChange={onSoundSourceChange} />
        <Button
          size="xs"
          active={channel.spatialMode === "stage"}
          disabled={spatialControlDisabled}
          ariaLabel={`${name} spatial mode: ${channel.spatialMode === "stage" ? "Stage" : "Stereo"}`}
          tooltip={
            spatialControlDisabled
              ? `Spatial mode is unavailable while Native playback owns ${name}`
              : channel.spatialMode === "stage"
                ? `3D Stage: ${name} uses left/right position and depth`
                : `2D Stereo: ${name} uses left/right position without depth`
          }
          onClick={() => onToggleSpatialMode(partIndex)}
        >
          {channel.spatialMode === "stage" ? "3D" : "2D"}
        </Button>
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
// MasterStrip — same row shape as a regular track
// ═══════════════════════════════════════════

function MasterStrip({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  return (
    <div className={`${styles.track} ${styles.masterTrack}`} data-testid="mixer-master">
      <FaderBar className={styles.masterFader} value={volume} onChange={onVolumeChange} ariaLabel="Master Volume">
        <span className={styles.masterLabel}>
          {muted ? (
            <VolumeX size={12} style={MASTER_ERROR_ICON_STYLE} />
          ) : (
            <Volume2 size={12} style={MASTER_DIM_ICON_STYLE} />
          )}
          Master
        </span>
      </FaderBar>
      <span className={styles.toggles}>
        <ToggleM active={muted} label="Mute Master" onClick={onToggleMute} />
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
// MasterFX — Reverb / Air EQ / Limiter
// Collapsed by default to save vertical space; lucide icons replace
// the previous emoji.
// ═══════════════════════════════════════════

function MasterFX() {
  const { setReverbPreset, setReverbWet, setAirEQGain, setLimiterThreshold, setLimiterRatio } = usePlaybackActions();
  // Which reverb the audio actually flows through depends on the render mode:
  // web routes every part through the browser ConvolverNode reverb; native routes
  // hosted parts through the shared VST reverb aux bus. Show only the active
  // path's controls so the two reverbs aren't confusingly presented at once.
  const nativeMode = useAudioRenderModeStore((state) => state.mode) === "native" && isDesktopHost();

  const [presetId, setPresetId] = useState("musikvereinsaal");
  const [wetLevel, setWetLevel] = useState(0.25);
  const [eqGain, setEqGain] = useState(2.5);
  const [threshold, setThreshold] = useState(-6);
  const [ratio, setRatio] = useState(4);

  const presets: ReverbPreset[] = REVERB_PRESETS;

  const handlePresetChange = useCallback(
    (id: string) => {
      setPresetId(id);
      void setReverbPreset(id);
    },
    [setReverbPreset],
  );

  return (
    <Collapsible title="Master FX">
      <div className={styles.fxBody}>
        {nativeMode ? (
          <>
            <VstReverbGroup />
            <VstMasterGroup />
          </>
        ) : (
          <FxGroup icon={<Waves size={12} />} title="Reverb">
            <div className={styles.fxRowSelect}>
              <span className={styles.fxLabel}>Room</span>
              <Select
                value={presetId}
                onValueChange={handlePresetChange}
                options={presets.map((p) => ({ value: p.id, label: p.name }))}
              />
            </div>
            <div className={styles.fxRow}>
              <span className={styles.fxLabel}>Wet</span>
              <Slider
                value={wetLevel}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => {
                  setWetLevel(v);
                  setReverbWet(v);
                }}
                ariaLabel="Reverb wet"
                tooltip={`Wet: ${Math.round(wetLevel * 100)}%`}
              />
              <span className={styles.readout}>{Math.round(wetLevel * 100)}</span>
            </div>
          </FxGroup>
        )}
        <FxGroup icon={<AudioWaveform size={12} />} title="Air EQ">
          <div className={styles.fxRow}>
            <span className={styles.fxLabel}>8 kHz</span>
            <Slider
              value={eqGain}
              min={-6}
              max={8}
              step={0.5}
              center={0}
              onChange={(v) => {
                setEqGain(v);
                setAirEQGain(v);
              }}
              ariaLabel="Air EQ gain"
              tooltip={`${eqGain > 0 ? "+" : ""}${eqGain} dB`}
            />
            <span className={styles.readout}>
              {eqGain > 0 ? "+" : ""}
              {eqGain}
            </span>
          </div>
        </FxGroup>

        <FxGroup icon={<ShieldCheck size={12} />} title="Limiter">
          <div className={styles.fxRow}>
            <span className={styles.fxLabel}>Thresh</span>
            <Slider
              value={threshold}
              min={-24}
              max={0}
              step={1}
              onChange={(v) => {
                setThreshold(v);
                setLimiterThreshold(v);
              }}
              ariaLabel="Limiter threshold"
              tooltip={`${threshold} dB`}
            />
            <span className={styles.readout}>{threshold}</span>
          </div>
          <div className={styles.fxRow}>
            <span className={styles.fxLabel}>Ratio</span>
            <Slider
              value={ratio}
              min={1}
              max={20}
              step={1}
              onChange={(v) => {
                setRatio(v);
                setLimiterRatio(v);
              }}
              ariaLabel="Limiter ratio"
              tooltip={`${ratio}:1`}
            />
            <span className={styles.readout}>{ratio}:1</span>
          </div>
        </FxGroup>
      </div>
    </Collapsible>
  );
}

/** Ellipsized single-line summary of a channel's FX chain in the mixer strip. */
const FX_SUMMARY_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
};

/**
 * VST reverb aux bus (desktop only): a compact summary of the reverb FX chain
 * plus an Fx button that opens the full FX Chains page. The chain itself (which
 * plugins, order, editors) lives on that page to keep the mixer uncluttered.
 * Hidden on the web build, which has no native VST host.
 */
function VstReverbGroup() {
  const plugins = useFxChainStore((s) => s.config.reverb.plugins);
  const openFxChain = useFxChainDialogStore((s) => s.openFxChain);

  if (!isDesktopHost()) return null;

  const summary =
    plugins.length === 0
      ? "No effects"
      : plugins.length === 1
        ? plugins[0]!.pluginName
        : `${plugins[0]!.pluginName} +${plugins.length - 1}`;

  return (
    <FxGroup icon={<Waves size={12} />} title="VST Reverb">
      <div className={styles.fxRowSelect}>
        <span className={styles.fxLabel}>Chain</span>
        <span className={styles.readout} style={FX_SUMMARY_STYLE}>
          {summary}
        </span>
        <Button variant="ghost" size="sm" onClick={() => openFxChain("reverb")}>
          Fx…
        </Button>
      </div>
    </FxGroup>
  );
}

/**
 * Master insert FX (desktop only): an Fx button opening the FX Chains page on the
 * master channel, where a bus compressor / limiter chain can be built. Distinct
 * from the browser-audio Master FX above, which only affects web playback.
 */
function VstMasterGroup() {
  const plugins = useFxChainStore((s) => s.config.master.plugins);
  const openFxChain = useFxChainDialogStore((s) => s.openFxChain);

  if (!isDesktopHost()) return null;

  const summary =
    plugins.length === 0 ? "No effects" : plugins.length === 1 ? plugins[0]!.pluginName : `${plugins.length} effects`;

  return (
    <FxGroup icon={<ShieldCheck size={12} />} title="VST Master FX">
      <div className={styles.fxRowSelect}>
        <span className={styles.fxLabel}>Chain</span>
        <span className={styles.readout} style={FX_SUMMARY_STYLE}>
          {summary}
        </span>
        <Button variant="ghost" size="sm" onClick={() => openFxChain("master")}>
          Fx…
        </Button>
      </div>
    </FxGroup>
  );
}

function FxGroup({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={styles.fxGroup}>
      <span className={styles.fxGroupHeader}>
        {icon}
        {title}
      </span>
      {children}
    </div>
  );
}
