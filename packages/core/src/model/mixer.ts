/** Persisted mixer controls; omitted fields use the editor's defaults. */
export interface MixerBusSettings {
  volume?: number;
  muted?: boolean;
  solo?: boolean;
}

export interface MixerChannelSettings extends MixerBusSettings {
  pan?: number;
  ensembleEnabled?: boolean;
  spatialMode?: "stereo" | "stage";
}

/** Root `_x.viritura.mixer`. Channels use stable part IDs, not runtime indices. */
export interface ScoreMixerSettings {
  channels?: Record<string, MixerChannelSettings>;
  groups?: Record<string, MixerBusSettings>;
  masterVolume?: number;
  masterMuted?: boolean;
}
