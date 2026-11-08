import type { MixerBusSettings, MixerChannelSettings, ScoreMixerSettings } from "@viritura/core";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalGain(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && value >= 0 && value <= 10 ** (6 / 20));
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isBus(value: unknown): value is MixerBusSettings {
  return (
    isObject(value) &&
    optionalGain(value["volume"]) &&
    optionalBoolean(value["muted"]) &&
    optionalBoolean(value["solo"])
  );
}

function isChannel(value: unknown): value is MixerChannelSettings {
  if (!isObject(value) || !isBus(value)) return false;
  const pan = value["pan"];
  return (
    (pan === undefined || (typeof pan === "number" && pan >= -1 && pan <= 1)) &&
    optionalBoolean(value["ensembleEnabled"]) &&
    (value["spatialMode"] === undefined || value["spatialMode"] === "stereo" || value["spatialMode"] === "stage")
  );
}

function parseMap<T>(
  value: unknown,
  name: string,
  guard: (entry: unknown) => entry is T,
): Record<string, T> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`Invalid _x.viritura.mixer.${name}`);
  return Object.fromEntries(
    Object.entries(value).map(([id, settings]) => {
      if (!guard(settings)) throw new Error(`Invalid _x.viritura.mixer.${name}.${id}`);
      return [id, { ...settings }];
    }),
  );
}

export function parseMixerSettings(value: unknown): ScoreMixerSettings | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || !optionalGain(value["masterVolume"]) || !optionalBoolean(value["masterMuted"])) {
    throw new Error("Invalid _x.viritura.mixer master settings");
  }
  const channels = parseMap(value["channels"], "channels", isChannel);
  const groups = parseMap(value["groups"], "groups", isBus);
  return {
    ...(channels ? { channels } : {}),
    ...(groups ? { groups } : {}),
    ...(typeof value["masterVolume"] === "number" ? { masterVolume: value["masterVolume"] } : {}),
    ...(typeof value["masterMuted"] === "boolean" ? { masterMuted: value["masterMuted"] } : {}),
  };
}
