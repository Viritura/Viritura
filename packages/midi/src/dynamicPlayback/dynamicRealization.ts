import type { DynamicsEnvelope, DynamicAxes } from "../dynamicsEnvelope";
import type { DynamicResponseProfile } from "./types";

const STRUCK_PROGRAMS = new Set([46]); // Orchestral harp.

/** Select a runtime response class from a zero-based General MIDI program. */
export function selectDynamicResponseProfile(program: number): DynamicResponseProfile {
  if ((program >= 0 && program <= 7) || (program >= 24 && program <= 39) || STRUCK_PROGRAMS.has(program)) {
    return "struck-plucked";
  }
  if (program >= 16 && program <= 23) return "organ-fixed-attack";
  if ((program >= 40 && program <= 45) || (program >= 47 && program <= 79)) return "sustained-expressive";
  return "fallback";
}

function realizeAxes(axes: DynamicAxes, profile: DynamicResponseProfile): DynamicAxes {
  if (axes.cc11 === 0) return { velocity: 1, cc11: 0 };
  switch (profile) {
    case "struck-plucked":
      return { velocity: axes.velocity, cc11: 118 };
    case "organ-fixed-attack":
      return { velocity: 84, cc11: axes.cc11 };
    case "sustained-expressive":
    case "fallback":
      return axes;
  }
}

/** Project one semantic envelope through an instrument response profile. */
export function realizeDynamicsEnvelope(envelope: DynamicsEnvelope, profile: DynamicResponseProfile): DynamicsEnvelope {
  if (profile === "fallback" || profile === "sustained-expressive") return envelope;
  return {
    anchors: envelope.anchors.map((anchor) => ({ ...anchor, ...realizeAxes(anchor, profile) })),
    ramps: envelope.ramps.map((ramp) => ({
      ...ramp,
      start: realizeAxes(ramp.start, profile),
      end: realizeAxes(ramp.end, profile),
    })),
    attacks: envelope.attacks.map((attack) => ({
      ...attack,
      attackVelocity: profile === "organ-fixed-attack" ? 84 : attack.attackVelocity,
    })),
  };
}
