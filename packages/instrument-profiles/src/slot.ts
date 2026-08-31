import type { PluginIdentity, ProfilePlatform, ProfileSlot, SlotAvailability, SlotBinding } from "./types";

/**
 * A slot is playable only when all three configured values are present. The Lua
 * script, plugin path, and captured state must all be set; `baseChannel` always
 * has a default so it never gates configuration.
 */
export function isSlotFullyConfigured(binding: SlotBinding): boolean {
  return (
    typeof binding.luaScriptPath === "string" &&
    binding.luaScriptPath.length > 0 &&
    typeof binding.pluginPath === "string" &&
    binding.pluginPath.length > 0 &&
    typeof binding.stateRef === "string" &&
    binding.stateRef.length > 0
  );
}

/**
 * Whether captured opaque state may be restored into a freshly loaded plugin.
 * State is refused when the loaded plugin's identity does not match the one that
 * produced the state, so an upgrade or replacement never silently loads
 * incompatible bytes. Absent a captured identity we cannot verify, so we refuse.
 */
export function canRestoreState(binding: SlotBinding, loaded: PluginIdentity): boolean {
  const captured = binding.pluginIdentity;
  if (!captured) return false;
  if (captured.format !== loaded.format) return false;
  if (captured.pluginId !== loaded.pluginId) return false;
  // A build stamp, when both sides expose one, must agree; a missing stamp on
  // either side is treated as "unknown, allow" rather than a hard mismatch.
  if (captured.buildId && loaded.buildId && captured.buildId !== loaded.buildId) return false;
  return true;
}

/**
 * Why a slot is (not) currently playable, given the platform. VST hosting is
 * desktop-only; on web every slot reports `web-unsupported` and the caller falls
 * back to VirituraSounds explicitly (never a silent substitution).
 */
export function slotAvailability(slot: ProfileSlot, platform: ProfilePlatform): SlotAvailability {
  if (platform === "web") return { available: false, reason: "web-unsupported" };
  if (!isSlotFullyConfigured(slot.binding)) return { available: false, reason: "unconfigured" };
  return { available: true, reason: "ok" };
}
