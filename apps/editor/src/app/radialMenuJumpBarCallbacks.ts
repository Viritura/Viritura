/**
 * Radial-menu jump bar commands.
 *
 * Each entry opens a notation radial menu at the pointer, so they share one
 * shape and are grouped here rather than repeated in the action catalog.
 */

import type { MutableRefObject } from "react";
import type { RadialMenuCategory } from "../radialMenu";
import type { JumpBarCallbacks } from "../jumpBar";

type RadialMenuOpeners = Pick<
  JumpBarCallbacks,
  | "openClefMenu"
  | "openBarlineMenu"
  | "openKeySignatureMenu"
  | "openTimeSignatureMenu"
  | "openDynamicsMenu"
  | "openOrnamentsMenu"
  | "openTupletMenu"
  | "openBreathFermataMenu"
  | "openFingeringMenu"
  | "openArticulationMenu"
  | "openRepeatsMenu"
>;

const RADIAL_MENU_COMMANDS = {
  openClefMenu: "clef",
  openBarlineMenu: "barline",
  openKeySignatureMenu: "key-signature",
  openTimeSignatureMenu: "time-signature",
  openDynamicsMenu: "dynamic",
  openOrnamentsMenu: "ornament",
  openTupletMenu: "tuplet",
  openBreathFermataMenu: "breath-fermata",
  openFingeringMenu: "fingering",
  openArticulationMenu: "articulation",
  openRepeatsMenu: "repeat",
} as const satisfies Record<keyof RadialMenuOpeners, RadialMenuCategory>;

export function radialMenuJumpBarCallbacks(
  setRadialMenu: (menu: { category: RadialMenuCategory; position: { x: number; y: number } } | null) => void,
  mousePositionRef: MutableRefObject<{ x: number; y: number }>,
): RadialMenuOpeners {
  const openers = {} as Record<keyof RadialMenuOpeners, () => void>;
  for (const [command, category] of Object.entries(RADIAL_MENU_COMMANDS) as [
    keyof RadialMenuOpeners,
    RadialMenuCategory,
  ][]) {
    openers[command] = () => setRadialMenu({ category, position: { ...mousePositionRef.current } });
  }
  return openers;
}
